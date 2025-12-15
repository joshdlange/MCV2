import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PlusCircle, Upload, FolderPlus, FileText, X } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import type { CardSet, MainSet } from "@shared/schema";

export default function AdminCardManagement() {
  const [activeTab, setActiveTab] = useState("individual");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: cardSets = [] } = useQuery({
    queryKey: ['/api/card-sets'],
    queryFn: async () => {
      const response = await fetch('/api/card-sets');
      if (!response.ok) throw new Error('Failed to fetch card sets');
      return response.json();
    }
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bebas tracking-wide text-gray-900">Card Management</h1>
          <p className="text-gray-600">Add individual cards, create new sets, or upload card data</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-4 bg-gray-100">
          <TabsTrigger value="individual" className="flex items-center gap-2">
            <PlusCircle className="w-4 h-4" />
            Add Individual Card
          </TabsTrigger>
          <TabsTrigger value="set" className="flex items-center gap-2">
            <FolderPlus className="w-4 h-4" />
            Create Card Set
          </TabsTrigger>
          <TabsTrigger value="upload" className="flex items-center gap-2">
            <Upload className="w-4 h-4" />
            Upload CSV
          </TabsTrigger>
          <TabsTrigger value="bulk" className="flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Bulk Import
          </TabsTrigger>
        </TabsList>

        <TabsContent value="individual" className="space-y-6">
          <Card className="bg-white border border-gray-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PlusCircle className="w-5 h-5 text-marvel-red" />
                Add Individual Card
              </CardTitle>
            </CardHeader>
            <CardContent>
              <AddCardForm cardSets={cardSets} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="set" className="space-y-6">
          <Card className="bg-white border border-gray-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FolderPlus className="w-5 h-5 text-marvel-red" />
                Create New Card Set
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CreateSetForm />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="upload" className="space-y-6">
          <Card className="bg-white border border-gray-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="w-5 h-5 text-marvel-red" />
                Upload Cards from CSV
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CSVUploadForm cardSets={cardSets} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bulk" className="space-y-6">
          <Card className="bg-white border border-gray-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-marvel-red" />
                Bulk Import Master Spreadsheet
              </CardTitle>
            </CardHeader>
            <CardContent>
              <BulkImportForm />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AddCardForm({ cardSets }: { cardSets: CardSet[] }) {
  const [formData, setFormData] = useState({
    setId: '',
    name: '',
    cardNumber: '',
    rarity: '',
    isInsert: false,
    frontImageUrl: '',
    backImageUrl: '',
    estimatedValue: '',
    description: ''
  });

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const createCardMutation = useMutation({
    mutationFn: async (cardData: any) => {
      return apiRequest('POST', '/api/cards', {
        ...cardData,
        setId: parseInt(cardData.setId),
        estimatedValue: cardData.estimatedValue || null
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/cards'] });
      toast({ title: "Card created successfully" });
      setFormData({
        setId: '',
        name: '',
        cardNumber: '',
        rarity: '',
        isInsert: false,
        frontImageUrl: '',
        backImageUrl: '',
        estimatedValue: '',
        description: ''
      });
    },
    onError: () => {
      toast({ title: "Failed to create card", variant: "destructive" });
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.setId || !formData.name || !formData.cardNumber || !formData.rarity) {
      toast({ title: "Please fill in all required fields", variant: "destructive" });
      return;
    }
    createCardMutation.mutate(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="setId">Card Set *</Label>
          <Select value={formData.setId} onValueChange={(value) => setFormData({ ...formData, setId: value })}>
            <SelectTrigger className="bg-white border-gray-200">
              <SelectValue placeholder="Select a card set" />
            </SelectTrigger>
            <SelectContent>
              {cardSets.map((set) => (
                <SelectItem key={set.id} value={set.id.toString()}>
                  {set.name} ({set.year})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="name">Card Name *</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="Enter card name"
            className="bg-white border-gray-200"
            required
          />
        </div>

        <div>
          <Label htmlFor="cardNumber">Card Number *</Label>
          <Input
            id="cardNumber"
            value={formData.cardNumber}
            onChange={(e) => setFormData({ ...formData, cardNumber: e.target.value })}
            placeholder="e.g., 001, SP1"
            className="bg-white border-gray-200"
            required
          />
        </div>

        <div>
          <Label htmlFor="rarity">Rarity *</Label>
          <Select value={formData.rarity} onValueChange={(value) => setFormData({ ...formData, rarity: value })}>
            <SelectTrigger className="bg-white border-gray-200">
              <SelectValue placeholder="Select rarity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Common">Common</SelectItem>
              <SelectItem value="Uncommon">Uncommon</SelectItem>
              <SelectItem value="Rare">Rare</SelectItem>
              <SelectItem value="Ultra Rare">Ultra Rare</SelectItem>
              <SelectItem value="Legendary">Legendary</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="estimatedValue">Estimated Value ($)</Label>
          <Input
            id="estimatedValue"
            type="number"
            step="0.01"
            value={formData.estimatedValue}
            onChange={(e) => setFormData({ ...formData, estimatedValue: e.target.value })}
            placeholder="0.00"
            className="bg-white border-gray-200"
          />
        </div>

        <div className="flex items-center space-x-2">
          <Switch
            id="isInsert"
            checked={formData.isInsert}
            onCheckedChange={(checked) => setFormData({ ...formData, isInsert: checked })}
          />
          <Label htmlFor="isInsert">Insert Card</Label>
        </div>
      </div>

      <div>
        <Label htmlFor="frontImageUrl">Front Image URL</Label>
        <Input
          id="frontImageUrl"
          value={formData.frontImageUrl}
          onChange={(e) => setFormData({ ...formData, frontImageUrl: e.target.value })}
          placeholder="https://example.com/card-front.jpg"
          className="bg-white border-gray-200"
        />
      </div>

      <div>
        <Label htmlFor="backImageUrl">Back Image URL</Label>
        <Input
          id="backImageUrl"
          value={formData.backImageUrl}
          onChange={(e) => setFormData({ ...formData, backImageUrl: e.target.value })}
          placeholder="https://example.com/card-back.jpg"
          className="bg-white border-gray-200"
        />
      </div>

      <div>
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          placeholder="Card description or special notes"
          className="bg-white border-gray-200"
          rows={3}
        />
      </div>

      <Button 
        type="submit" 
        disabled={createCardMutation.isPending}
        className="bg-marvel-red hover:bg-red-700 text-white"
      >
        <PlusCircle className="w-4 h-4 mr-2" />
        {createCardMutation.isPending ? "Creating..." : "Create Card"}
      </Button>
    </form>
  );
}

function CreateSetForm() {
  const [formData, setFormData] = useState({
    name: '',
    year: new Date().getFullYear(),
    description: '',
    totalCards: '',
    mainSetId: '' as string | number
  });

  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch main sets for the dropdown
  const { data: mainSets = [] } = useQuery<MainSet[]>({
    queryKey: ['/api/main-sets'],
  });

  const createSetMutation = useMutation({
    mutationFn: async (setData: any) => {
      return apiRequest('POST', '/api/card-sets', {
        ...setData,
        year: parseInt(setData.year.toString()),
        totalCards: parseInt(setData.totalCards) || 0,
        mainSetId: setData.mainSetId ? parseInt(setData.mainSetId.toString()) : null
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/card-sets'] });
      queryClient.invalidateQueries({ queryKey: ['/api/main-sets'] });
      toast({ title: "Card set created successfully" });
      setFormData({
        name: '',
        year: new Date().getFullYear(),
        description: '',
        totalCards: '',
        mainSetId: ''
      });
    },
    onError: () => {
      toast({ title: "Failed to create card set", variant: "destructive" });
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) {
      toast({ title: "Please enter a set name", variant: "destructive" });
      return;
    }
    createSetMutation.mutate(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="setName">Set Name *</Label>
          <Input
            id="setName"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="e.g., 1992 SkyBox Marvel Masterpieces"
            className="bg-white border-gray-200"
            required
          />
        </div>

        <div>
          <Label htmlFor="year">Year *</Label>
          <Input
            id="year"
            type="number"
            value={formData.year}
            onChange={(e) => setFormData({ ...formData, year: parseInt(e.target.value) || new Date().getFullYear() })}
            className="bg-white border-gray-200"
            required
          />
        </div>

        <div>
          <Label htmlFor="totalCards">Total Cards</Label>
          <Input
            id="totalCards"
            type="number"
            value={formData.totalCards}
            onChange={(e) => setFormData({ ...formData, totalCards: e.target.value })}
            placeholder="e.g., 100"
            className="bg-white border-gray-200"
          />
        </div>

        <div>
          <Label htmlFor="mainSet">Main Set (Optional)</Label>
          <Select
            value={formData.mainSetId?.toString() || "none"}
            onValueChange={(value) => setFormData({ ...formData, mainSetId: value === "none" ? '' : value })}
          >
            <SelectTrigger className="bg-white border-gray-200">
              <SelectValue placeholder="Select a main set (optional)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None (Standalone Set)</SelectItem>
              {mainSets.map((mainSet) => (
                <SelectItem key={mainSet.id} value={mainSet.id.toString()}>
                  {mainSet.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-gray-500 mt-1">
            Leave empty for a standalone set, or select a main set to create a subset
          </p>
        </div>
      </div>

      <div>
        <Label htmlFor="setDescription">Description</Label>
        <Textarea
          id="setDescription"
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          placeholder="Description of the card set"
          className="bg-white border-gray-200"
          rows={3}
        />
      </div>

      <Button 
        type="submit" 
        disabled={createSetMutation.isPending}
        className="bg-marvel-red hover:bg-red-700 text-white"
      >
        <FolderPlus className="w-4 h-4 mr-2" />
        {createSetMutation.isPending ? "Creating..." : "Create Set"}
      </Button>
    </form>
  );
}

function CSVUploadForm({ cardSets }: { cardSets: CardSet[] }) {
  const [selectedSet, setSelectedSet] = useState('');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === 'text/csv') {
      setCsvFile(file);
    } else {
      toast({ title: "Please select a valid CSV file", variant: "destructive" });
    }
  };

  const handleUpload = async () => {
    if (!csvFile || !selectedSet) {
      toast({ title: "Please select a set and CSV file", variant: "destructive" });
      return;
    }

    if (!user) {
      toast({ title: "You must be logged in", variant: "destructive" });
      return;
    }

    setIsUploading(true);
    try {
      const token = await user.getIdToken();
      const formData = new FormData();
      formData.append('file', csvFile);
      formData.append('setId', selectedSet);

      const response = await fetch('/api/cards/upload-csv', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });

      const result = await response.json();

      if (response.ok) {
        // Invalidate cards cache to refresh the data
        queryClient.invalidateQueries({ queryKey: ['/api/cards'] });
        
        let message = result.message;
        if (result.errors && result.errors.length > 0) {
          message += ` ${result.errors.length} rows had errors.`;
        }
        
        toast({ title: message });
        setCsvFile(null);
        setSelectedSet('');
        // Reset file input
        const fileInput = document.getElementById('csvFile') as HTMLInputElement;
        if (fileInput) fileInput.value = '';
      } else {
        throw new Error(result.message || 'Upload failed');
      }
    } catch (error) {
      toast({ 
        title: "Failed to upload CSV", 
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive" 
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 className="font-medium text-blue-900 mb-2">CSV Format Requirements:</h4>
        <div className="text-sm text-blue-800 space-y-1">
          <p>Your CSV file should include the following columns:</p>
          <code className="block bg-blue-100 p-2 rounded text-xs">
            name,cardNumber,isInsert,rarity,frontImageUrl,backImageUrl,description,price
          </code>
          <p className="mt-2"><strong>Required:</strong> name, cardNumber, isInsert (true/false)</p>
          <p><strong>Optional:</strong> rarity, frontImageUrl, backImageUrl, description, price</p>
          <p className="mt-2"><strong>Price field:</strong> If provided, will populate price cache and skip eBay lookup. Leave empty to fetch from eBay.</p>
        </div>
      </div>

      <div>
        <Label htmlFor="uploadSet">Target Card Set *</Label>
        <Select value={selectedSet} onValueChange={setSelectedSet}>
          <SelectTrigger className="bg-white border-gray-200">
            <SelectValue placeholder="Select a card set to add cards to" />
          </SelectTrigger>
          <SelectContent>
            {cardSets.map((set) => (
              <SelectItem key={set.id} value={set.id.toString()}>
                {set.name} ({set.year})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="csvFile">CSV File *</Label>
        <Input
          id="csvFile"
          type="file"
          accept=".csv"
          onChange={handleFileChange}
          className="bg-white border-gray-200"
        />
        {csvFile && (
          <div className="mt-2 flex items-center gap-2 text-sm text-gray-600">
            <FileText className="w-4 h-4" />
            {csvFile.name}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setCsvFile(null);
                const fileInput = document.getElementById('csvFile') as HTMLInputElement;
                if (fileInput) fileInput.value = '';
              }}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>

      <Button 
        onClick={handleUpload}
        disabled={!csvFile || !selectedSet || isUploading}
        className="bg-marvel-red hover:bg-red-700 text-white"
      >
        <Upload className="w-4 h-4 mr-2" />
        {isUploading ? "Uploading..." : "Upload CSV"}
      </Button>
    </div>
  );
}

function BulkImportForm() {
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStats, setUploadStats] = useState<{
    totalRows: number;
    setsCreated: number;
    cardsAdded: number;
    errors: string[];
  } | null>(null);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === 'text/csv') {
      setCsvFile(file);
      setUploadStats(null);
    } else {
      toast({
        title: "Invalid file type",
        description: "Please select a CSV file",
        variant: "destructive"
      });
    }
  };

  const handleBulkUpload = async () => {
    if (!csvFile) return;
    
    setIsUploading(true);
    setUploadStats(null);

    try {
      const formData = new FormData();
      formData.append('file', csvFile);

      const response = await fetch('/api/cards/upload-csv-enhanced', {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || 'Upload failed');
      }

      // Enhanced endpoint returns immediate response, processing happens in background
      setUploadStats({
        totalRows: result.totalRows,
        setsCreated: 0,
        cardsAdded: 0,
        errors: []
      });
      
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['/api/card-sets'] });
      queryClient.invalidateQueries({ queryKey: ['/api/cards'] });
      
      toast({
        title: "Bulk Import Started!",
        description: `Processing ${result.totalRows} rows in background. Check server logs for progress.`
      });

      // Reset form
      setCsvFile(null);
      const fileInput = document.getElementById('bulk-csv-input') as HTMLInputElement;
      if (fileInput) fileInput.value = '';

    } catch (error: any) {
      toast({
        title: "Upload Failed",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 className="font-semibold text-blue-900 mb-2">Enhanced Bulk Import Instructions</h4>
        <div className="text-sm text-blue-800 space-y-1">
          <p>• Upload a master CSV with <strong>SET</strong> and <strong>Year</strong> columns</p>
          <p>• Sets will be auto-created from unique SET + Year combinations</p>
          <p>• <strong>NEW:</strong> Supports your exact CSV format with proper column mapping</p>
          <p>• All cards will be grouped by set and imported in batches of 1000</p>
          <p>• <strong>Required columns:</strong> SET, Year, name, cardNumber</p>
          <p>• <strong>Optional:</strong> IsInsert, Image, description, Price</p>
          <p className="text-blue-700 font-medium mt-2">• Optimized for massive datasets (handles 80,000+ rows efficiently)</p>
          <p className="text-blue-700">• Background processing with immediate response and progress logging</p>
          <p className="text-green-700 font-medium">• Automatically skips duplicate cards and preserves existing sets</p>
          <p className="text-orange-700 font-medium">• Fixed column mapping - your CSV format is now fully supported!</p>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="bulk-csv-input">Select Master CSV File</Label>
          <Input
            id="bulk-csv-input"
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="mt-1"
          />
          {csvFile && (
            <p className="text-sm text-gray-600 mt-1">
              Selected: {csvFile.name} ({(csvFile.size / 1024).toFixed(1)} KB)
            </p>
          )}
        </div>

        {uploadStats && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <h4 className="font-semibold text-green-900 mb-2">Import Results</h4>
            <div className="text-sm text-green-800 space-y-1">
              <p>• Processed {uploadStats.totalRows} rows</p>
              <p>• Created {uploadStats.setsCreated} new sets</p>
              <p>• Added {uploadStats.cardsAdded} cards</p>
              {uploadStats.errors.length > 0 && (
                <div className="mt-2">
                  <p className="text-red-700 font-medium">Errors:</p>
                  <ul className="text-red-600 text-xs mt-1">
                    {uploadStats.errors.slice(0, 5).map((error, index) => (
                      <li key={index}>• {error}</li>
                    ))}
                    {uploadStats.errors.length > 5 && (
                      <li>• ... and {uploadStats.errors.length - 5} more</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <Button 
        onClick={handleBulkUpload}
        disabled={!csvFile || isUploading}
        className="bg-marvel-red hover:bg-red-700 text-white"
      >
        <FileText className="w-4 h-4 mr-2" />
        {isUploading ? "Processing..." : "Start Bulk Import"}
      </Button>
    </div>
  );
}