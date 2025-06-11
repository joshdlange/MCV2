import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { queryClient } from '@/lib/queryClient';
import { Loader2, Link, RefreshCw } from 'lucide-react';
import type { CardSet, MainSet } from '@shared/schema';

interface UnlinkedSet extends CardSet {
  mainSetId: null;
}

export function ManualSetLinker() {
  const [selectedMainSets, setSelectedMainSets] = useState<{ [setId: number]: number }>({});
  const { toast } = useToast();

  // Get all sets with null mainSetId
  const { data: unlinkedSets = [], isLoading: loadingSets, refetch: refetchSets } = useQuery({
    queryKey: ['/api/admin/unlinked-sets'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/admin/unlinked-sets');
      return response.json() as Promise<UnlinkedSet[]>;
    },
  });

  // Get all mainSets for dropdown
  const { data: mainSets = [] } = useQuery({
    queryKey: ['/api/main-sets'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/main-sets');
      return response.json() as Promise<MainSet[]>;
    },
  });

  // Mutation for linking a single set
  const linkSetMutation = useMutation({
    mutationFn: async ({ setId, mainSetId }: { setId: number; mainSetId: number }) => {
      const response = await apiRequest('PATCH', `/api/card-sets/${setId}`, {
        mainSetId: mainSetId
      });
      return response.json();
    },
    onSuccess: (_, variables) => {
      toast({
        title: "Success",
        description: `Set successfully linked to mainSet`,
      });
      // Remove from local state
      setSelectedMainSets(prev => {
        const updated = { ...prev };
        delete updated[variables.setId];
        return updated;
      });
      // Refetch unlinked sets
      refetchSets();
      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: ['/api/card-sets'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to link set",
        variant: "destructive",
      });
    },
  });

  const handleSelectMainSet = (setId: number, mainSetId: string) => {
    setSelectedMainSets(prev => ({
      ...prev,
      [setId]: parseInt(mainSetId)
    }));
  };

  const handleLinkSet = (setId: number) => {
    const mainSetId = selectedMainSets[setId];
    if (!mainSetId) {
      toast({
        title: "Error",
        description: "Please select a mainSet first",
        variant: "destructive",
      });
      return;
    }
    linkSetMutation.mutate({ setId, mainSetId });
  };

  if (loadingSets) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link className="w-5 h-5" />
            Manual Set Linker
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span className="ml-2">Loading unlinked sets...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link className="w-5 h-5" />
          Manual Set Linker
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Manually assign sets to mainSets. Found {unlinkedSets.length} unlinked sets.
        </p>
        <Button
          onClick={() => refetchSets()}
          variant="outline"
          size="sm"
          className="self-start bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        {unlinkedSets.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No unlinked sets found. All sets have been assigned to mainSets.
          </div>
        ) : (
          <div className="space-y-4">
            {unlinkedSets.map((set) => (
              <div
                key={set.id}
                className="flex items-center gap-4 p-4 border rounded-lg"
              >
                <div className="flex-1">
                  <h4 className="font-medium">{set.name}</h4>
                  <p className="text-sm text-muted-foreground">
                    Year: {set.year} • Cards: {set.totalCards}
                  </p>
                </div>
                
                <div className="flex items-center gap-2">
                  <Select
                    value={selectedMainSets[set.id]?.toString() || ""}
                    onValueChange={(value) => handleSelectMainSet(set.id, value)}
                  >
                    <SelectTrigger className="w-[300px] bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-600">
                      <SelectValue placeholder="Select a mainSet..." className="text-gray-900 dark:text-gray-100" />
                    </SelectTrigger>
                    <SelectContent className="bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600">
                      {mainSets.map((mainSet) => (
                        <SelectItem 
                          key={mainSet.id} 
                          value={mainSet.id.toString()}
                          className="text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                          {mainSet.name} ({mainSet.year})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  
                  <Button
                    onClick={() => handleLinkSet(set.id)}
                    disabled={!selectedMainSets[set.id] || linkSetMutation.isPending}
                    size="sm"
                    className="bg-blue-600 text-white border-blue-600 hover:bg-blue-700 hover:border-blue-700 disabled:bg-gray-400 disabled:text-gray-200 disabled:border-gray-400"
                  >
                    {linkSetMutation.isPending && linkSetMutation.variables?.setId === set.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      "Link"
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}