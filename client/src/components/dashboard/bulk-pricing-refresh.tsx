import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { RefreshCw, DollarSign, AlertCircle, CheckCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface BulkPricingResult {
  message: string;
  processed: number;
  successful: number;
  remaining: number;
}

export function BulkPricingRefresh() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [progress, setProgress] = useState<BulkPricingResult | null>(null);
  const { toast } = useToast();

  const handleBulkRefresh = async () => {
    if (isRefreshing) return;

    setIsRefreshing(true);
    setProgress(null);

    try {
      const response = await apiRequest("POST", "/api/bulk-pricing-refresh");
      
      if (!response.ok) {
        throw new Error("Failed to start bulk pricing refresh");
      }

      const result: BulkPricingResult = await response.json();
      setProgress(result);

      if (result.successful > 0) {
        toast({
          title: "Pricing Updated",
          description: `Successfully updated ${result.successful} cards with real market data`,
        });
      } else if (result.processed === 0) {
        toast({
          title: "All Up to Date", 
          description: "All cards already have current pricing data",
        });
      } else {
        toast({
          title: "Partial Success",
          description: `Updated ${result.successful} of ${result.processed} cards`,
          variant: "default",
        });
      }

    } catch (error: any) {
      console.error("Bulk pricing refresh failed:", error);
      toast({
        title: "Update Failed",
        description: "Unable to refresh pricing data. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <DollarSign className="h-5 w-5 text-green-600" />
          Collection Value Update
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Update your collection with real eBay market values. This will fetch current pricing data for cards that don't have recent market information.
        </p>

        {progress && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              {progress.successful > 0 ? (
                <CheckCircle className="h-4 w-4 text-green-600" />
              ) : (
                <AlertCircle className="h-4 w-4 text-yellow-600" />
              )}
              <span>{progress.message}</span>
            </div>
            
            {progress.processed > 0 && (
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Cards processed: {progress.processed}</span>
                  <span>Successful: {progress.successful}</span>
                </div>
                <Progress 
                  value={progress.processed > 0 ? (progress.successful / progress.processed) * 100 : 0} 
                  className="h-2"
                />
              </div>
            )}

            {progress.remaining > 0 && (
              <p className="text-xs text-muted-foreground">
                {progress.remaining} cards still need pricing updates. Run again to continue.
              </p>
            )}
          </div>
        )}

        <Button 
          onClick={handleBulkRefresh}
          disabled={isRefreshing}
          className="w-full"
          variant="outline"
        >
          {isRefreshing ? (
            <>
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              Updating Prices...
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4 mr-2" />
              Update Collection Values
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}