import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Image, Search, RefreshCw } from "lucide-react";
import { SetGroupingAnalyzer } from "@/components/admin/set-grouping-analyzer";

interface CardWithoutImage {
  id: number;
  name: string;
  cardNumber: string;
  setName: string;
  description: string;
  currentImageUrl: string | null;
}

interface ImageUpdateResult {
  cardId: number;
  setName: string;
  cardName: string;
  cardNumber: string;
  success: boolean;
  error?: string;
  newImageUrl?: string;
}

export default function AdminPage() {
  const [limit, setLimit] = useState(20);
  const [batchSize, setBatchSize] = useState(25);
  const { toast } = useToast();

  // Get cards without images
  const { data: cardsData, isLoading: cardsLoading, refetch: refetchCards } = useQuery({
    queryKey: ['/api/admin/cards-without-images', limit],
    queryFn: () => apiRequest('GET', `/api/admin/cards-without-images?limit=${limit}`).then(res => res.json()),
  });

  // Test image finder mutation
  const testImageFinder = useMutation({
    mutationFn: () => apiRequest('POST', '/api/admin/test-image-finder').then(res => res.json()),
    onSuccess: (data) => {
      toast({
        title: "Test Completed",
        description: data.message,
      });
    },
    onError: () => {
      toast({
        title: "Test Failed",
        description: "Failed to test image finder",
        variant: "destructive",
      });
    }
  });

  // Find image for specific card mutation
  const findCardImage = useMutation({
    mutationFn: (cardId: number) => 
      apiRequest('POST', `/api/admin/find-card-image/${cardId}`).then(res => res.json()),
    onSuccess: (data: { success: boolean; message: string; result: ImageUpdateResult }) => {
      toast({
        title: data.success ? "Image Updated" : "No Image Found",
        description: data.message,
        variant: data.success ? "default" : "destructive",
      });
      refetchCards();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to find card image",
        variant: "destructive",
      });
    }
  });

  // Batch update images mutation
  const batchUpdateImages = useMutation({
    mutationFn: (maxCards: number) => 
      apiRequest('POST', '/api/admin/batch-update-images', { maxCards }).then(res => res.json()),
    onSuccess: (data) => {
      toast({
        title: "Batch Update Started",
        description: data.message,
      });
      // Refresh cards list after a delay to see updates
      setTimeout(() => refetchCards(), 2000);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to start batch update",
        variant: "destructive",
      });
    }
  });

  const cards = cardsData?.cards || [];

  return (
    <div className="container mx-auto py-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Admin Panel</h1>
          <p className="text-muted-foreground">Manage card images and automation</p>
        </div>
        <Badge variant="secondary">Admin Only</Badge>
      </div>

      {/* Set Grouping Analysis Tool */}
      <SetGroupingAnalyzer />

      {/* Control Panel */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              Test Image Finder
            </CardTitle>
            <CardDescription>
              Test the eBay image automation system with sample data
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button 
              onClick={() => testImageFinder.mutate()}
              disabled={testImageFinder.isPending}
              className="w-full"
            >
              {testImageFinder.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Run Test
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              Batch Update Images
            </CardTitle>
            <CardDescription>
              Automatically find and update images for multiple cards
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="batchSize">Max Cards to Process</Label>
              <Input
                id="batchSize"
                type="number"
                min="1"
                max="100"
                value={batchSize}
                onChange={(e) => setBatchSize(parseInt(e.target.value) || 25)}
              />
            </div>
            <Button 
              onClick={() => batchUpdateImages.mutate(batchSize)}
              disabled={batchUpdateImages.isPending}
              className="w-full"
            >
              {batchUpdateImages.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Start Batch Update
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Cards Without Images */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Image className="h-5 w-5" />
            Cards Without Images ({cardsData?.count || 0})
          </CardTitle>
          <CardDescription>
            Manually update images for specific cards
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Label htmlFor="limit">Cards to Show</Label>
              <Input
                id="limit"
                type="number"
                min="1"
                max="200"
                value={limit}
                onChange={(e) => setLimit(parseInt(e.target.value) || 20)}
              />
            </div>
            <Button 
              onClick={() => refetchCards()}
              disabled={cardsLoading}
              variant="outline"
            >
              {cardsLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Refresh
            </Button>
          </div>

          {cardsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : (
            <div className="space-y-4">
              {cards.map((card: CardWithoutImage) => (
                <div key={card.id} className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex-1 space-y-1">
                    <div className="font-medium">{card.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {card.setName} #{card.cardNumber}
                    </div>
                    {card.description && (
                      <div className="text-xs text-muted-foreground">
                        {card.description}
                      </div>
                    )}
                  </div>
                  <Button 
                    onClick={() => findCardImage.mutate(card.id)}
                    disabled={findCardImage.isPending}
                    size="sm"
                  >
                    {findCardImage.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Update Image
                  </Button>
                </div>
              ))}
              
              {cards.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  No cards without images found
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}