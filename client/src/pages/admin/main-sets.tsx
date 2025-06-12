import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { PlusCircle, Edit, Trash2, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { MainSet } from "@shared/schema";

const mainSetFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  notes: z.string().optional(),
  thumbnailImageUrl: z.string().url().optional().or(z.literal("")),
});

type MainSetFormData = z.infer<typeof mainSetFormSchema>;

export default function AdminMainSets() {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingMainSet, setEditingMainSet] = useState<MainSet | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: mainSets = [], isLoading } = useQuery({
    queryKey: ["/api/main-sets"],
  });

  const createForm = useForm<MainSetFormData>({
    resolver: zodResolver(mainSetFormSchema),
    defaultValues: {
      name: "",
      notes: "",
      thumbnailImageUrl: "",
    },
  });

  const editForm = useForm<MainSetFormData>({
    resolver: zodResolver(mainSetFormSchema),
  });

  const createMutation = useMutation({
    mutationFn: (data: MainSetFormData) => apiRequest("/api/main-sets", "POST", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/main-sets"] });
      setIsCreateDialogOpen(false);
      createForm.reset();
      toast({
        title: "Success",
        description: "Main set created successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create main set",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: MainSetFormData }) =>
      apiRequest(`/api/main-sets/${id}`, "PUT", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/main-sets"] });
      setEditingMainSet(null);
      toast({
        title: "Success",
        description: "Main set updated successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update main set",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/main-sets/${id}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/main-sets"] });
      toast({
        title: "Success",
        description: "Main set deleted successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete main set",
        variant: "destructive",
      });
    },
  });

  const onCreateSubmit = (data: MainSetFormData) => {
    createMutation.mutate(data);
  };

  const onEditSubmit = (data: MainSetFormData) => {
    if (editingMainSet) {
      updateMutation.mutate({ id: editingMainSet.id, data });
    }
  };

  const handleEdit = (mainSet: MainSet) => {
    setEditingMainSet(mainSet);
    editForm.reset({
      name: mainSet.name,
      notes: mainSet.notes || "",
      thumbnailImageUrl: mainSet.thumbnailImageUrl || "",
    });
  };

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to delete this main set?")) {
      deleteMutation.mutate(id);
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center">Loading main sets...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Main Sets Management</h1>
          <p className="text-muted-foreground mt-2">
            Manage main card sets and their properties
          </p>
        </div>

        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-marvel-red hover:bg-marvel-red/90">
              <PlusCircle className="w-4 h-4 mr-2" />
              Add Main Set
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Create New Main Set</DialogTitle>
            </DialogHeader>
            <Form {...createForm}>
              <form onSubmit={createForm.handleSubmit(onCreateSubmit)} className="space-y-4">
                <FormField
                  control={createForm.control}
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
                  control={createForm.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notes</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Enter any notes about this main set"
                          className="resize-none"
                          rows={3}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={createForm.control}
                  name="thumbnailImageUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Thumbnail Image URL</FormLabel>
                      <FormControl>
                        <Input placeholder="https://example.com/image.jpg" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex justify-end space-x-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsCreateDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={createMutation.isPending}
                    className="bg-marvel-red hover:bg-marvel-red/90"
                  >
                    {createMutation.isPending ? "Creating..." : "Create Main Set"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Main Sets ({mainSets.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {mainSets.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No main sets found. Create your first main set to get started.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead>Thumbnail</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mainSets.map((mainSet: MainSet) => (
                  <TableRow key={mainSet.id}>
                    <TableCell className="font-medium">{mainSet.name}</TableCell>
                    <TableCell className="max-w-xs truncate">
                      {mainSet.notes || "—"}
                    </TableCell>
                    <TableCell>
                      {mainSet.thumbnailImageUrl ? (
                        <div className="flex items-center space-x-2">
                          <img
                            src={mainSet.thumbnailImageUrl}
                            alt={mainSet.name}
                            className="w-8 h-8 object-cover rounded"
                          />
                          <ExternalLink className="w-3 h-3 text-muted-foreground" />
                        </div>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      {new Date(mainSet.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end space-x-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEdit(mainSet)}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDelete(mainSet.id)}
                          className="text-red-600 hover:text-red-700"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={!!editingMainSet} onOpenChange={() => setEditingMainSet(null)}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit Main Set</DialogTitle>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4">
              <FormField
                control={editForm.control}
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
                control={editForm.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Enter any notes about this main set"
                        className="resize-none"
                        rows={3}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={editForm.control}
                name="thumbnailImageUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Thumbnail Image URL</FormLabel>
                    <FormControl>
                      <Input placeholder="https://example.com/image.jpg" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end space-x-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditingMainSet(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={updateMutation.isPending}
                  className="bg-marvel-red hover:bg-marvel-red/90"
                >
                  {updateMutation.isPending ? "Updating..." : "Update Main Set"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}