import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Download, Database } from 'lucide-react';

interface GroupingResult {
  groupings: { [key: string]: string[] };
  totalSets: number;
  groupedSets: number;
  ungroupedSets: number;
}

interface PopulateResult {
  message: string;
  totalAnalyzed: number;
  inserted: number;
  skipped: number;
  insertedSets: string[];
  skippedSets: string[];
}

export function SetGroupingAnalyzer() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const { toast } = useToast();
  
  const { data: result, refetch, isLoading } = useQuery<GroupingResult>({
    queryKey: ['/api/admin/analyze-set-groupings'],
    enabled: false, // Don't auto-fetch
  });

  const populateMutation = useMutation({
    mutationFn: async (): Promise<PopulateResult> => {
      const response = await apiRequest('POST', '/api/admin/populate-main-sets');
      return response.json();
    },
    onSuccess: (data: PopulateResult) => {
      toast({
        title: "Success",
        description: `${data.message}. Inserted: ${data.inserted}, Skipped: ${data.skipped}`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to populate main sets table",
        variant: "destructive",
      });
    },
  });

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    await refetch();
    setIsAnalyzing(false);
  };

  const handlePopulate = () => {
    populateMutation.mutate();
  };

  const downloadResults = () => {
    if (!result) return;
    
    const jsonString = JSON.stringify(result.groupings, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'set-groupings.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Set Grouping Analysis Tool</CardTitle>
          <p className="text-sm text-muted-foreground">
            Analyze all sets in the database and group them by shared prefixes (removing variant keywords like "Gold Foil", "Promo", etc.)
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4">
            <Button 
              onClick={handleAnalyze}
              disabled={isAnalyzing || isLoading}
              className="flex items-center gap-2"
            >
              {(isAnalyzing || isLoading) && <Loader2 className="w-4 h-4 animate-spin" />}
              Analyze Set Groupings
            </Button>
            
            {result && (
              <>
                <Button 
                  onClick={downloadResults}
                  variant="outline"
                  className="flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Download JSON
                </Button>
                
                <Button 
                  onClick={handlePopulate}
                  disabled={populateMutation.isPending}
                  className="flex items-center gap-2"
                >
                  {populateMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  <Database className="w-4 h-4" />
                  Populate MainSet Table
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle>Analysis Results</CardTitle>
            <div className="text-sm text-muted-foreground space-y-1">
              <p>Total Sets: {result.totalSets}</p>
              <p>Grouped Sets: {result.groupedSets}</p>
              <p>Ungrouped Sets: {result.ungroupedSets}</p>
              <p>Generated Groups: {Object.keys(result.groupings).length}</p>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 max-h-96 overflow-y-auto">
              {Object.entries(result.groupings).map(([mainSetName, setNames]) => (
                <div key={mainSetName} className="border rounded-lg p-4">
                  <h4 className="font-semibold text-lg mb-2">{mainSetName}</h4>
                  <ul className="space-y-1">
                    {setNames.map((setName) => (
                      <li key={setName} className="text-sm text-muted-foreground pl-4">
                        • {setName}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}