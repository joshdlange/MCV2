import React, { useState, useRef } from "react";
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
import { Plus, Edit, Trash2, Search, Save, Upload, Loader2 } from "lucide-react";
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
    onSuccess: (response: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/main-sets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/card-sets"] });
      
      let description = "Main set created successfully";
      if (response.suggestedAssignments?.length > 0) {
        description += `. Auto-assigned ${response.suggestedAssignments.length} matching base set(s).`;
      }
      if (response.conflictingSets?.length > 0) {
        description += ` Warning: ${response.conflictingSets.length} exact name match(es) already assigned to other main sets.`;
      }
      if (response.matchingBaseSets?.length > 0) {
        description += ` Found ${response.matchingBaseSets.length} similar set(s) already assigned elsewhere.`;
      }
      
      toast({
        title: "Success",
        description,
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
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [assignedSets, setAssignedSets] = useState<number[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: mainSet.name,
      notes: mainSet.notes || "",
      thumbnailImageUrl: mainSet.thumbnailImageUrl || "",
    },
  });

  // Debounce search for server-side query
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Fetch only assigned card sets (much faster than all 6000+)
  const { data: assignedCardSets = [], isLoading: loadingAssigned } = useQuery<CardSet[]>({
    queryKey: [`/api/card-sets/by-main-set/${mainSet.id}`],
    enabled: open,
  });

  // Server-side search for finding new sets to assign
  const { data: searchResults = [], isLoading: loadingSearch } = useQuery<CardSet[]>({
    queryKey: [`/api/card-sets/search-for-assignment?q=${encodeURIComponent(debouncedSearch)}`],
    enabled: open && debouncedSearch.length >= 2,
  });

  // Initialize assigned sets when dialog opens - always sync even if empty
  React.useEffect(() => {
    if (open) {
      setAssignedSets(assignedCardSets.map(set => set.id));
    }
  }, [open, assignedCardSets]);
  
  // Reset search when dialog closes
  React.useEffect(() => {
    if (!open) {
      setSearchTerm("");
      setDebouncedSearch("");
    }
  }, [open]);

  // Combined list: assigned sets + search results (deduplicated)
  const filteredSets = React.useMemo(() => {
    const assignedIds = new Set(assignedCardSets.map(s => s.id));
    const combined = [...assignedCardSets];
    
    // Add search results that aren't already in assigned
    for (const set of searchResults) {
      if (!assignedIds.has(set.id)) {
        combined.push(set);
      }
    }
    
    return combined;
  }, [assignedCardSets, searchResults]);

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
      queryClient.invalidateQueries({ queryKey: [`/api/card-sets/by-main-set/${mainSet.id}`] });
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
      queryClient.invalidateQueries({ queryKey: [`/api/card-sets/by-main-set/${mainSet.id}`] });
      toast({
        title: "Success",
        description: "Sets unassigned successfully",
      });
    },
  });

  const onSubmit = async (data: z.infer<typeof formSchema>) => {
    // Guard: don't submit while still loading assigned sets
    if (loadingAssigned) {
      toast({
        variant: "destructive",
        title: "Please wait",
        description: "Still loading assigned sets...",
      });
      return;
    }

    // Update main set details
    await updateMutation.mutateAsync(data);

    // Handle set assignments
    const currentlyAssignedIds = assignedCardSets.map(set => set.id);

    const toAssign = assignedSets.filter(id => !currentlyAssignedIds.includes(id));
    const toUnassign = currentlyAssignedIds.filter(id => !assignedSets.includes(id));

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

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({
        variant: "destructive",
        title: "Invalid file",
        description: "Please select an image file",
      });
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast({
        variant: "destructive",
        title: "File too large",
        description: "Please select an image under 5MB",
      });
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('image', file);

      const token = await (window as any).firebaseAuth?.currentUser?.getIdToken();
      const response = await fetch(`/api/main-sets/${mainSet.id}/upload-thumbnail`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Upload failed');
      }

      const result = await response.json();
      
      // Update the form field with the new Cloudinary URL
      form.setValue('thumbnailImageUrl', result.thumbnailImageUrl);
      
      // Invalidate queries to refresh the UI
      queryClient.invalidateQueries({ queryKey: ["/api/main-sets"] });
      
      toast({
        title: "Success",
        description: "Thumbnail uploaded successfully",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: error.message || "Failed to upload thumbnail",
      });
    } finally {
      setIsUploading(false);
      // Reset the file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
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
                    <FormLabel>Thumbnail Image</FormLabel>
                    <div className="space-y-3">
                      {/* Upload Button - Primary option */}
                      <div className="flex items-center gap-2">
                        <input
                          type="file"
                          ref={fileInputRef}
                          onChange={handleImageUpload}
                          accept="image/*"
                          className="hidden"
                          data-testid="input-thumbnail-file"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={isUploading}
                          className="flex-1"
                          data-testid="button-upload-thumbnail"
                        >
                          {isUploading ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Uploading...
                            </>
                          ) : (
                            <>
                              <Upload className="h-4 w-4 mr-2" />
                              Upload Image
                            </>
                          )}
                        </Button>
                      </div>
                      
                      {/* URL Input - Alternative option */}
                      <div className="text-xs text-gray-500 text-center">or paste an image URL</div>
                      <FormControl>
                        <Input 
                          placeholder="https://example.com/image.jpg"
                          {...field}
                          data-testid="input-thumbnail-url"
                        />
                      </FormControl>
                      
                      {/* Preview */}
                      {field.value && (
                        <div className="mt-2">
                          <p className="text-xs text-gray-500 mb-1">Preview:</p>
                          <img 
                            src={field.value} 
                            alt="Thumbnail preview"
                            className="w-24 h-24 object-cover rounded border"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        </div>
                      )}
                    </div>
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
                  placeholder="Type 2+ chars to search all sets..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
                {loadingSearch && (
                  <Loader2 className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 animate-spin text-gray-400" />
                )}
              </div>

              {/* Assignment Summary */}
              <div className="flex items-center justify-between">
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
                {searchTerm.length >= 2 && searchResults.length > 0 && (
                  <span className="text-xs text-gray-500">
                    Found {searchResults.length} matching sets
                  </span>
                )}
              </div>

              {/* Set List */}
              <div className="border rounded-md max-h-60 overflow-y-auto">
                {loadingAssigned ? (
                  <div className="p-4 text-center text-gray-500">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                    Loading assigned sets...
                  </div>
                ) : filteredSets.length === 0 ? (
                  <div className="p-4 text-center text-gray-500">
                    {searchTerm.length >= 2 ? "No sets match your search" : 
                     searchTerm.length > 0 ? "Type 2+ characters to search" :
                     "No sets assigned yet. Search to find sets."}
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
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [showMissingThumbnails, setShowMissingThumbnails] = useState(false);
  const ITEMS_PER_PAGE = 25;

  const { data: mainSets = [], isLoading, error } = useQuery<MainSet[]>({
    queryKey: ["/api/main-sets"],
  });

  const filteredSets = React.useMemo(() => {
    let filtered = mainSets;
    
    if (showMissingThumbnails) {
      filtered = filtered.filter(set => !set.thumbnailImageUrl || set.thumbnailImageUrl.trim() === '');
    }
    
    if (searchTerm.trim()) {
      const search = searchTerm.toLowerCase();
      filtered = filtered.filter(set => 
        set.name.toLowerCase().includes(search) ||
        (set.notes && set.notes.toLowerCase().includes(search))
      );
    }
    
    return filtered;
  }, [mainSets, searchTerm, showMissingThumbnails]);

  const paginatedSets = React.useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredSets.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredSets, currentPage]);

  const totalPages = Math.ceil(filteredSets.length / ITEMS_PER_PAGE);

  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, showMissingThumbnails]);

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

  const missingCount = mainSets.filter(set => !set.thumbnailImageUrl || set.thumbnailImageUrl.trim() === '').length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Manage Main Sets</h1>
        <CreateMainSetDialog />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <CardTitle>Main Sets ({filteredSets.length} of {mainSets.length})</CardTitle>
            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search sets..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 w-full sm:w-64"
                />
              </div>
              <Button
                variant={showMissingThumbnails ? "default" : "outline"}
                size="sm"
                onClick={() => setShowMissingThumbnails(!showMissingThumbnails)}
                className="whitespace-nowrap"
              >
                Missing Thumbnails ({missingCount})
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredSets.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500">
                {searchTerm || showMissingThumbnails 
                  ? "No main sets match your filters." 
                  : "No main sets found. Create your first main set to get started."}
              </p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-gray-900 font-semibold w-12">Thumb</TableHead>
                    <TableHead className="text-gray-900 font-semibold">Name</TableHead>
                    <TableHead className="text-gray-900 font-semibold">Notes</TableHead>
                    <TableHead className="text-gray-900 font-semibold">Created</TableHead>
                    <TableHead className="text-gray-900 font-semibold">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedSets.map((mainSet) => (
                    <TableRow key={mainSet.id}>
                      <TableCell>
                        {mainSet.thumbnailImageUrl ? (
                          <img 
                            src={mainSet.thumbnailImageUrl} 
                            alt="" 
                            className="w-10 h-10 object-cover rounded"
                          />
                        ) : (
                          <div className="w-10 h-10 bg-gray-200 rounded flex items-center justify-center text-xs text-gray-400">
                            ?
                          </div>
                        )}
                      </TableCell>
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
              
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t">
                  <span className="text-sm text-gray-600">
                    Page {currentPage} of {totalPages}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}