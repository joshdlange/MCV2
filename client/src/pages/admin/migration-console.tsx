import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ArrowRight, Search, Archive, RotateCcw, AlertTriangle, CheckCircle, History, ArrowLeftRight } from "lucide-react";
import SimpleImage from "@/components/ui/simple-image";
import { formatTitle } from "@/lib/formatTitle";

interface CardSet {
  id: number;
  name: string;
  year: number;
  slug: string;
  mainSetId: number | null;
  imageUrl: string | null;
  isActive: boolean;
  isCanonical: boolean;
  isInsertSubset: boolean;
  mainSetName: string | null;
  mainSetThumbnail: string | null;
  cardCount: number;
}

interface SampleCard {
  id: number;
  cardNumber: string;
  name: string;
  variation: string | null;
  isInsert: boolean;
  frontImageUrl: string | null;
  estimatedValue: string | null;
}

interface ConflictInfo {
  cardNumber: string;
  sourceCardId: number;
  sourceCardName: string;
  destCardId: number;
  destCardName: string;
}

interface PreviewResult {
  sourceCardCount: number;
  destinationCardCount: number;
  conflictCount: number;
  conflicts: ConflictInfo[];
  canMigrate: boolean;
  destinationIsInsertSubset: boolean;
  destinationIsCanonical: boolean;
}

interface MigrationLog {
  id: number;
  adminUserId: number;
  sourceSetId: number;
  destinationSetId: number;
  movedCardCount: number;
  insertForced: boolean;
  notes: string | null;
  status: string;
  rolledBackAt: string | null;
  createdAt: string;
  sourceSetName: string;
  destinationSetName: string;
  adminUsername: string;
}

const INSERT_KEYWORDS = ['insert', 'inserts', 'chase', 'sketch', 'autograph', 'signature', 'printing plate', '1/1', 'variant', 'parallel', 'refractor'];

function detectInsertSubset(name: string): boolean {
  const lowerName = name.toLowerCase();
  return INSERT_KEYWORDS.some(keyword => lowerName.includes(keyword));
}

