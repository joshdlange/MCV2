import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, Info, Bell, ChevronLeft, ChevronRight, Clock, ChevronDown, ChevronUp, Pencil, X, Save } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useAppStore } from "@/lib/store";
import useEmblaCarousel from 'embla-carousel-react';
import { formatSetName } from "@/lib/formatTitle";

interface UpcomingSet {
  id: number;
  setName: string;
  name?: string;
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
}

function getSetDisplayName(set: UpcomingSet): string {
  return set.setName || set.name || 'Unknown Set';
}

function getManufacturerColor(manufacturer: string | null): string {
  switch (manufacturer?.toLowerCase()) {
    case 'topps': return '#dc2626';
    case 'panini': return '#2563eb';
    case 'upper deck': return '#1e3a5f';
    case 'wizards of the coast': return '#7c3aed';
    case 'card fun': return '#059669';
    default: return '#6b7280';
  }
}

function extractYear(set: UpcomingSet): string {
  if (set.releaseDateEstimated) {
    return new Date(set.releaseDateEstimated).getFullYear().toString();
  }
  const name = getSetDisplayName(set);
  const match = name.match(/20\d{2}/);
  return match ? match[0] : '';
}

function SetPlaceholder({ set }: { set: UpcomingSet }) {
  const name = getSetDisplayName(set);
  const year = extractYear(set);
  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center p-6 text-center"
      style={{ background: 'linear-gradient(135deg, #1a1a2e, #16213e, #0f3460)' }}
    >
      <div className="border-l-4 border-red-500 pl-4 text-left w-full">
        <div className="text-white/90 text-lg font-bold">
          {set.manufacturer || 'Unknown'} {year && `· ${year}`}
        </div>
        <div className="text-white/60 text-sm mt-1 line-clamp-2">
          {name}
        </div>
      </div>
    </div>
  );
}

function SetImage({ set, className }: { set: UpcomingSet; className?: string }) {
  const [failed, setFailed] = useState(false);

  if (!set.thumbnailUrl || failed) {
    return <SetPlaceholder set={set} />;
  }

  return (
    <img
      src={set.thumbnailUrl}
      alt={getSetDisplayName(set)}
      className={className || "w-full h-full object-cover"}
      onError={() => setFailed(true)}
    />
  );
}

function ManufacturerBadge({ manufacturer }: { manufacturer: string | null }) {
  if (!manufacturer) return null;
  const color = getManufacturerColor(manufacturer);
  return (
    <Badge
      className="text-xs text-white border-none"
      style={{ backgroundColor: color }}
    >
      {manufacturer}
    </Badge>
  );
}

function DateConfidenceBadge({ confidence }: { confidence: 'estimated' | 'confirmed' | null }) {
  if (!confidence) return null;
  if (confidence === 'confirmed') {
    return (
      <Badge className="bg-green-100 text-green-800 border-green-300 text-xs">
        Confirmed Date
      </Badge>
    );
  }
  return (
    <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-xs">
      Est. Release
    </Badge>
  );
}

function KeyHighlights({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > 120;

  return (
    <div>
      <p className={`text-sm text-gray-700 leading-relaxed ${!expanded ? 'line-clamp-2' : ''}`}>
        {text}
      </p>
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-red-600 hover:text-red-700 font-medium mt-1 flex items-center gap-1"
        >
          {expanded ? (
            <>Show less <ChevronUp className="w-3 h-3" /></>
          ) : (
            <>Read more <ChevronDown className="w-3 h-3" /></>
          )}
        </button>
      )}
    </div>
  );
}

