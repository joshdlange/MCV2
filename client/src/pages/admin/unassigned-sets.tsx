import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Search, ExternalLink, Link as LinkIcon } from "lucide-react";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { CardSet, MainSet } from "@shared/schema";

export default function AdminUnassignedSets() {
  const [searchTerm, setSearchTerm] = useState("");
  const { toast } = useToast();

  const { data: unassignedSets = [], isLoading, error } = useQuery<CardSet[]>({
    queryKey: ["/api/card-sets/unassigned"],
  });

  const { data: mainSets = [] } = useQuery<MainSet[]>({
    queryKey: ["/api/main-sets"],
  });

  const assignToMainSetMutation = useMutation({
    mutationFn: async ({ mainSetId, cardSetIds }: { mainSetId: number; cardSetIds: number[] }) => {
      await apiRequest(`/api/main-sets/${mainSetId}/assign-sets`, "PATCH", { cardSetIds });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/card-sets/unassigned"] });
      queryClient.invalidateQueries({ queryKey: ["/api/card-sets"] });
      toast({
        title: "Success",
        description: "Set assigned to main set successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to assign set",
        variant: "destructive",
      });
    },
  });

  // Filter sets based on search term
  const filteredSets = unassignedSets.filter(set =>
    set.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    set.year.toString().includes(searchTerm)
  );

  const handleAssignToMainSet = (cardSetId: number, mainSetId: number) => {
    assignToMainSetMutation.mutate({
      mainSetId,
      cardSetIds: [cardSetId]
    });
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="h-32 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="text-red-600">Error loading unassigned sets: {(error as Error).message}</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Unassigned Sets</h1>
        <Badge variant="secondary">{filteredSets.length} sets</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sets Not Assigned to Main Sets</CardTitle>
          <div className="flex items-center space-x-2">
            <Search className="h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search by name or year..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="max-w-sm"
            />
          </div>
        </CardHeader>
        <CardContent>
          {filteredSets.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500">
                {searchTerm ? "No sets found matching your search." : "All sets are assigned to main sets!"}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-gray-900 font-semibold">Name</TableHead>
                  <TableHead className="text-gray-900 font-semibold">Year</TableHead>
                  <TableHead className="text-gray-900 font-semibold">Cards</TableHead>
                  <TableHead className="text-gray-900 font-semibold">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSets.map((cardSet) => (
                  <TableRow key={cardSet.id}>
                    <TableCell className="font-medium">{cardSet.name}</TableCell>
                    <TableCell>{cardSet.year}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{cardSet.totalCards} cards</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex space-x-2">
                        <Link href={`/sets/${cardSet.id}`}>
                          <Button variant="outline" size="sm" className="bg-white text-gray-700 border-gray-300 hover:bg-gray-50">
                            <ExternalLink className="h-4 w-4 mr-1" />
                            View Set
                          </Button>
                        </Link>
                        
                        {mainSets.length > 0 && (
                          <select
                            className="px-3 py-1 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50"
                            onChange={(e) => {
                              if (e.target.value) {
                                handleAssignToMainSet(cardSet.id, parseInt(e.target.value));
                                e.target.value = ""; // Reset selection
                              }
                            }}
                            disabled={assignToMainSetMutation.isPending}
                          >
                            <option value="">Assign to Main Set...</option>
                            {mainSets.map((mainSet) => (
                              <option key={mainSet.id} value={mainSet.id}>
                                {mainSet.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}