export default function MigrationConsole() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("migrate");
  
  const [sourceSearch, setSourceSearch] = useState("");
  const [sourceYear, setSourceYear] = useState<string>("");
  const [sourceHasCards, setSourceHasCards] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [selectedSource, setSelectedSource] = useState<CardSet | null>(null);
  
  const [destSearch, setDestSearch] = useState("");
  const [destYear, setDestYear] = useState<string>("");
  const [selectedDest, setSelectedDest] = useState<CardSet | null>(null);
  
  const [forceInsert, setForceInsert] = useState(false);
  const [allowConflicts, setAllowConflicts] = useState(false);
  const [conflictConfirmText, setConflictConfirmText] = useState("");
  const [migrationNotes, setMigrationNotes] = useState("");
  
  // New: Main set assignment and name editing during migration
  const [newMainSetId, setNewMainSetId] = useState<number | null>(null);
  const [newSetName, setNewSetName] = useState<string>("");

  // Conflict confirmation requires typing the exact phrase
  const CONFLICT_CONFIRM_PHRASE = "MIGRATE WITH CONFLICTS";
  const conflictConfirmValid = conflictConfirmText.trim() === CONFLICT_CONFIRM_PHRASE;

  // Archive with cards confirmation
  const [archiveConfirmText, setArchiveConfirmText] = useState("");
  const ARCHIVE_CONFIRM_PHRASE = "ARCHIVE WITH CARDS";
  const archiveConfirmValid = archiveConfirmText === ARCHIVE_CONFIRM_PHRASE;

  // Delete set confirmation
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const DELETE_CONFIRM_PHRASE = "DELETE SET";
  const deleteConfirmValid = deleteConfirmText === DELETE_CONFIRM_PHRASE;
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // Promote to canonical confirmation
  const [promoteConfirmText, setPromoteConfirmText] = useState("");
  const PROMOTE_CONFIRM_PHRASE = "PROMOTE TO CANONICAL";
  const promoteConfirmValid = promoteConfirmText === PROMOTE_CONFIRM_PHRASE;
  const [promoteYear, setPromoteYear] = useState<string>("");
  const [promoteMainSetId, setPromoteMainSetId] = useState<number | null>(null);
  const [promoteNewName, setPromoteNewName] = useState<string>("");

  const { data: sourceSetsData, isLoading: sourceLoading } = useQuery({
    queryKey: ['/api/admin/migration/sets', sourceSearch, sourceYear, sourceHasCards, showArchived],
    queryFn: () => {
      const params = new URLSearchParams();
      if (sourceSearch) params.set('search', sourceSearch);
      if (sourceYear) params.set('year', sourceYear);
      if (sourceHasCards) params.set('hasCards', 'true');
      if (showArchived) params.set('showArchived', 'true');
      return apiRequest('GET', `/api/admin/migration/sets?${params.toString()}`).then(res => res.json());
    },
  });

  const { data: destSetsData, isLoading: destLoading } = useQuery({
    queryKey: ['/api/admin/migration/canonical-sets', destSearch, destYear],
    queryFn: () => {
      const params = new URLSearchParams();
      if (destSearch) params.set('search', destSearch);
      if (destYear) params.set('year', destYear);
      return apiRequest('GET', `/api/admin/migration/canonical-sets?${params.toString()}`).then(res => res.json());
    },
  });

  const { data: sourceCardsData } = useQuery({
    queryKey: ['/api/admin/migration/sets', selectedSource?.id, 'sample-cards'],
    queryFn: () => apiRequest('GET', `/api/admin/migration/sets/${selectedSource?.id}/sample-cards`).then(res => res.json()),
    enabled: !!selectedSource,
  });

  const { data: destCardsData } = useQuery({
    queryKey: ['/api/admin/migration/sets', selectedDest?.id, 'sample-cards'],
    queryFn: () => apiRequest('GET', `/api/admin/migration/sets/${selectedDest?.id}/sample-cards`).then(res => res.json()),
    enabled: !!selectedDest,
  });

  const { data: previewData, isLoading: previewLoading, refetch: refetchPreview } = useQuery({
    queryKey: ['/api/admin/migration/preview', selectedSource?.id, selectedDest?.id],
    queryFn: () => apiRequest('POST', '/api/admin/migration/preview', {
      sourceSetId: selectedSource?.id,
      destinationSetId: selectedDest?.id,
    }).then(res => res.json()),
    enabled: !!selectedSource && !!selectedDest,
  });

  const { data: logsData, isLoading: logsLoading, refetch: refetchLogs } = useQuery({
    queryKey: ['/api/admin/migration/logs'],
    queryFn: () => apiRequest('GET', '/api/admin/migration/logs').then(res => res.json()),
    enabled: activeTab === 'logs',
  });

  // Fetch main sets for assigning parent during migration
  const { data: mainSetsData } = useQuery({
    queryKey: ['/api/main-sets'],
    queryFn: () => apiRequest('GET', '/api/main-sets').then(res => res.json()),
  });
  const mainSets = mainSetsData || [];

  const executeMigration = useMutation({
    mutationFn: () => apiRequest('POST', '/api/admin/migration/execute', {
      sourceSetId: selectedSource?.id,
      destinationSetId: selectedDest?.id,
      forceInsert,
      allowConflicts: conflictConfirmValid ? CONFLICT_CONFIRM_PHRASE : null, // Send phrase, not boolean
      notes: migrationNotes || null,
      newMainSetId: newMainSetId || null,
      newSetName: newSetName.trim() || null,
    }).then(res => res.json()),
    onSuccess: (data) => {
      toast({
        title: "Migration Successful",
        description: data.message,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/migration'] });
      queryClient.invalidateQueries({ queryKey: ['/api/main-sets'] });
      setSelectedSource(null);
      setSelectedDest(null);
      setForceInsert(false);
      setAllowConflicts(false);
      setConflictConfirmText("");
      setMigrationNotes("");
      setNewMainSetId(null);
      setNewSetName("");
    },
    onError: (error: any) => {
      toast({
        title: "Migration Failed",
        description: error.message || "Failed to execute migration",
        variant: "destructive",
      });
    },
  });

  const archiveSet = useMutation({
    mutationFn: ({ setId, confirmWithCards }: { setId: number; confirmWithCards?: string }) => 
      apiRequest('POST', `/api/admin/migration/archive-set/${setId}`, { confirmWithCards }).then(res => res.json()),
    onSuccess: () => {
      toast({
        title: "Set Archived",
        description: "The set has been hidden from normal users.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/migration/sets'] });
      setSelectedSource(null);
      setArchiveConfirmText("");
    },
    onError: (error: any) => {
      toast({
        title: "Archive Failed",
        description: error.message || "Failed to archive set",
        variant: "destructive",
      });
    },
  });

  const deleteSet = useMutation({
    mutationFn: ({ setId, confirmDelete }: { setId: number; confirmDelete: string }) => 
      apiRequest('DELETE', `/api/admin/migration/delete-set/${setId}`, { confirmDelete }).then(res => res.json()),
    onSuccess: (data) => {
      toast({
        title: "Set Deleted",
        description: data.message || "The set has been permanently deleted.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/migration/sets'] });
      setSelectedSource(null);
      setDeleteConfirmText("");
      setShowDeleteDialog(false);
    },
    onError: (error: any) => {
      toast({
        title: "Delete Failed",
        description: error.message || "Failed to delete set",
        variant: "destructive",
      });
    },
  });

  const unarchiveSet = useMutation({
    mutationFn: (setId: number) => apiRequest('POST', `/api/admin/migration/unarchive-set/${setId}`).then(res => res.json()),
    onSuccess: () => {
      toast({
        title: "Set Restored",
        description: "The set is now visible to users.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/migration/sets'] });
    },
    onError: (error: any) => {
      toast({
        title: "Restore Failed",
        description: error.message || "Failed to restore set",
        variant: "destructive",
      });
    },
  });

  const promoteToCanonical = useMutation({
    mutationFn: ({ setId, confirmPromotion, year, mainSetId, newName }: { 
      setId: number; 
      confirmPromotion: string; 
      year?: string;
      mainSetId?: number;
      newName?: string;
    }) => 
      apiRequest('POST', `/api/admin/migration/promote-to-canonical/${setId}`, { 
        confirmPromotion, 
        year: year ? parseInt(year) : null,
        mainSetId: mainSetId || null,
        newName: newName || null
      }).then(res => res.json()),
    onSuccess: (data) => {
      toast({
        title: "Set Promoted",
        description: data.message || "The set is now a canonical subset.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/migration/sets'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/migration/canonical-sets'] });
      queryClient.invalidateQueries({ queryKey: ['/api/main-sets'] });
      setSelectedSource(null);
      setPromoteConfirmText("");
      setPromoteYear("");
      setPromoteMainSetId(null);
      setPromoteNewName("");
    },
    onError: (error: any) => {
      toast({
        title: "Promotion Failed",
        description: error.message || "Failed to promote set to canonical",
        variant: "destructive",
      });
    },
  });

  const rollbackMigration = useMutation({
    mutationFn: (logId: number) => apiRequest('POST', `/api/admin/migration/rollback/${logId}`).then(res => res.json()),
    onSuccess: (data) => {
      toast({
        title: "Rollback Successful",
        description: data.message,
      });
      refetchLogs();
      queryClient.invalidateQueries({ queryKey: ['/api/admin/migration/sets'] });
    },
    onError: (error: any) => {
      toast({
        title: "Rollback Failed",
        description: error.message || "Failed to rollback migration",
        variant: "destructive",
      });
    },
  });

  const sourceSets: CardSet[] = sourceSetsData?.sets || [];
  const destSets: CardSet[] = destSetsData?.sets || [];
  const sourceCards: SampleCard[] = sourceCardsData?.cards || [];
  const destCards: SampleCard[] = destCardsData?.cards || [];
  const preview: PreviewResult | null = previewData;
  const logs: MigrationLog[] = logsData?.logs || [];

  const isInsertDetected = selectedDest ? detectInsertSubset(selectedDest.name) : false;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Migration Console</h1>
          <p className="text-muted-foreground">Safely migrate cards between sets with full rollback capability</p>
        </div>
        <Badge variant="secondary">Admin Only</Badge>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-gray-100">
          <TabsTrigger value="migrate" className="flex items-center gap-2 data-[state=active]:bg-red-600 data-[state=active]:text-white">
            <ArrowLeftRight className="h-4 w-4" />
            Migrate Cards
          </TabsTrigger>
          <TabsTrigger value="logs" className="flex items-center gap-2 data-[state=active]:bg-red-600 data-[state=active]:text-white">
            <History className="h-4 w-4" />
            Migration Logs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="migrate" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-orange-500" />
                  Source (Legacy) Set
                </CardTitle>
                <CardDescription>Select the set to migrate cards FROM</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      placeholder="Search sets..."
                      value={sourceSearch}
                      onChange={(e) => setSourceSearch(e.target.value)}
                      className="pl-10 bg-white text-gray-900 border-gray-300"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Select value={sourceYear || "all"} onValueChange={(v) => setSourceYear(v === "all" ? "" : v)}>
                      <SelectTrigger className="w-[120px] bg-white border-gray-300 text-gray-900">
                        <SelectValue placeholder="Year" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Years</SelectItem>
                        {Array.from({length: 2025 - 1960 + 1}, (_, i) => 2025 - i).map(y => (
                          <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="hasCards"
                        checked={sourceHasCards}
                        onCheckedChange={(checked) => setSourceHasCards(!!checked)}
                      />
                      <Label htmlFor="hasCards" className="text-sm">Has cards</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="showArchived"
                        checked={showArchived}
                        onCheckedChange={(checked) => setShowArchived(!!checked)}
                      />
                      <Label htmlFor="showArchived" className="text-sm">Archived</Label>
                    </div>
                  </div>
                </div>

                <div className="h-[600px] overflow-y-auto space-y-2 p-2 bg-gray-50 rounded-md">
                  {sourceLoading ? (
                    <div className="flex items-center justify-center h-full">
                      <Loader2 className="h-6 w-6 animate-spin text-red-600" />
                    </div>
                  ) : sourceSets.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-gray-500">
                      No sets found
                    </div>
                  ) : (
                    sourceSets.map((set) => (
                      <div
                        key={set.id}
                        onClick={() => setSelectedSource(set)}
                        className={`bg-white rounded-lg border p-3 cursor-pointer transition-all hover:shadow-md ${
                          selectedSource?.id === set.id ? 'ring-2 ring-red-500 border-red-500' : 'border-gray-200 hover:border-red-300'
                        } ${!set.isActive ? 'opacity-60' : ''}`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="w-16 h-16 bg-gray-100 rounded-md overflow-hidden flex-shrink-0">
                            {(set.mainSetThumbnail || set.imageUrl) ? (
                              <SimpleImage
                                src={set.mainSetThumbnail || set.imageUrl || ''}
                                alt={set.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
                                No img
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-gray-900">{formatTitle(set.name)}</div>
                            <div className="text-sm text-gray-600 mt-1">
                              {set.year} • {set.cardCount} cards
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-xs text-gray-400">#{set.id}</span>
                              {!set.isActive && (
                                <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded">Archived</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                  Destination (Canonical) Set
                </CardTitle>
                <CardDescription>Select the set to migrate cards TO</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      placeholder="Search canonical sets..."
                      value={destSearch}
                      onChange={(e) => setDestSearch(e.target.value)}
                      className="pl-10 bg-white text-gray-900 border-gray-300"
                    />
                  </div>
                  <Select value={destYear || "all"} onValueChange={(v) => setDestYear(v === "all" ? "" : v)}>
                    <SelectTrigger className="w-[120px] bg-white border-gray-300 text-gray-900">
                      <SelectValue placeholder="Year" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Years</SelectItem>
                      {Array.from({length: 2025 - 1960 + 1}, (_, i) => 2025 - i).map(y => (
                        <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="h-[600px] overflow-y-auto space-y-2 p-2 bg-gray-50 rounded-md">
                  {destLoading ? (
                    <div className="flex items-center justify-center h-full">
                      <Loader2 className="h-6 w-6 animate-spin text-green-600" />
                    </div>
                  ) : destSets.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-gray-500">
                      No canonical sets found
                    </div>
                  ) : (
                    destSets.map((set) => (
                      <div
                        key={set.id}
                        onClick={() => setSelectedDest(set)}
                        className={`bg-white rounded-lg border p-3 cursor-pointer transition-all hover:shadow-md ${
                          selectedDest?.id === set.id ? 'ring-2 ring-green-500 border-green-500' : 'border-gray-200 hover:border-green-300'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="w-16 h-16 bg-gray-100 rounded-md overflow-hidden flex-shrink-0">
                            {(set.mainSetThumbnail || set.imageUrl) ? (
                              <SimpleImage
                                src={set.mainSetThumbnail || set.imageUrl || ''}
                                alt={set.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
                                No img
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-gray-900">{formatTitle(set.name)}</div>
                            <div className="text-sm text-gray-600 mt-1">
                              {set.year} • {set.cardCount} cards
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-xs text-gray-400">#{set.id}</span>
                              {(set.isInsertSubset || detectInsertSubset(set.name)) && (
                                <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">
                                  {set.isInsertSubset ? 'Insert Subset' : 'Insert?'}
                                </span>
                              )}
                              {set.isCanonical && (
                                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">Canonical</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle>Preview & Actions</CardTitle>
                <CardDescription>Review before migrating</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 overflow-x-hidden">
                {selectedSource && (
                  <div className="p-3 bg-orange-50 rounded-lg border border-orange-200 overflow-hidden">
                    <div className="font-medium text-sm text-orange-800">Source Set</div>
                    <div className="text-sm break-words">{formatTitle(selectedSource.name)}</div>
                    <div className="text-xs text-orange-600">{selectedSource.cardCount} cards</div>
                    
                    {sourceCards.length > 0 && (
                      <div className="mt-2 grid grid-cols-4 gap-1">
                        {sourceCards.slice(0, 8).map((card) => (
                          <div key={card.id} className="aspect-square bg-gray-100 rounded overflow-hidden">
                            {card.frontImageUrl ? (
                              <SimpleImage
                                src={card.frontImageUrl}
                                alt={card.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-[8px] text-gray-400 p-1 text-center">
                                {card.cardNumber}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {!selectedSource.isActive && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2 w-full"
                        onClick={() => unarchiveSet.mutate(selectedSource.id)}
                        disabled={unarchiveSet.isPending}
                      >
                        {unarchiveSet.isPending && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                        Restore Set
                      </Button>
                    )}
                  </div>
                )}

                {selectedSource && selectedDest && (
                  <div className="flex items-center justify-center">
                    <ArrowRight className="h-6 w-6 text-gray-400" />
                  </div>
                )}

                {selectedDest && (
                  <div className="p-3 bg-green-50 rounded-lg border border-green-200 overflow-hidden">
                    <div className="font-medium text-sm text-green-800">Destination Set</div>
                    <div className="text-sm break-words">{formatTitle(selectedDest.name)}</div>
                    <div className="text-xs text-green-600">{selectedDest.cardCount} cards</div>
                    
                    {destCards.length > 0 && (
                      <div className="mt-2 grid grid-cols-4 gap-1">
                        {destCards.slice(0, 8).map((card) => (
                          <div key={card.id} className="aspect-square bg-gray-100 rounded overflow-hidden">
                            {card.frontImageUrl ? (
                              <SimpleImage
                                src={card.frontImageUrl}
                                alt={card.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-[8px] text-gray-400 p-1 text-center">
                                {card.cardNumber}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {selectedSource && selectedDest && preview && (
                  <div className="space-y-3">
                    <div className="p-3 bg-gray-50 rounded-lg">
                      <div className="text-sm font-medium">Migration Preview</div>
                      <div className="text-xs text-gray-600 mt-1 space-y-1">
                        <div>Cards to move: <span className="font-medium">{preview.sourceCardCount}</span></div>
                        <div>Destination currently has: <span className="font-medium">{preview.destinationCardCount}</span></div>
                        {preview.conflictCount > 0 && (
                          <div className="flex items-center gap-1 text-amber-600">
                            <AlertTriangle className="h-3 w-3" />
                            <span>Potential conflicts: {preview.conflictCount}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {(preview?.destinationIsInsertSubset || isInsertDetected) && (
                      <div className="p-3 bg-purple-50 rounded-lg border border-purple-200">
                        <div className="flex items-center gap-2 text-sm text-purple-800">
                          <CheckCircle className="h-4 w-4" />
                          <span>
                            {preview?.destinationIsInsertSubset 
                              ? 'Destination is marked as Insert Subset - cards will be marked as inserts'
                              : 'Insert subset detected in destination name'}
                          </span>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="forceInsert"
                        checked={forceInsert}
                        onCheckedChange={(checked) => setForceInsert(!!checked)}
                      />
                      <Label htmlFor="forceInsert" className="text-sm">
                        Mark all migrated cards as insert cards
                      </Label>
                    </div>

                    {preview && preview.conflictCount > 0 && (
                      <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 space-y-3">
                        <div className="flex items-center gap-2 text-amber-800 font-medium">
                          <AlertTriangle className="h-4 w-4" />
                          <span>{preview.conflictCount} Duplicate Card Numbers</span>
                        </div>
                        
                        <div className="max-h-32 overflow-y-auto space-y-1 text-xs">
                          {preview.conflicts.slice(0, 20).map((conflict, i) => (
                            <div key={i} className="flex items-center gap-2 text-gray-600">
                              <span className="font-mono bg-gray-100 px-1 rounded">#{conflict.cardNumber}</span>
                              <span className="truncate">{conflict.sourceCardName}</span>
                              <span className="text-gray-400">→</span>
                              <span className="truncate text-amber-700">{conflict.destCardName}</span>
                            </div>
                          ))}
                          {preview.conflicts.length > 20 && (
                            <div className="text-gray-400 italic">...and {preview.conflicts.length - 20} more</div>
                          )}
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="conflictConfirm" className="text-xs text-amber-700">
                            Type <span className="font-mono font-bold">MIGRATE WITH CONFLICTS</span> to proceed:
                          </Label>
                          <Input
                            id="conflictConfirm"
                            placeholder="MIGRATE WITH CONFLICTS"
                            value={conflictConfirmText}
                            onChange={(e) => {
                              setConflictConfirmText(e.target.value);
                              setAllowConflicts(e.target.value === CONFLICT_CONFIRM_PHRASE);
                            }}
                            className={`font-mono text-sm ${conflictConfirmValid ? 'border-green-500 bg-green-50' : 'border-amber-300'}`}
                          />
                        </div>
                      </div>
                    )}

                    {/* Main Set Assignment */}
                    <div className="p-3 bg-blue-50 rounded-lg border border-blue-200 space-y-3">
                      <div className="text-sm font-medium text-blue-800">Destination Set Options</div>
                      
                      <div>
                        <Label htmlFor="newSetName" className="text-xs text-blue-700">Rename Set (optional)</Label>
                        <Input
                          id="newSetName"
                          placeholder={selectedDest?.name || "New set name..."}
                          value={newSetName}
                          onChange={(e) => setNewSetName(e.target.value)}
                          className="text-sm"
                        />
                        <div className="text-xs text-gray-500 mt-1">Leave blank to keep current name</div>
                      </div>

                      <div>
                        <Label htmlFor="mainSetPicker" className="text-xs text-blue-700">Assign to Main Set (optional)</Label>
                        <Select
                          value={newMainSetId?.toString() || "none"}
                          onValueChange={(val) => setNewMainSetId(val === "none" ? null : parseInt(val))}
                        >
                          <SelectTrigger className="text-sm">
                            <SelectValue placeholder={selectedDest?.mainSetName || "Select a main set..."} />
                          </SelectTrigger>
                          <SelectContent className="max-h-60">
                            <SelectItem value="none">Keep current / No change</SelectItem>
                            {mainSets.map((ms: any) => (
                              <SelectItem key={ms.id} value={ms.id.toString()}>
                                {ms.name} ({ms.year})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {selectedDest?.mainSetName && (
                          <div className="text-xs text-gray-500 mt-1">Currently under: {selectedDest.mainSetName}</div>
                        )}
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="notes" className="text-sm">Notes (optional)</Label>
                      <Input
                        id="notes"
                        placeholder="Migration notes..."
                        value={migrationNotes}
                        onChange={(e) => setMigrationNotes(e.target.value)}
                      />
                    </div>

                    <Button
                      className="w-full bg-red-600 hover:bg-red-700"
                      onClick={() => executeMigration.mutate()}
                      disabled={executeMigration.isPending || !preview.canMigrate || (preview.conflictCount > 0 && !conflictConfirmValid)}
                    >
                      {executeMigration.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Migrate {preview.sourceCardCount} Cards
                      {preview.conflictCount > 0 && conflictConfirmValid && (
                        <span className="ml-2 text-amber-200">(with {preview.conflictCount} conflicts)</span>
                      )}
                    </Button>

                    {preview.conflictCount > 0 && !conflictConfirmValid && (
                      <div className="text-xs text-amber-600 text-center">
                        Type the confirmation phrase above to proceed with conflicts
                      </div>
                    )}
                  </div>
                )}

                {/* Source Set Actions - shown when only source is selected (no destination needed) */}
                {selectedSource && !selectedDest && selectedSource.isActive && (
                  <div className="space-y-3">
                    <div className="text-sm font-medium text-gray-700 border-b pb-2">
                      Source Set Actions
                    </div>

                    {selectedSource.cardCount === 0 && (
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => archiveSet.mutate({ setId: selectedSource.id })}
                        disabled={archiveSet.isPending}
                      >
                        {archiveSet.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        <Archive className="mr-2 h-4 w-4" />
                        Archive Empty Legacy Set
                      </Button>
                    )}

                    {selectedSource.cardCount > 0 && (
                      <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 space-y-3">
                        <div className="flex items-center gap-2 text-amber-800 font-medium text-sm">
                          <AlertTriangle className="h-4 w-4" />
                          <span>Archive Set With {selectedSource.cardCount} Cards</span>
                        </div>
                        <div className="text-xs text-amber-600">
                          Will only succeed if no users have these cards in their collection.
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="archiveConfirm" className="text-xs text-amber-700">
                            Type <span className="font-mono font-bold">ARCHIVE WITH CARDS</span> to archive:
                          </Label>
                          <Input
                            id="archiveConfirm"
                            placeholder="ARCHIVE WITH CARDS"
                            value={archiveConfirmText}
                            onChange={(e) => setArchiveConfirmText(e.target.value)}
                            className={`font-mono text-sm ${archiveConfirmValid ? 'border-green-500 bg-green-50' : 'border-amber-300'}`}
                          />
                        </div>
                        <Button
                          variant="outline"
                          className="w-full border-amber-500 text-amber-700 hover:bg-amber-100"
                          onClick={() => archiveSet.mutate({ setId: selectedSource.id, confirmWithCards: archiveConfirmText })}
                          disabled={archiveSet.isPending || !archiveConfirmValid}
                        >
                          {archiveSet.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          <Archive className="mr-2 h-4 w-4" />
                          Archive With Cards
                        </Button>
                      </div>
                    )}

                    {selectedSource.cardCount === 0 && !selectedSource.isCanonical && (
                      <div className="p-3 bg-red-50 rounded-lg border border-red-200 space-y-3">
                        <div className="flex items-center gap-2 text-red-800 font-medium text-sm">
                          <AlertTriangle className="h-4 w-4" />
                          <span>Permanently Delete Empty Set</span>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="deleteConfirm" className="text-xs text-red-700">
                            Type <span className="font-mono font-bold">DELETE SET</span> to permanently delete:
                          </Label>
                          <Input
                            id="deleteConfirm"
                            placeholder="DELETE SET"
                            value={deleteConfirmText}
                            onChange={(e) => setDeleteConfirmText(e.target.value)}
                            className={`font-mono text-sm ${deleteConfirmValid ? 'border-green-500 bg-green-50' : 'border-red-300'}`}
                          />
                        </div>
                        <Button
                          variant="outline"
                          className="w-full border-red-500 text-red-700 hover:bg-red-100"
                          onClick={() => deleteSet.mutate({ setId: selectedSource.id, confirmDelete: deleteConfirmText })}
                          disabled={deleteSet.isPending || !deleteConfirmValid}
                        >
                          {deleteSet.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          Delete Permanently
                        </Button>
                      </div>
                    )}

                    {!selectedSource.isCanonical && (
                      <div className="p-3 bg-blue-50 rounded-lg border border-blue-200 space-y-3">
                        <div className="flex items-center gap-2 text-blue-800 font-medium text-sm">
                          <CheckCircle className="h-4 w-4" />
                          <span>Promote to Canonical Subset</span>
                        </div>
                        <div className="text-xs text-blue-600">
                          Convert this legacy set into a canonical subset under a main set. All {selectedSource.cardCount} cards will remain in this set.
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="promoteMainSet" className="text-xs text-blue-700 font-medium">
                            Assign to Main Set:
                          </Label>
                          <Select
                            value={promoteMainSetId?.toString() || "none"}
                            onValueChange={(val) => setPromoteMainSetId(val === "none" ? null : parseInt(val))}
                          >
                            <SelectTrigger className="text-sm">
                              <SelectValue placeholder="Select a main set..." />
                            </SelectTrigger>
                            <SelectContent className="max-h-60">
                              <SelectItem value="none">No main set (standalone)</SelectItem>
                              {mainSets.map((ms: any) => (
                                <SelectItem key={ms.id} value={ms.id.toString()}>
                                  {ms.name} ({ms.year})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {selectedSource.mainSetName && (
                            <div className="text-xs text-gray-500">Currently under: {selectedSource.mainSetName}</div>
                          )}
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="promoteNewName" className="text-xs text-blue-700">
                            Rename Set (optional):
                          </Label>
                          <Input
                            id="promoteNewName"
                            placeholder={selectedSource.name || "New name..."}
                            value={promoteNewName}
                            onChange={(e) => setPromoteNewName(e.target.value)}
                            className="text-sm"
                          />
                          <div className="text-xs text-gray-500">Leave blank to keep current name</div>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="promoteYear" className="text-xs text-blue-700">
                            Set Year (optional):
                          </Label>
                          <Input
                            id="promoteYear"
                            type="number"
                            placeholder={selectedSource.year?.toString() || "e.g. 2024"}
                            value={promoteYear}
                            onChange={(e) => setPromoteYear(e.target.value)}
                            className="text-sm"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="promoteConfirm" className="text-xs text-blue-700">
                            Type <span className="font-mono font-bold">PROMOTE TO CANONICAL</span> to confirm:
                          </Label>
                          <Input
                            id="promoteConfirm"
                            placeholder="PROMOTE TO CANONICAL"
                            value={promoteConfirmText}
                            onChange={(e) => setPromoteConfirmText(e.target.value)}
                            className={`font-mono text-sm ${promoteConfirmValid ? 'border-green-500 bg-green-50' : 'border-blue-300'}`}
                          />
                        </div>
                        <Button
                          variant="outline"
                          className="w-full border-blue-500 text-blue-700 hover:bg-blue-100"
                          onClick={() => promoteToCanonical.mutate({ 
                            setId: selectedSource.id, 
                            confirmPromotion: promoteConfirmText,
                            year: promoteYear || undefined,
                            mainSetId: promoteMainSetId || undefined,
                            newName: promoteNewName.trim() || undefined
                          })}
                          disabled={promoteToCanonical.isPending || !promoteConfirmValid}
                        >
                          {promoteToCanonical.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          <CheckCircle className="mr-2 h-4 w-4" />
                          Promote to Canonical
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {!selectedSource && (
                  <div className="text-center text-gray-500 py-8">
                    Select a source set to see available actions
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>User Collections Protection</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3 p-4 bg-green-50 rounded-lg border border-green-200">
                <CheckCircle className="h-6 w-6 text-green-600" />
                <div>
                  <div className="font-medium text-green-800">Collections are protected</div>
                  <div className="text-sm text-green-600">
                    User collections are linked by card ID (not set name). When cards are migrated to a new set,
                    users who own those cards will continue to see them in their collection without any data loss.
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                Migration History
              </CardTitle>
              <CardDescription>View past migrations and rollback if needed</CardDescription>
            </CardHeader>
            <CardContent>
              {logsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : logs.length === 0 ? (
                <div className="text-center text-gray-500 py-8">
                  No migrations yet
                </div>
              ) : (
                <div className="divide-y">
                  {logs.map((log) => (
                    <div key={log.id} className="py-4 flex items-center justify-between">
                      <div>
                        <div className="font-medium">
                          {formatTitle(log.sourceSetName)} <ArrowRight className="inline h-4 w-4 mx-1" /> {formatTitle(log.destinationSetName)}
                        </div>
                        <div className="text-sm text-gray-500">
                          {log.movedCardCount} cards • {new Date(log.createdAt).toLocaleString()}
                          {log.adminUsername && ` • by ${log.adminUsername}`}
                        </div>
                        {log.notes && (
                          <div className="text-sm text-gray-400 mt-1">{log.notes}</div>
                        )}
                        {log.insertForced && (
                          <Badge variant="secondary" className="mt-1 text-xs">Insert forced</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {log.status === 'rolled_back' ? (
                          <Badge variant="outline" className="text-amber-600">
                            Rolled back {log.rolledBackAt && new Date(log.rolledBackAt).toLocaleDateString()}
                          </Badge>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => rollbackMigration.mutate(log.id)}
                            disabled={rollbackMigration.isPending}
                          >
                            {rollbackMigration.isPending && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                            <RotateCcw className="mr-1 h-3 w-3" />
                            Rollback
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
