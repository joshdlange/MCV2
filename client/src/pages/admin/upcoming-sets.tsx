import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Edit, Trash2, Plus, Calendar, Eye, EyeOff, Link as LinkIcon, CheckCircle, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface UpcomingSet {
  id: number;
  name: string;
  manufacturer: string | null;
  productLine: string | null;
  publisher: string | null;
  releaseDateEstimated: string | null;
  dateConfidence: 'estimated' | 'confirmed' | null;
  status: 'upcoming' | 'delayed' | 'released';
  format: string | null;
  configuration: string | null;
  msrp: string | null;
  description: string | null;
  keyHighlights: string | null;
  checklistUrl: string | null;
  sourceUrl: string | null;
  thumbnailUrl: string | null;
  interestCount: number;
  isActive: boolean;
  lastVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function AdminUpcomingSets() {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
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
    mutationFn: async (setData: Partial<UpcomingSet>) => {
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
    mutationFn: async ({ id, ...setData }: Partial<UpcomingSet> & { id: number }) => {
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

  const markReleasedMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest('POST', `/api/admin/upcoming-sets/${id}/mark-released`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/upcoming-sets'] });
      toast({ title: "Set marked as released" });
    },
    onError: () => {
      toast({ title: "Failed to mark set as released", variant: "destructive" });
    }
  });

  const handleDeleteSet = (set: UpcomingSet) => {
    if (confirm(`Are you sure you want to delete "${set.name}"? This action cannot be undone.`)) {
      deleteSetMutation.mutate(set.id);
    }
  };

  const handleMarkReleased = (set: UpcomingSet) => {
    if (confirm(`Mark "${set.name}" as released? This will update its status and remove it from upcoming displays.`)) {
      markReleasedMutation.mutate(set.id);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bebas tracking-wide text-gray-900">Upcoming Sets Tracker</h1>
          <p className="text-gray-600">Manage upcoming Marvel card set releases</p>
        </div>
        
        <div className="flex gap-3">
          <Dialog open={isImportOpen} onOpenChange={setIsImportOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="border-marvel-red text-marvel-red hover:bg-red-50" data-testid="button-import-url">
                <LinkIcon className="w-4 h-4 mr-2" />
                Import from URL
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Import Set from URL</DialogTitle>
              </DialogHeader>
              <ImportFromUrlForm 
                onSuccess={(previewData) => {
                  createSetMutation.mutate(previewData);
                  setIsImportOpen(false);
                }}
              />
            </DialogContent>
          </Dialog>

          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="bg-marvel-red hover:bg-red-700" data-testid="button-create-set">
                <Plus className="w-4 h-4 mr-2" />
                Add Manually
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create Upcoming Set</DialogTitle>
              </DialogHeader>
              <CreateSetForm onSubmit={createSetMutation.mutate} isLoading={createSetMutation.isPending} />
            </DialogContent>
          </Dialog>
        </div>
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
              {set.thumbnailUrl && (
                <div className="aspect-video bg-gray-100 overflow-hidden">
                  <img src={set.thumbnailUrl} alt={set.name} className="w-full h-full object-cover" />
                </div>
              )}
              <div className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-lg font-semibold text-gray-900" data-testid={`text-setname-${set.id}`}>{set.name}</h3>
                  <div className="flex gap-1">
                    <Badge className={
                      set.status === 'upcoming' ? "bg-blue-100 text-blue-800 border-blue-300" :
                      set.status === 'delayed' ? "bg-yellow-100 text-yellow-800 border-yellow-300" :
                      "bg-gray-100 text-gray-800 border-gray-300"
                    }>
                      {set.status}
                    </Badge>
                    {!set.isActive && (
                      <Badge className="bg-gray-100 text-gray-800 border-gray-300">
                        <EyeOff className="w-3 h-3 mr-1" />
                        Hidden
                      </Badge>
                    )}
                  </div>
                </div>
                
                {set.manufacturer && (
                  <p className="text-sm text-gray-600">
                    <span className="font-medium">Manufacturer:</span> {set.manufacturer}
                  </p>
                )}

                {set.productLine && (
                  <p className="text-sm text-gray-600">
                    <span className="font-medium">Product Line:</span> {set.productLine}
                  </p>
                )}
                
                {set.releaseDateEstimated && (
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center text-gray-600">
                      <Calendar className="w-4 h-4 mr-1" />
                      {new Date(set.releaseDateEstimated).toLocaleDateString()}
                    </div>
                    {set.dateConfidence && (
                      <Badge variant="outline" className="text-xs">
                        {set.dateConfidence}
                      </Badge>
                    )}
                  </div>
                )}

                {set.msrp && (
                  <p className="text-sm font-medium text-green-700">
                    MSRP: ${set.msrp}
                  </p>
                )}

                {set.interestCount > 0 && (
                  <p className="text-sm text-marvel-red font-medium">
                    {set.interestCount} {set.interestCount === 1 ? 'collector' : 'collectors'} interested
                  </p>
                )}
                
                {set.description && (
                  <p className="text-sm text-gray-700 line-clamp-2">{set.description}</p>
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
                  {set.status !== 'released' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleMarkReleased(set)}
                      disabled={markReleasedMutation.isPending}
                      data-testid={`button-mark-released-${set.id}`}
                    >
                      <CheckCircle className="w-4 h-4" />
                    </Button>
                  )}
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
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
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

function ImportFromUrlForm({ onSuccess }: { onSuccess: (data: any) => void }) {
  const [sourceUrl, setSourceUrl] = useState('');
  const [previewData, setPreviewData] = useState<any>(null);
  const [isImporting, setIsImporting] = useState(false);
  const { toast } = useToast();

  const handleImport = async () => {
    if (!sourceUrl.trim()) {
      toast({ title: "Please enter a URL", variant: "destructive" });
      return;
    }

    setIsImporting(true);
    try {
      const response = await apiRequest('POST', '/api/admin/upcoming-sets/import', { sourceUrl });
      const result = await response.json();
      
      if (result.preview) {
        setPreviewData(result.preview);
        toast({ title: "Metadata imported successfully! Please review and confirm." });
      }
    } catch (error) {
      toast({ 
        title: "Failed to import from URL", 
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive" 
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleConfirm = () => {
    if (previewData) {
      onSuccess(previewData);
      setSourceUrl('');
      setPreviewData(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="sourceUrl">Source URL</Label>
        <div className="flex gap-2">
          <Input
            id="sourceUrl"
            type="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://example.com/article-about-new-set"
            className="bg-white flex-1"
            data-testid="input-import-url"
            disabled={isImporting || !!previewData}
          />
          {!previewData && (
            <Button 
              onClick={handleImport} 
              disabled={isImporting}
              data-testid="button-import-scrape"
            >
              {isImporting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Importing...
                </>
              ) : (
                'Import'
              )}
            </Button>
          )}
        </div>
        <p className="text-sm text-gray-500">
          Paste a URL to an article or page about the upcoming set. We'll automatically extract the title, image, and description.
        </p>
      </div>

      {previewData && (
        <div className="border border-green-200 bg-green-50 rounded-lg p-4 space-y-4">
          <div className="flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
            <div className="flex-1 space-y-3">
              <h4 className="font-semibold text-green-900">Preview Imported Data</h4>
              
              {previewData.thumbnailUrl && (
                <div className="aspect-video bg-gray-100 rounded overflow-hidden max-w-sm">
                  <img src={previewData.thumbnailUrl} alt="Preview" className="w-full h-full object-cover" />
                </div>
              )}

              <div className="space-y-2 text-sm">
                {previewData.name && (
                  <p><span className="font-medium">Name:</span> {previewData.name}</p>
                )}
                {previewData.description && (
                  <p><span className="font-medium">Description:</span> {previewData.description}</p>
                )}
                {previewData.sourceUrl && (
                  <p className="truncate">
                    <span className="font-medium">Source:</span>{' '}
                    <a href={previewData.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                      {previewData.sourceUrl}
                    </a>
                  </p>
                )}
              </div>

              <div className="flex gap-2 pt-2">
                <Button 
                  onClick={handleConfirm}
                  className="bg-green-600 hover:bg-green-700"
                  data-testid="button-confirm-import"
                >
                  Confirm & Create
                </Button>
                <Button 
                  variant="outline"
                  onClick={() => {
                    setPreviewData(null);
                    setSourceUrl('');
                  }}
                  data-testid="button-cancel-import"
                >
                  Start Over
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CreateSetForm({ onSubmit, isLoading }: { onSubmit: (data: any) => void; isLoading: boolean }) {
  const [formData, setFormData] = useState({
    name: '',
    manufacturer: '',
    productLine: '',
    publisher: '',
    releaseDateEstimated: '',
    dateConfidence: 'estimated' as 'estimated' | 'confirmed',
    status: 'upcoming' as 'upcoming' | 'delayed' | 'released',
    format: '',
    configuration: '',
    msrp: '',
    description: '',
    keyHighlights: '',
    checklistUrl: '',
    sourceUrl: '',
    thumbnailUrl: '',
    isActive: true
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const submitData: any = { name: formData.name, isActive: formData.isActive };
    
    if (formData.manufacturer) submitData.manufacturer = formData.manufacturer;
    if (formData.productLine) submitData.productLine = formData.productLine;
    if (formData.publisher) submitData.publisher = formData.publisher;
    if (formData.releaseDateEstimated) submitData.releaseDateEstimated = formData.releaseDateEstimated;
    if (formData.dateConfidence) submitData.dateConfidence = formData.dateConfidence;
    submitData.status = formData.status;
    if (formData.format) submitData.format = formData.format;
    if (formData.configuration) submitData.configuration = formData.configuration;
    if (formData.msrp) submitData.msrp = formData.msrp;
    if (formData.description) submitData.description = formData.description;
    if (formData.keyHighlights) submitData.keyHighlights = formData.keyHighlights;
    if (formData.checklistUrl) submitData.checklistUrl = formData.checklistUrl;
    if (formData.sourceUrl) submitData.sourceUrl = formData.sourceUrl;
    if (formData.thumbnailUrl) submitData.thumbnailUrl = formData.thumbnailUrl;
    
    onSubmit(submitData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Tabs defaultValue="basic" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="basic">Basic Info</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="media">Media & Links</TabsTrigger>
        </TabsList>

        <TabsContent value="basic" className="space-y-4 mt-4">
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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="manufacturer">Manufacturer</Label>
              <Input
                id="manufacturer"
                value={formData.manufacturer}
                onChange={(e) => setFormData({ ...formData, manufacturer: e.target.value })}
                placeholder="e.g., Upper Deck"
                className="bg-white"
                data-testid="input-manufacturer"
              />
            </div>

            <div>
              <Label htmlFor="productLine">Product Line</Label>
              <Input
                id="productLine"
                value={formData.productLine}
                onChange={(e) => setFormData({ ...formData, productLine: e.target.value })}
                placeholder="e.g., Marvel Masterpieces"
                className="bg-white"
                data-testid="input-productline"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="publisher">Publisher</Label>
            <Input
              id="publisher"
              value={formData.publisher}
              onChange={(e) => setFormData({ ...formData, publisher: e.target.value })}
              placeholder="e.g., Marvel Comics"
              className="bg-white"
              data-testid="input-publisher"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="releaseDateEstimated">Release Date</Label>
              <Input
                id="releaseDateEstimated"
                type="date"
                value={formData.releaseDateEstimated}
                onChange={(e) => setFormData({ ...formData, releaseDateEstimated: e.target.value })}
                className="bg-white"
                data-testid="input-releasedate"
              />
            </div>

            <div>
              <Label htmlFor="dateConfidence">Date Confidence</Label>
              <Select value={formData.dateConfidence} onValueChange={(value: any) => setFormData({ ...formData, dateConfidence: value })}>
                <SelectTrigger className="bg-white" data-testid="select-dateconfidence">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="estimated">Estimated</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="status">Status</Label>
            <Select value={formData.status} onValueChange={(value: any) => setFormData({ ...formData, status: value })}>
              <SelectTrigger className="bg-white" data-testid="select-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="upcoming">Upcoming</SelectItem>
                <SelectItem value="delayed">Delayed</SelectItem>
                <SelectItem value="released">Released</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </TabsContent>

        <TabsContent value="details" className="space-y-4 mt-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="format">Format</Label>
              <Input
                id="format"
                value={formData.format}
                onChange={(e) => setFormData({ ...formData, format: e.target.value })}
                placeholder="e.g., Hobby Box"
                className="bg-white"
                data-testid="input-format"
              />
            </div>

            <div>
              <Label htmlFor="configuration">Configuration</Label>
              <Input
                id="configuration"
                value={formData.configuration}
                onChange={(e) => setFormData({ ...formData, configuration: e.target.value })}
                placeholder="e.g., 24 packs/box"
                className="bg-white"
                data-testid="input-configuration"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="msrp">MSRP (USD)</Label>
            <Input
              id="msrp"
              type="number"
              step="0.01"
              value={formData.msrp}
              onChange={(e) => setFormData({ ...formData, msrp: e.target.value })}
              placeholder="99.99"
              className="bg-white"
              data-testid="input-msrp"
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

          <div>
            <Label htmlFor="keyHighlights">Key Highlights (Markdown)</Label>
            <Textarea
              id="keyHighlights"
              value={formData.keyHighlights}
              onChange={(e) => setFormData({ ...formData, keyHighlights: e.target.value })}
              rows={6}
              placeholder="- Exclusive variant covers&#10;- Limited edition chase cards&#10;- Artist signatures"
              className="bg-white font-mono text-sm"
              data-testid="input-keyhighlights"
            />
          </div>
        </TabsContent>

        <TabsContent value="media" className="space-y-4 mt-4">
          <div>
            <Label htmlFor="thumbnailUrl">Thumbnail Image URL</Label>
            <Input
              id="thumbnailUrl"
              type="url"
              value={formData.thumbnailUrl}
              onChange={(e) => setFormData({ ...formData, thumbnailUrl: e.target.value })}
              placeholder="https://example.com/image.jpg"
              className="bg-white"
              data-testid="input-thumbnailurl"
            />
          </div>

          <div>
            <Label htmlFor="checklistUrl">Checklist URL</Label>
            <Input
              id="checklistUrl"
              type="url"
              value={formData.checklistUrl}
              onChange={(e) => setFormData({ ...formData, checklistUrl: e.target.value })}
              placeholder="https://example.com/checklist"
              className="bg-white"
              data-testid="input-checklisturl"
            />
          </div>

          <div>
            <Label htmlFor="sourceUrl">Source URL</Label>
            <Input
              id="sourceUrl"
              type="url"
              value={formData.sourceUrl}
              onChange={(e) => setFormData({ ...formData, sourceUrl: e.target.value })}
              placeholder="https://example.com/announcement"
              className="bg-white"
              data-testid="input-sourceurl"
            />
          </div>

          <div className="flex items-center space-x-2 pt-4">
            <Switch
              id="isActive"
              checked={formData.isActive}
              onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
              data-testid="switch-active"
            />
            <Label htmlFor="isActive">Make visible to public</Label>
          </div>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end gap-2 pt-4 border-t">
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
    manufacturer: set.manufacturer || '',
    productLine: set.productLine || '',
    publisher: set.publisher || '',
    releaseDateEstimated: set.releaseDateEstimated ? new Date(set.releaseDateEstimated).toISOString().split('T')[0] : '',
    dateConfidence: (set.dateConfidence || 'estimated') as 'estimated' | 'confirmed',
    status: set.status as 'upcoming' | 'delayed' | 'released',
    format: set.format || '',
    configuration: set.configuration || '',
    msrp: set.msrp || '',
    description: set.description || '',
    keyHighlights: set.keyHighlights || '',
    checklistUrl: set.checklistUrl || '',
    sourceUrl: set.sourceUrl || '',
    thumbnailUrl: set.thumbnailUrl || '',
    isActive: set.isActive
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const submitData: any = { name: formData.name, isActive: formData.isActive };
    
    if (formData.manufacturer) submitData.manufacturer = formData.manufacturer;
    if (formData.productLine) submitData.productLine = formData.productLine;
    if (formData.publisher) submitData.publisher = formData.publisher;
    if (formData.releaseDateEstimated) submitData.releaseDateEstimated = formData.releaseDateEstimated;
    if (formData.dateConfidence) submitData.dateConfidence = formData.dateConfidence;
    submitData.status = formData.status;
    if (formData.format) submitData.format = formData.format;
    if (formData.configuration) submitData.configuration = formData.configuration;
    if (formData.msrp) submitData.msrp = formData.msrp;
    if (formData.description) submitData.description = formData.description;
    if (formData.keyHighlights) submitData.keyHighlights = formData.keyHighlights;
    if (formData.checklistUrl) submitData.checklistUrl = formData.checklistUrl;
    if (formData.sourceUrl) submitData.sourceUrl = formData.sourceUrl;
    if (formData.thumbnailUrl) submitData.thumbnailUrl = formData.thumbnailUrl;
    
    onSubmit(submitData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Tabs defaultValue="basic" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="basic">Basic Info</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="media">Media & Links</TabsTrigger>
        </TabsList>

        <TabsContent value="basic" className="space-y-4 mt-4">
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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="manufacturer" className="text-black">Manufacturer</Label>
              <Input
                id="manufacturer"
                value={formData.manufacturer}
                onChange={(e) => setFormData({ ...formData, manufacturer: e.target.value })}
                className="bg-white text-black"
              />
            </div>

            <div>
              <Label htmlFor="productLine" className="text-black">Product Line</Label>
              <Input
                id="productLine"
                value={formData.productLine}
                onChange={(e) => setFormData({ ...formData, productLine: e.target.value })}
                className="bg-white text-black"
              />
            </div>
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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="releaseDateEstimated" className="text-black">Release Date</Label>
              <Input
                id="releaseDateEstimated"
                type="date"
                value={formData.releaseDateEstimated}
                onChange={(e) => setFormData({ ...formData, releaseDateEstimated: e.target.value })}
                className="bg-white text-black"
              />
            </div>

            <div>
              <Label htmlFor="dateConfidence" className="text-black">Date Confidence</Label>
              <Select value={formData.dateConfidence} onValueChange={(value: any) => setFormData({ ...formData, dateConfidence: value })}>
                <SelectTrigger className="bg-white text-black">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="estimated">Estimated</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="status" className="text-black">Status</Label>
            <Select value={formData.status} onValueChange={(value: any) => setFormData({ ...formData, status: value })}>
              <SelectTrigger className="bg-white text-black">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="upcoming">Upcoming</SelectItem>
                <SelectItem value="delayed">Delayed</SelectItem>
                <SelectItem value="released">Released</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </TabsContent>

        <TabsContent value="details" className="space-y-4 mt-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="format" className="text-black">Format</Label>
              <Input
                id="format"
                value={formData.format}
                onChange={(e) => setFormData({ ...formData, format: e.target.value })}
                className="bg-white text-black"
              />
            </div>

            <div>
              <Label htmlFor="configuration" className="text-black">Configuration</Label>
              <Input
                id="configuration"
                value={formData.configuration}
                onChange={(e) => setFormData({ ...formData, configuration: e.target.value })}
                className="bg-white text-black"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="msrp" className="text-black">MSRP (USD)</Label>
            <Input
              id="msrp"
              type="number"
              step="0.01"
              value={formData.msrp}
              onChange={(e) => setFormData({ ...formData, msrp: e.target.value })}
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

          <div>
            <Label htmlFor="keyHighlights" className="text-black">Key Highlights (Markdown)</Label>
            <Textarea
              id="keyHighlights"
              value={formData.keyHighlights}
              onChange={(e) => setFormData({ ...formData, keyHighlights: e.target.value })}
              rows={6}
              className="bg-white text-black font-mono text-sm"
            />
          </div>
        </TabsContent>

        <TabsContent value="media" className="space-y-4 mt-4">
          <div>
            <Label htmlFor="thumbnailUrl" className="text-black">Thumbnail Image URL</Label>
            <Input
              id="thumbnailUrl"
              type="url"
              value={formData.thumbnailUrl}
              onChange={(e) => setFormData({ ...formData, thumbnailUrl: e.target.value })}
              className="bg-white text-black"
            />
          </div>

          <div>
            <Label htmlFor="checklistUrl" className="text-black">Checklist URL</Label>
            <Input
              id="checklistUrl"
              type="url"
              value={formData.checklistUrl}
              onChange={(e) => setFormData({ ...formData, checklistUrl: e.target.value })}
              className="bg-white text-black"
            />
          </div>

          <div>
            <Label htmlFor="sourceUrl" className="text-black">Source URL</Label>
            <Input
              id="sourceUrl"
              type="url"
              value={formData.sourceUrl}
              onChange={(e) => setFormData({ ...formData, sourceUrl: e.target.value })}
              className="bg-white text-black"
            />
          </div>

          <div className="flex items-center space-x-2 pt-4">
            <Switch
              id="isActive"
              checked={formData.isActive}
              onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
            />
            <Label htmlFor="isActive" className="text-black">Make visible to public</Label>
          </div>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end gap-2 pt-4 border-t">
        <Button type="submit" disabled={isLoading} className="bg-marvel-red hover:bg-red-700">
          Update Set
        </Button>
      </div>
    </form>
  );
}
