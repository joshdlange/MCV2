import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Package, Truck, DollarSign, Clock, Check, ExternalLink } from "lucide-react";

interface ShipModalProps {
  orderId: number;
  orderNumber: string;
  open: boolean;
  onClose: () => void;
}

interface ParcelPreset {
  id: string;
  name: string;
  length: number;
  width: number;
  height: number;
  weight: number;
}

interface ShippingRate {
  objectId: string;
  provider: string;
  servicelevel: { name: string; token: string };
  amount: string;
  currency: string;
  estimatedDays: number;
  durationTerms: string;
}

export function ShipModal({ orderId, orderNumber, open, onClose }: ShipModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedPreset, setSelectedPreset] = useState<string>("standard_toploader");
  const [selectedRate, setSelectedRate] = useState<string | null>(null);
  
  const { data: presets } = useQuery<ParcelPreset[]>({
    queryKey: ['/api/marketplace/shipping/presets'],
    enabled: open,
  });
  
  const { data: shipment } = useQuery<any>({
    queryKey: ['/api/marketplace/orders', orderId, 'shipment'],
    enabled: open,
  });
  
  const getRatesMutation = useMutation({
    mutationFn: async (preset: ParcelPreset) => {
      const res = await apiRequest('POST', `/api/marketplace/orders/${orderId}/shipping/rates`, { parcel: preset });
      return await res.json();
    },
  });
  
  const purchaseLabelMutation = useMutation({
    mutationFn: async (rateId: string) => {
      const res = await apiRequest('POST', `/api/marketplace/orders/${orderId}/shipping/purchase`, { rateId });
      return await res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Label Purchased!",
        description: `Tracking: ${data.trackingNumber}`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/marketplace/orders', orderId, 'shipment'] });
      queryClient.invalidateQueries({ queryKey: ['/api/marketplace/sales'] });
      onClose();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to purchase shipping label",
        variant: "destructive",
      });
    },
  });
  
  const handleGetRates = () => {
    const preset = presets?.find(p => p.id === selectedPreset);
    if (preset) {
      getRatesMutation.mutate(preset);
    }
  };
  
  const handlePurchaseLabel = () => {
    if (selectedRate) {
      purchaseLabelMutation.mutate(selectedRate);
    }
  };
  
  const rates = getRatesMutation.data?.rates || [];
  
  if (shipment?.labelUrl) {
    return (
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Shipping Label Ready</DialogTitle>
            <DialogDescription>
              Order #{orderNumber}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <Card className="bg-green-50 border-green-200">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <Check className="w-8 h-8 text-green-600" />
                  <div>
                    <p className="font-semibold text-green-800">Label Purchased</p>
                    <p className="text-sm text-green-600">{shipment.carrier} - {shipment.serviceLevel}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Tracking Number:</span>
                <span className="font-mono font-medium">{shipment.trackingNumber}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Status:</span>
                <Badge variant="secondary">{shipment.status}</Badge>
              </div>
            </div>
            
            <div className="flex gap-2">
              <Button 
                className="flex-1"
                onClick={() => window.open(shipment.labelUrl, '_blank')}
                data-testid="download-label"
              >
                <Package className="w-4 h-4 mr-2" />
                Download Label
              </Button>
              {shipment.trackingUrl && (
                <Button 
                  variant="outline"
                  onClick={() => window.open(shipment.trackingUrl, '_blank')}
                  data-testid="track-shipment"
                >
                  <ExternalLink className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }
  
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ship Order</DialogTitle>
          <DialogDescription>
            Order #{orderNumber} - Select package size and shipping service
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-6">
          <div className="space-y-3">
            <label className="text-sm font-medium">Package Size</label>
            <Select value={selectedPreset} onValueChange={setSelectedPreset}>
              <SelectTrigger data-testid="select-package-size">
                <SelectValue placeholder="Select package size" />
              </SelectTrigger>
              <SelectContent>
                {presets?.map(preset => (
                  <SelectItem key={preset.id} value={preset.id}>
                    <div className="flex items-center gap-2">
                      <Package className="w-4 h-4 text-gray-500" />
                      {preset.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <Button 
              onClick={handleGetRates}
              disabled={getRatesMutation.isPending}
              className="w-full"
              data-testid="get-rates"
            >
              {getRatesMutation.isPending ? "Getting Rates..." : "Get Shipping Rates"}
            </Button>
          </div>
          
          {rates.length > 0 && (
            <>
              <Separator />
              
              <div className="space-y-3">
                <label className="text-sm font-medium">Select Shipping Service</label>
                
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {rates.map((rate: ShippingRate) => (
                    <Card 
                      key={rate.objectId}
                      className={`cursor-pointer transition-all ${
                        selectedRate === rate.objectId 
                          ? 'ring-2 ring-red-500 bg-red-50' 
                          : 'hover:bg-gray-50'
                      }`}
                      onClick={() => setSelectedRate(rate.objectId)}
                      data-testid={`rate-${rate.objectId}`}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <Truck className="w-5 h-5 text-gray-500" />
                            <div>
                              <p className="font-medium text-sm">{rate.provider}</p>
                              <p className="text-xs text-gray-500">{rate.servicelevel?.name}</p>
                            </div>
                          </div>
                          
                          <div className="text-right">
                            <div className="flex items-center gap-1 font-bold text-green-600">
                              <DollarSign className="w-4 h-4" />
                              {rate.amount}
                            </div>
                            <div className="flex items-center gap-1 text-xs text-gray-500">
                              <Clock className="w-3 h-3" />
                              {rate.estimatedDays} {rate.estimatedDays === 1 ? 'day' : 'days'}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
              
              <Button 
                onClick={handlePurchaseLabel}
                disabled={!selectedRate || purchaseLabelMutation.isPending}
                className="w-full bg-green-600 hover:bg-green-700"
                data-testid="purchase-label"
              >
                {purchaseLabelMutation.isPending ? "Purchasing..." : "Purchase Shipping Label"}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
