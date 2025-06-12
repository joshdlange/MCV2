import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { insertMainSetSchema, type MainSet, type InsertMainSet, type CardSet } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Plus, Edit, Trash2, Search, Save } from "lucide-react";
import { z } from "zod";

const formSchema = insertMainSetSchema.extend({
  name: z.string().min(1, "Name is required"),
});

function CreateMainSetDialog() {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      notes: "",
      thumbnailImageUrl: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: InsertMainSet) => apiRequest("POST", "/api/main-sets", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/main-sets"] });
      toast({
        title: "Success",
        description: "Main set created successfully",
      });
      setOpen(false);
      form.reset();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to create main set",
      });
    },
  });

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    createMutation.mutate(data);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Add Main Set
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create New Main Set</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name *</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter main set name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder="Optional notes about this main set"
                      className="resize-none"
                      {...field}
                      value={field.value || ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="thumbnailImageUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Thumbnail Image URL</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="https://example.com/image.jpg"
                      {...field}
                      value={field.value || ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end space-x-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Creating..." : "Create Main Set"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function EditMainSetDialog({ mainSet }: { mainSet: MainSet }) {
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [assignedSets, setAssignedSets] = useState<number[]>([]);
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: mainSet.name,
      notes: mainSet.notes || "",
      thumbnailImageUrl: mainSet.thumbnailImageUrl || "",
    },
  });

  // Fetch all card sets
  const { data: cardSets = [] } = useQuery<CardSet[]>({
    queryKey: ["/api/card-sets"],
    enabled: open,
  });

  // Initialize assigned sets when dialog opens
  React.useEffect(() => {
    if (open && cardSets.length > 0) {
      const assigned = cardSets
        .filter(set => set.mainSetId === mainSet.id)
        .map(set => set.id);
      setAssignedSets(assigned);
    }
  }, [open, cardSets, mainSet.id]);

  // Filter card sets based on search term
  const filteredSets = cardSets.filter(set =>
    set.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    set.year.toString().includes(searchTerm)
  );

  const updateMutation = useMutation({
    mutationFn: (data: Partial<InsertMainSet>) => 
      apiRequest("PATCH", `/api/main-sets/${mainSet.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/main-sets"] });
      toast({
        title: "Success",
        description: "Main set updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to update main set",
      });
    },
  });

  const assignSetsMutation = useMutation({
    mutationFn: (cardSetIds: number[]) =>
      apiRequest("PATCH", `/api/main-sets/${mainSet.id}/assign-sets`, { cardSetIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/card-sets"] });
      toast({
        title: "Success",
        description: "Sets assigned successfully",
      });
    },
  });

  const unassignSetsMutation = useMutation({
    mutationFn: (cardSetIds: number[]) =>
      apiRequest("PATCH", `/api/main-sets/${mainSet.id}/unassign-sets`, { cardSetIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/card-sets"] });
      toast({
        title: "Success",
        description: "Sets unassigned successfully",
      });
    },
  });

  const onSubmit = async (data: z.infer<typeof formSchema>) => {
    // Update main set details
    await updateMutation.mutateAsync(data);

    // Handle set assignments
    const currentlyAssigned = cardSets
      .filter(set => set.mainSetId === mainSet.id)
      .map(set => set.id);

    const toAssign = assignedSets.filter(id => !currentlyAssigned.includes(id));
    const toUnassign = currentlyAssigned.filter(id => !assignedSets.includes(id));

    if (toAssign.length > 0) {
      await assignSetsMutation.mutateAsync(toAssign);
    }
    if (toUnassign.length > 0) {
      await unassignSetsMutation.mutateAsync(toUnassign);
    }

    setOpen(false);
  };

  const toggleSetAssignment = (setId: number) => {
    setAssignedSets(prev =>
      prev.includes(setId)
        ? prev.filter(id => id !== setId)
        : [...prev, setId]
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="bg-white text-gray-700 border-gray-300 hover:bg-gray-50">
          <Edit className="h-4 w-4 mr-1" />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Main Set: {mainSet.name}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Basic Info */}
            <div className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter main set name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Optional notes about this main set"
                        className="resize-none"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="thumbnailImageUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Thumbnail Image URL</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="https://example.com/image.jpg"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Set Assignment */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Assign Card Sets</h3>
              
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                <Input
                  placeholder="Search sets by name or year..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>

              {/* Assignment Summary */}
              <div className="flex items-center space-x-2">
                <span className="text-sm text-gray-600">
                  {assignedSets.length} sets assigned
                </span>
                {assignedSets.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setAssignedSets([])}
                  >
                    Clear All
                  </Button>
                )}
              </div>

              {/* Set List */}
              <div className="border rounded-md max-h-60 overflow-y-auto">
                {filteredSets.length === 0 ? (
                  <div className="p-4 text-center text-gray-500">
                    {searchTerm ? "No sets match your search" : "No sets available"}
                  </div>
                ) : (
                  <div className="p-2 space-y-2">
                    {filteredSets.map((set) => (
                      <div
                        key={set.id}
                        className="flex items-center space-x-3 p-2 hover:bg-gray-50 rounded"
                      >
                        <Checkbox
                          checked={assignedSets.includes(set.id)}
                          onCheckedChange={() => toggleSetAssignment(set.id)}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{set.name}</div>
                          <div className="text-sm text-gray-500">
                            {set.year} • {set.totalCards} cards
                            {set.mainSetId && set.mainSetId !== mainSet.id && (
                              <Badge variant="secondary" className="ml-2">
                                Assigned to other main set
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end space-x-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={updateMutation.isPending || assignSetsMutation.isPending || unassignSetsMutation.isPending}
              >
                <Save className="h-4 w-4 mr-2" />
                {updateMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteMainSetDialog({ mainSet }: { mainSet: MainSet }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/main-sets/${mainSet.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/main-sets"] });
      toast({
        title: "Success",
        description: "Main set deleted successfully",
      });
      setOpen(false);
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to delete main set",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="bg-white text-red-600 border-red-300 hover:bg-red-50">
          <Trash2 className="h-4 w-4 mr-1" />
          Delete
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Main Set</DialogTitle>
        </DialogHeader>
        <p>Are you sure you want to delete "{mainSet.name}"? This action cannot be undone.</p>
        <div className="flex justify-end space-x-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button 
            variant="destructive" 
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? "Deleting..." : "Delete"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminMainSets() {
  const { data: mainSets = [], isLoading, error } = useQuery<MainSet[]>({
    queryKey: ["/api/main-sets"],
  });

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
        <div className="text-red-600">Error loading main sets: {(error as Error).message}</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Manage Main Sets</h1>
        <CreateMainSetDialog />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Main Sets ({mainSets.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {mainSets.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500">No main sets found. Create your first main set to get started.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-gray-900 font-semibold">Name</TableHead>
                  <TableHead className="text-gray-900 font-semibold">Notes</TableHead>
                  <TableHead className="text-gray-900 font-semibold">Created</TableHead>
                  <TableHead className="text-gray-900 font-semibold">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mainSets.map((mainSet) => (
                  <TableRow key={mainSet.id}>
                    <TableCell className="font-medium">{mainSet.name}</TableCell>
                    <TableCell className="max-w-xs truncate">
                      {mainSet.notes || "No notes"}
                    </TableCell>
                    <TableCell>
                      {new Date(mainSet.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex space-x-2">
                        <EditMainSetDialog mainSet={mainSet} />
                        <DeleteMainSetDialog mainSet={mainSet} />
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