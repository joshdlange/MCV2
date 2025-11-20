import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, Info, Bell, BellOff, ExternalLink, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import useEmblaCarousel from 'embla-carousel-react';

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
      return apiRequest('POST', `/api/upcoming-sets/${setId}/interest`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/upcoming-sets'] });
      toast({ 
        title: "Interest recorded!", 
        description: "We'll notify you when this set is available." 
      });
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
        {/* Carousel */}
        <div className="overflow-hidden" ref={emblaRef}>
          <div className="flex gap-6">
            {sets.map((set) => (
              <div
                key={set.id}
                className="flex-[0_0_100%] md:flex-[0_0_calc(50%-12px)] lg:flex-[0_0_calc(33.333%-16px)] min-w-0"
                data-testid={`carousel-set-${set.id}`}
              >
                <Card className="h-full overflow-hidden bg-white border-2 border-gray-200 hover:border-red-500 transition-all">
                  {set.thumbnailUrl && (
                    <div className="aspect-video bg-gray-100 overflow-hidden relative">
                      <img 
                        src={set.thumbnailUrl} 
                        alt={set.name} 
                        className="w-full h-full object-cover"
                      />
                      {set.dateConfidence === 'confirmed' && (
                        <Badge className="absolute top-3 right-3 bg-green-600 text-white border-none">
                          Confirmed
                        </Badge>
                      )}
                    </div>
                  )}
                  <CardContent className="p-5 space-y-4">
                    <div>
                      <h3 className="text-xl font-bebas tracking-wide text-gray-900 mb-2" data-testid={`text-carousel-setname-${set.id}`}>
                        {set.name}
                      </h3>
                      
                      <div className="flex flex-wrap gap-2 mb-3">
                        {set.manufacturer && (
                          <Badge variant="secondary" className="text-xs">
                            {set.manufacturer}
                          </Badge>
                        )}
                        {set.productLine && (
                          <Badge variant="outline" className="text-xs">
                            {set.productLine}
                          </Badge>
                        )}
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

                    {set.description && (
                      <p className="text-sm text-gray-700 line-clamp-3 leading-relaxed">
                        {set.description}
                      </p>
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
                          className="flex-1 bg-marvel-red hover:bg-red-700"
                          size="sm"
                          data-testid={`button-notify-${set.id}`}
                        >
                          <Bell className="w-4 h-4 mr-2" />
                          Notify Me
                        </Button>
                      )}
                      {set.sourceUrl && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1"
                          onClick={() => window.open(set.sourceUrl!, '_blank')}
                          data-testid={`button-source-${set.id}`}
                        >
                          <ExternalLink className="w-4 h-4 mr-2" />
                          Learn More
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            ))}
          </div>
        </div>

        {/* Navigation Buttons */}
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

      {/* Dots Indicator */}
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
  const { data: upcomingSets = [], isLoading } = useQuery({
    queryKey: ['/api/upcoming-sets'],
    queryFn: async () => {
      return apiRequest('GET', '/api/upcoming-sets?limit=10').then(res => res.json());
    }
  });

  // Separate featured (with images) from regular sets
  const featuredSets = upcomingSets.filter((set: UpcomingSet) => set.thumbnailUrl);
  const regularSets = upcomingSets.filter((set: UpcomingSet) => !set.thumbnailUrl);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bebas tracking-wide text-gray-900">Upcoming Sets</h1>
          <p className="text-gray-600">Stay up to date with upcoming Marvel card set releases</p>
        </div>

        {isLoading ? (
          <div className="text-center py-12">
            <div className="animate-spin w-12 h-12 border-4 border-red-600 border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-gray-600">Loading upcoming sets...</p>
          </div>
        ) : upcomingSets.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
            <Info className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">No Upcoming Sets</h3>
            <p className="text-gray-600">Check back soon for announcements about upcoming Marvel card sets!</p>
          </div>
        ) : (
          <>
            {/* Featured Carousel */}
            {featuredSets.length > 0 && (
              <UpcomingSetCarousel sets={featuredSets} />
            )}

            {/* Regular Sets Grid */}
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
                      <CardContent className="p-6 space-y-4">
                        <div>
                          <h3 className="text-xl font-bold text-gray-900 mb-2" data-testid={`text-setname-${set.id}`}>
                            {set.name}
                          </h3>
                          <div className="flex flex-wrap gap-2">
                            {set.manufacturer && (
                              <Badge variant="secondary">
                                {set.manufacturer}
                              </Badge>
                            )}
                            {set.productLine && (
                              <Badge variant="outline">
                                {set.productLine}
                              </Badge>
                            )}
                          </div>
                        </div>

                        {set.releaseDateEstimated && (
                          <div className="flex items-center text-sm text-gray-700 bg-red-50 border border-red-200 rounded-lg p-3">
                            <Calendar className="w-4 h-4 mr-2 text-red-600" />
                            <span className="font-medium">
                              {new Date(set.releaseDateEstimated).toLocaleDateString('en-US', {
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric'
                              })}
                            </span>
                            {set.dateConfidence === 'confirmed' && (
                              <Badge className="ml-auto bg-green-600 text-white text-xs">
                                Confirmed
                              </Badge>
                            )}
                          </div>
                        )}

                        {set.msrp && (
                          <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                            <span className="text-sm font-medium text-gray-700">MSRP:</span>
                            <span className="text-lg font-bold text-green-700">${set.msrp}</span>
                          </div>
                        )}

                        {set.description && (
                          <p className="text-gray-700 text-sm leading-relaxed line-clamp-3">
                            {set.description}
                          </p>
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
                            onClick={() => {
                              const mutation = useMutation({
                                mutationFn: async () => {
                                  return apiRequest('POST', `/api/upcoming-sets/${set.id}/interest`);
                                },
                                onSuccess: () => {
                                  queryClient.invalidateQueries({ queryKey: ['/api/upcoming-sets'] });
                                }
                              });
                              mutation.mutate();
                            }}
                            className="w-full bg-marvel-red hover:bg-red-700"
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

        {/* Coming Soon Message */}
        {upcomingSets.length > 0 && (
          <div className="mt-8 text-center p-6 bg-gradient-to-r from-red-50 to-red-100 border border-red-200 rounded-lg">
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