function AdminEditDialog({ set, onClose }: { set: UpcomingSet; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    setName: getSetDisplayName(set),
    manufacturer: set.manufacturer || '',
    thumbnailUrl: set.thumbnailUrl || '',
    releaseDateEstimated: set.releaseDateEstimated ? new Date(set.releaseDateEstimated).toISOString().split('T')[0] : '',
    dateConfidence: set.dateConfidence || 'estimated',
    keyHighlights: set.keyHighlights || '',
    msrp: set.msrp || '',
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates: Record<string, any> = {};
      if (form.setName) updates.setName = form.setName;
      if (form.manufacturer) updates.manufacturer = form.manufacturer;
      updates.thumbnailUrl = form.thumbnailUrl || null;
      if (form.releaseDateEstimated) updates.releaseDateEstimated = form.releaseDateEstimated;
      updates.dateConfidence = form.dateConfidence;
      if (form.keyHighlights) updates.keyHighlights = form.keyHighlights;
      updates.msrp = form.msrp || null;

      await apiRequest('PATCH', `/api/admin/upcoming-sets/${set.id}`, updates);
      qc.invalidateQueries({ queryKey: ['/api/upcoming-sets'] });
      toast({ title: "Set updated successfully" });
      onClose();
    } catch {
      toast({ title: "Failed to update set", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <Label>Set Name</Label>
        <Input value={form.setName} onChange={e => setForm({ ...form, setName: e.target.value })} className="bg-white" />
      </div>
      <div>
        <Label>Thumbnail URL</Label>
        <Input value={form.thumbnailUrl} onChange={e => setForm({ ...form, thumbnailUrl: e.target.value })} placeholder="https://..." className="bg-white" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Manufacturer</Label>
          <Input value={form.manufacturer} onChange={e => setForm({ ...form, manufacturer: e.target.value })} className="bg-white" />
        </div>
        <div>
          <Label>MSRP</Label>
          <Input value={form.msrp} onChange={e => setForm({ ...form, msrp: e.target.value })} placeholder="29.99" className="bg-white" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Release Date</Label>
          <Input type="date" value={form.releaseDateEstimated} onChange={e => setForm({ ...form, releaseDateEstimated: e.target.value })} className="bg-white" />
        </div>
        <div>
          <Label>Date Confidence</Label>
          <Select value={form.dateConfidence} onValueChange={v => setForm({ ...form, dateConfidence: v as any })}>
            <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="estimated">Estimated</SelectItem>
              <SelectItem value="confirmed">Confirmed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Label>Key Highlights</Label>
        <Textarea value={form.keyHighlights} onChange={e => setForm({ ...form, keyHighlights: e.target.value })} rows={3} className="bg-white" />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving} className="bg-marvel-red hover:bg-red-700">
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </div>
  );
}

function AdminEditButton({ set }: { set: UpcomingSet }) {
  const { currentUser } = useAppStore();
  const [open, setOpen] = useState(false);

  if (!currentUser?.isAdmin) return null;

  return (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className="absolute top-2 left-2 z-10 bg-white/90 hover:bg-white rounded-full p-1.5 shadow-md transition-all"
        title="Edit set"
      >
        <Pencil className="w-4 h-4 text-gray-700" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Upcoming Set</DialogTitle>
          </DialogHeader>
          <AdminEditDialog set={set} onClose={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function CountdownTimer({ releaseDate }: { releaseDate: string }) {
  const [timeRemaining, setTimeRemaining] = useState<{
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
  } | null>(null);

  useEffect(() => {
    const calculateTimeRemaining = () => {
      const now = new Date().getTime();
      const target = new Date(releaseDate).getTime();
      const difference = target - now;

      if (difference <= 0) {
        setTimeRemaining({ days: 0, hours: 0, minutes: 0, seconds: 0 });
        return;
      }

      const days = Math.floor(difference / (1000 * 60 * 60 * 24));
      const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((difference % (1000 * 60)) / 1000);

      setTimeRemaining({ days, hours, minutes, seconds });
    };

    calculateTimeRemaining();
    const interval = setInterval(calculateTimeRemaining, 1000);

    return () => clearInterval(interval);
  }, [releaseDate]);

  if (!timeRemaining) return null;

  return (
    <div className="flex items-center gap-4 bg-gradient-to-r from-red-600 to-orange-600 text-white px-4 py-3 rounded-lg">
      <Clock className="w-5 h-5" />
      <div className="flex gap-4 text-sm font-medium">
        <div className="text-center">
          <div className="text-2xl font-bebas">{timeRemaining.days}</div>
          <div className="text-xs opacity-90">Days</div>
        </div>
        <div className="text-xl font-bebas self-center">:</div>
        <div className="text-center">
          <div className="text-2xl font-bebas">{String(timeRemaining.hours).padStart(2, '0')}</div>
          <div className="text-xs opacity-90">Hours</div>
        </div>
        <div className="text-xl font-bebas self-center">:</div>
        <div className="text-center">
          <div className="text-2xl font-bebas">{String(timeRemaining.minutes).padStart(2, '0')}</div>
          <div className="text-xs opacity-90">Min</div>
        </div>
        <div className="text-xl font-bebas self-center">:</div>
        <div className="text-center">
          <div className="text-2xl font-bebas">{String(timeRemaining.seconds).padStart(2, '0')}</div>
          <div className="text-xs opacity-90">Sec</div>
        </div>
      </div>
    </div>
  );
}

function UpcomingSetCarousel({ sets }: { sets: UpcomingSet[] }) {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true, align: 'start' });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const expressInterestMutation = useMutation({
    mutationFn: async (setId: number) => {
      const res = await apiRequest('POST', `/api/upcoming-sets/${setId}/interest`);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/upcoming-sets'] });
      if (data.alreadyTracking) {
        toast({ title: "You're already tracking this set!" });
      } else {
        toast({ 
          title: "Interest recorded!", 
          description: "We'll message you when this set launches." 
        });
      }
    },
    onError: () => {
      toast({ 
        title: "Failed to record interest", 
        variant: "destructive" 
      });
    }
  });

  useEffect(() => {
    if (!emblaApi) return;

    const onSelect = () => {
      setSelectedIndex(emblaApi.selectedScrollSnap());
    };

    emblaApi.on('select', onSelect);
    onSelect();

    return () => {
      emblaApi.off('select', onSelect);
    };
  }, [emblaApi]);

  const scrollPrev = () => emblaApi?.scrollPrev();
  const scrollNext = () => emblaApi?.scrollNext();

  if (sets.length === 0) return null;

  return (
    <div className="relative bg-gradient-to-br from-gray-900 via-red-900 to-gray-900 rounded-xl p-8 shadow-2xl">
      <div className="mb-6 text-center">
        <h2 className="text-3xl font-bebas tracking-wide text-white mb-2">Coming Soon</h2>
        <p className="text-gray-300">Upcoming Marvel card set releases</p>
      </div>

      <div className="relative">
        <div className="overflow-hidden" ref={emblaRef}>
          <div className="flex gap-6">
            {sets.map((set) => (
              <div
                key={set.id}
                className="flex-[0_0_100%] md:flex-[0_0_calc(50%-12px)] lg:flex-[0_0_calc(33.333%-16px)] min-w-0"
                data-testid={`carousel-set-${set.id}`}
              >
                <Card className="h-full overflow-hidden bg-white border-2 border-gray-200 hover:border-red-500 transition-all">
                  <div className="aspect-video bg-gray-100 overflow-hidden relative">
                    <AdminEditButton set={set} />
                    <SetImage set={set} className="w-full h-full object-cover" />
                    {set.dateConfidence === 'confirmed' && (
                      <Badge className="absolute top-3 right-3 bg-green-600 text-white border-none">
                        Confirmed
                      </Badge>
                    )}
                  </div>
                  <CardContent className="p-5 space-y-4">
                    <div>
                      <h3 className="text-xl font-bebas tracking-wide text-gray-900 mb-2" data-testid={`text-carousel-setname-${set.id}`}>
                        {formatSetName(getSetDisplayName(set))}
                      </h3>
                      
                      <div className="flex flex-wrap gap-2 mb-3">
                        <ManufacturerBadge manufacturer={set.manufacturer} />
                        {set.productLine && (
                          <Badge variant="outline" className="text-xs">
                            {set.productLine}
                          </Badge>
                        )}
                        <DateConfidenceBadge confidence={set.dateConfidence} />
                        {set.status === 'delayed' && (
                          <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300 text-xs">
                            Delayed
                          </Badge>
                        )}
                      </div>
                    </div>

                    {set.releaseDateEstimated && (
                      <div className="space-y-2">
                        <div className="flex items-center text-sm text-gray-700">
                          <Calendar className="w-4 h-4 mr-2 text-red-600" />
                          <span className="font-medium">
                            {new Date(set.releaseDateEstimated).toLocaleDateString('en-US', {
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric'
                            })}
                          </span>
                        </div>
                        <CountdownTimer releaseDate={set.releaseDateEstimated} />
                      </div>
                    )}

                    {set.msrp && (
                      <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                        <span className="text-sm font-medium text-gray-700">MSRP:</span>
                        <span className="text-lg font-bold text-green-700">${set.msrp}</span>
                      </div>
                    )}

                    {set.keyHighlights && (
                      <KeyHighlights text={set.keyHighlights} />
                    )}

                    {set.interestCount > 0 && (
                      <div className="text-sm text-gray-600 flex items-center gap-1">
                        <Bell className="w-4 h-4 text-marvel-red" />
                        <span className="font-medium text-marvel-red">{set.interestCount}</span>
                        <span>{set.interestCount === 1 ? 'collector' : 'collectors'} interested</span>
                      </div>
                    )}

                    <div className="flex gap-2 pt-2">
                      {user && (
                        <Button
                          onClick={() => expressInterestMutation.mutate(set.id)}
                          disabled={expressInterestMutation.isPending}
                          variant="outline"
                          className="flex-1 border-red-500 text-red-600 hover:bg-red-50 hover:text-red-700"
                          size="sm"
                          data-testid={`button-notify-${set.id}`}
                        >
                          <Bell className="w-4 h-4 mr-2" />
                          Notify Me
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            ))}
          </div>
        </div>

        {sets.length > 1 && (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 bg-white/90 hover:bg-white shadow-lg rounded-full"
              onClick={scrollPrev}
              data-testid="button-carousel-prev"
            >
              <ChevronLeft className="w-6 h-6" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 bg-white/90 hover:bg-white shadow-lg rounded-full"
              onClick={scrollNext}
              data-testid="button-carousel-next"
            >
              <ChevronRight className="w-6 h-6" />
            </Button>
          </>
        )}
      </div>

      {sets.length > 1 && (
        <div className="flex justify-center gap-2 mt-6">
          {sets.map((_, index) => (
            <button
              key={index}
              className={`w-2 h-2 rounded-full transition-all ${
                index === selectedIndex ? 'bg-white w-8' : 'bg-white/40'
              }`}
              onClick={() => emblaApi?.scrollTo(index)}
              data-testid={`dot-${index}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function UpcomingSets() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: upcomingSets = [], isLoading } = useQuery({
    queryKey: ['/api/upcoming-sets'],
    queryFn: async () => {
      return apiRequest('GET', '/api/upcoming-sets').then(res => res.json());
    }
  });

  const expressInterestMutation = useMutation({
    mutationFn: async (setId: number) => {
      const res = await apiRequest('POST', `/api/upcoming-sets/${setId}/interest`);
      return res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['/api/upcoming-sets'] });
      if (data.alreadyTracking) {
        toast({ title: "You're already tracking this set!" });
      } else {
        toast({
          title: "Interest recorded!",
          description: "We'll message you when this set launches."
        });
      }
    },
    onError: () => {
      toast({
        title: "Failed to record interest",
        variant: "destructive"
      });
    }
  });

  const activeSets = upcomingSets.filter((set: UpcomingSet) =>
    set.isActive && (set.status === 'upcoming' || set.status === 'delayed')
  );

  const featuredSets = activeSets.filter((set: UpcomingSet) => set.thumbnailUrl);
  const regularSets = activeSets.filter((set: UpcomingSet) => !set.thumbnailUrl);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bebas tracking-wide text-gray-900">Upcoming Sets</h1>
          <p className="text-gray-600">Stay up to date with upcoming Marvel card set releases</p>
        </div>

        {isLoading ? (
          <div className="text-center py-12">
            <div className="animate-spin w-12 h-12 border-4 border-red-600 border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-gray-600">Loading upcoming sets...</p>
          </div>
        ) : activeSets.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
            <Info className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">Coming Soon</h3>
            <p className="text-gray-600">New sets dropping soon. Check back shortly.</p>
          </div>
        ) : (
          <>
            {featuredSets.length > 0 && (
              <UpcomingSetCarousel sets={featuredSets} />
            )}

            {regularSets.length > 0 && (
              <div className="space-y-4">
                <h2 className="text-2xl font-bebas tracking-wide text-gray-900">More Upcoming Releases</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {regularSets.map((set: UpcomingSet) => (
                    <Card 
                      key={set.id} 
                      className="overflow-hidden hover:shadow-xl transition-shadow border-gray-200 bg-white"
                      data-testid={`card-upcoming-set-${set.id}`}
                    >
                      <div className="aspect-video bg-gray-100 overflow-hidden relative">
                        <AdminEditButton set={set} />
                        <SetPlaceholder set={set} />
                      </div>
                      <CardContent className="p-6 space-y-4">
                        <div>
                          <h3 className="text-xl font-bold text-gray-900 mb-2" data-testid={`text-setname-${set.id}`}>
                            {formatSetName(getSetDisplayName(set))}
                          </h3>
                          <div className="flex flex-wrap gap-2">
                            <ManufacturerBadge manufacturer={set.manufacturer} />
                            {set.productLine && (
                              <Badge variant="outline" className="text-xs">
                                {set.productLine}
                              </Badge>
                            )}
                            <DateConfidenceBadge confidence={set.dateConfidence} />
                          </div>
                        </div>

                        {set.releaseDateEstimated && (
                          <div className="flex items-center text-sm text-gray-700 bg-white border border-gray-200 rounded-lg p-3">
                            <Calendar className="w-4 h-4 mr-2 text-red-600" />
                            <span className="font-medium">
                              {new Date(set.releaseDateEstimated).toLocaleDateString('en-US', {
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric'
                              })}
                            </span>
                          </div>
                        )}

                        {set.msrp && (
                          <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                            <span className="text-sm font-medium text-gray-700">MSRP:</span>
                            <span className="text-lg font-bold text-green-700">${set.msrp}</span>
                          </div>
                        )}

                        {set.keyHighlights && (
                          <KeyHighlights text={set.keyHighlights} />
                        )}

                        {set.interestCount > 0 && (
                          <div className="text-sm text-gray-600 flex items-center gap-1">
                            <Bell className="w-4 h-4 text-marvel-red" />
                            <span className="font-medium text-marvel-red">{set.interestCount}</span>
                            <span>{set.interestCount === 1 ? 'collector' : 'collectors'} interested</span>
                          </div>
                        )}

                        {user && (
                          <Button
                            onClick={() => expressInterestMutation.mutate(set.id)}
                            disabled={expressInterestMutation.isPending}
                            variant="outline"
                            className="w-full border-red-500 text-red-600 hover:bg-red-50 hover:text-red-700"
                            size="sm"
                            data-testid={`button-notify-${set.id}`}
                          >
                            <Bell className="w-4 h-4 mr-2" />
                            Notify Me
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {activeSets.length > 0 && (
          <div className="mt-8 text-center p-6 bg-white border border-gray-200 rounded-lg">
            <p className="text-gray-700">
              <span className="font-semibold text-red-600">Stay tuned!</span> More exciting Marvel card sets coming soon.
              We'll keep this page updated with the latest announcements.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
