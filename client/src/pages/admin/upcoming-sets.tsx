import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Edit, Trash2, Plus, Calendar, Eye, EyeOff } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface UpcomingSet {
  id: number;
  name: string;
  publisher: string | null;
  releaseDate: string | null;
  description: string | null;
  imageUrl: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function AdminUpcomingSets() {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selectedSet, setSelectedSet] = useState<UpcomingSet | null>(null);
  
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: upcomingSets = [], isLoading } = useQuery({
    queryKey: ['/api/admin/upcoming-sets'],
    queryFn: async () => {
      return apiRequest('GET', '/api/admin/upcoming-sets').then(res => res.json());
    }
  });

  const createSetMutation = useMutation({
    mutationFn: async (setData: { name: string; publisher?: string; releaseDate?: string; description?: string; imageUrl?: string; isActive: boolean }) => {
      return apiRequest('POST', '/api/admin/upcoming-sets', setData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/upcoming-sets'] });
      toast({ title: "Upcoming set created successfully" });
      setIsCreateOpen(false);
    },
    onError: () => {
      toast({ title: "Failed to create upcoming set", variant: "destructive" });
    }
  });

  const updateSetMutation = useMutation({
    mutationFn: async ({ id, ...setData }: { id: number; name: string; publisher?: string; releaseDate?: string; description?: string; imageUrl?: string; isActive: boolean }) => {
      return apiRequest('PATCH', `/api/admin/upcoming-sets/${id}`, setData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/upcoming-sets'] });
      toast({ title: "Upcoming set updated successfully" });
      setIsEditOpen(false);
      setSelectedSet(null);
    },
    onError: () => {
      toast({ title: "Failed to update upcoming set", variant: "destructive" });
    }
  });

  const deleteSetMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest('DELETE', `/api/admin/upcoming-sets/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/upcoming-sets'] });
      toast({ title: "Upcoming set deleted successfully" });
    },
    onError: () => {
      toast({ title: "Failed to delete upcoming set", variant: "destructive" });
    }
  });

  const handleDeleteSet = (set: UpcomingSet) => {
    if (confirm(`Are you sure you want to delete "${set.name}"? This action cannot be undone.`)) {
      deleteSetMutation.mutate(set.id);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bebas tracking-wide text-gray-900">Upcoming Sets Tracker</h1>
          <p className="text-gray-600">Manage upcoming Marvel card set releases</p>
        </div>
        
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button className="bg-marvel-red hover:bg-red-700" data-testid="button-create-set">
              <Plus className="w-4 h-4 mr-2" />
              Add Upcoming Set
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Upcoming Set</DialogTitle>
            </DialogHeader>
            <CreateSetForm onSubmit={createSetMutation.mutate} isLoading={createSetMutation.isPending} />
          </DialogContent>
        </Dialog>
      </div>

      {/* Sets Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading ? (
          <div className="col-span-full text-center py-12 text-gray-500">
            Loading upcoming sets...
          </div>
        ) : upcomingSets.length === 0 ? (
          <div className="col-span-full text-center py-12 text-gray-500">
            No upcoming sets found. Create one to get started!
          </div>
        ) : (
          upcomingSets.map((set: UpcomingSet) => (
            <div key={set.id} className="bg-white rounded-lg border border-gray-200 overflow-hidden hover:shadow-lg transition-shadow" data-testid={`card-set-${set.id}`}>
              {set.imageUrl && (
                <div className="aspect-video bg-gray-100 overflow-hidden">
                  <img src={set.imageUrl} alt={set.name} className="w-full h-full object-cover" />
                </div>
              )}
              <div className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-lg font-semibold text-gray-900" data-testid={`text-setname-${set.id}`}>{set.name}</h3>
                  <Badge className={set.isActive ? "bg-green-100 text-green-800 border-green-300" : "bg-gray-100 text-gray-800 border-gray-300"}>
                    {set.isActive ? <Eye className="w-3 h-3 mr-1" /> : <EyeOff className="w-3 h-3 mr-1" />}
                    {set.isActive ? 'Active' : 'Hidden'}
                  </Badge>
                </div>
                
                {set.publisher && (
                  <p className="text-sm text-gray-600">Publisher: {set.publisher}</p>
                )}
                
                {set.releaseDate && (
                  <div className="flex items-center text-sm text-gray-600">
                    <Calendar className="w-4 h-4 mr-1" />
                    {new Date(set.releaseDate).toLocaleDateString()}
                  </div>
                )}
                
                {set.description && (
                  <p className="text-sm text-gray-700 line-clamp-3">{set.description}</p>
                )}
                
                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => {
                      setSelectedSet(set);
                      setIsEditOpen(true);
                    }}
                    data-testid={`button-edit-${set.id}`}
                  >
                    <Edit className="w-4 h-4 mr-1" />
                    Edit
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDeleteSet(set)}
                    disabled={deleteSetMutation.isPending}
                    data-testid={`button-delete-${set.id}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Edit Set Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Upcoming Set</DialogTitle>
          </DialogHeader>
          {selectedSet && (
            <EditSetForm 
              set={selectedSet} 
              onSubmit={(data) => updateSetMutation.mutate({ id: selectedSet.id, ...data })}
              isLoading={updateSetMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateSetForm({ onSubmit, isLoading }: { onSubmit: (data: any) => void; isLoading: boolean }) {
  const [formData, setFormData] = useState({
    name: '',
    publisher: '',
    releaseDate: '',
    description: '',
    imageUrl: '',
    isActive: true
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const submitData: any = { name: formData.name, isActive: formData.isActive };
    if (formData.publisher) submitData.publisher = formData.publisher;
    if (formData.releaseDate) submitData.releaseDate = formData.releaseDate;
    if (formData.description) submitData.description = formData.description;
    if (formData.imageUrl) submitData.imageUrl = formData.imageUrl;
    onSubmit(submitData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="name">Set Name *</Label>
        <Input
          id="name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          required
          className="bg-white"
          data-testid="input-setname"
        />
      </div>

      <div>
        <Label htmlFor="publisher">Publisher</Label>
        <Input
          id="publisher"
          value={formData.publisher}
          onChange={(e) => setFormData({ ...formData, publisher: e.target.value })}
          className="bg-white"
          data-testid="input-publisher"
        />
      </div>

      <div>
        <Label htmlFor="releaseDate">Release Date</Label>
        <Input
          id="releaseDate"
          type="date"
          value={formData.releaseDate}
          onChange={(e) => setFormData({ ...formData, releaseDate: e.target.value })}
          className="bg-white"
          data-testid="input-releasedate"
        />
      </div>

      <div>
        <Label htmlFor="imageUrl">Image URL</Label>
        <Input
          id="imageUrl"
          type="url"
          value={formData.imageUrl}
          onChange={(e) => setFormData({ ...formData, imageUrl: e.target.value })}
          placeholder="https://example.com/image.jpg"
          className="bg-white"
          data-testid="input-imageurl"
        />
      </div>

      <div>
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          rows={4}
          className="bg-white"
          data-testid="input-description"
        />
      </div>

      <div className="flex items-center space-x-2">
        <Switch
          id="isActive"
          checked={formData.isActive}
          onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
          data-testid="switch-active"
        />
        <Label htmlFor="isActive">Make visible to public</Label>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={isLoading} className="bg-marvel-red hover:bg-red-700" data-testid="button-submit">
          Create Set
        </Button>
      </div>
    </form>
  );
}

function EditSetForm({ set, onSubmit, isLoading }: { set: UpcomingSet; onSubmit: (data: any) => void; isLoading: boolean }) {
  const [formData, setFormData] = useState({
    name: set.name,
    publisher: set.publisher || '',
    releaseDate: set.releaseDate ? new Date(set.releaseDate).toISOString().split('T')[0] : '',
    description: set.description || '',
    imageUrl: set.imageUrl || '',
    isActive: set.isActive
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const submitData: any = { name: formData.name, isActive: formData.isActive };
    if (formData.publisher) submitData.publisher = formData.publisher;
    if (formData.releaseDate) submitData.releaseDate = formData.releaseDate;
    if (formData.description) submitData.description = formData.description;
    if (formData.imageUrl) submitData.imageUrl = formData.imageUrl;
    onSubmit(submitData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="name" className="text-black">Set Name *</Label>
        <Input
          id="name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          required
          className="bg-white text-black"
        />
      </div>

      <div>
        <Label htmlFor="publisher" className="text-black">Publisher</Label>
        <Input
          id="publisher"
          value={formData.publisher}
          onChange={(e) => setFormData({ ...formData, publisher: e.target.value })}
          className="bg-white text-black"
        />
      </div>

      <div>
        <Label htmlFor="releaseDate" className="text-black">Release Date</Label>
        <Input
          id="releaseDate"
          type="date"
          value={formData.releaseDate}
          onChange={(e) => setFormData({ ...formData, releaseDate: e.target.value })}
          className="bg-white text-black"
        />
      </div>

      <div>
        <Label htmlFor="imageUrl" className="text-black">Image URL</Label>
        <Input
          id="imageUrl"
          type="url"
          value={formData.imageUrl}
          onChange={(e) => setFormData({ ...formData, imageUrl: e.target.value })}
          placeholder="https://example.com/image.jpg"
          className="bg-white text-black"
        />
      </div>

      <div>
        <Label htmlFor="description" className="text-black">Description</Label>
        <Textarea
          id="description"
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          rows={4}
          className="bg-white text-black"
        />
      </div>

      <div className="flex items-center space-x-2">
        <Switch
          id="isActive"
          checked={formData.isActive}
          onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
        />
        <Label htmlFor="isActive" className="text-black">Make visible to public</Label>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={isLoading} className="bg-marvel-red hover:bg-red-700">
          Update Set
        </Button>
      </div>
    </form>
  );
}
