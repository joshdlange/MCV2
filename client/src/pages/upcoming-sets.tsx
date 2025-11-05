import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Info } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface UpcomingSet {
  id: number;
  name: string;
  publisher: string | null;
  releaseDate: string | null;
  description: string | null;
  imageUrl: string | null;
  isActive: boolean;
}

export default function UpcomingSets() {
  const { data: upcomingSets = [], isLoading } = useQuery({
    queryKey: ['/api/upcoming-sets'],
    queryFn: async () => {
      return apiRequest('GET', '/api/upcoming-sets').then(res => res.json());
    }
  });

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bebas tracking-wide text-gray-900">Upcoming Sets</h1>
          <p className="text-gray-600">Stay up to date with upcoming Marvel card set releases</p>
        </div>

        {/* Sets Grid */}
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {upcomingSets.map((set: UpcomingSet) => (
              <Card 
                key={set.id} 
                className="overflow-hidden hover:shadow-xl transition-shadow border-gray-200 bg-white"
                data-testid={`card-upcoming-set-${set.id}`}
              >
                {set.imageUrl && (
                  <div className="aspect-video bg-gray-100 overflow-hidden">
                    <img 
                      src={set.imageUrl} 
                      alt={set.name} 
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                <CardContent className="p-6 space-y-4">
                  <div>
                    <h3 className="text-xl font-bold text-gray-900 mb-2" data-testid={`text-setname-${set.id}`}>
                      {set.name}
                    </h3>
                    {set.publisher && (
                      <Badge variant="secondary" className="mb-2">
                        {set.publisher}
                      </Badge>
                    )}
                  </div>

                  {set.releaseDate && (
                    <div className="flex items-center text-sm text-gray-700 bg-red-50 border border-red-200 rounded-lg p-3">
                      <Calendar className="w-4 h-4 mr-2 text-red-600" />
                      <span className="font-medium">Release Date:</span>
                      <span className="ml-2">
                        {new Date(set.releaseDate).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric'
                        })}
                      </span>
                    </div>
                  )}

                  {set.description && (
                    <p className="text-gray-700 text-sm leading-relaxed">
                      {set.description}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
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
