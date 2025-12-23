import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { 
  Package, ShoppingBag, TrendingUp, Star, MessageCircle, 
  Truck, CheckCircle, Clock, AlertCircle, ExternalLink,
  ArrowRight, RefreshCcw
} from "lucide-react";

type OrderStatus = 'payment_pending' | 'paid' | 'needs_shipping' | 'label_created' | 'shipped' | 'in_transit' | 'delivered' | 'complete' | 'cancelled' | 'refunded';

interface OrderData {
  order: {
    id: number;
    orderNumber: string;
    quantity: number;
    itemPrice: string;
    shippingCost: string;
    total: string;
    status: OrderStatus;
    createdAt: string;
    deliveredAt: string | null;
  };
  listing: {
    id: number;
    price: string;
    conditionSnapshot: string;
  };
  card: {
    id: number;
    name: string;
    cardNumber: string;
    frontImageUrl: string | null;
  };
  cardSet: {
    id: number;
    name: string;
    year: number;
  };
  seller?: {
    id: number;
    username: string;
    displayName: string | null;
    photoURL: string | null;
  };
  buyer?: {
    id: number;
    username: string;
    displayName: string | null;
    photoURL: string | null;
  };
  shipment?: {
    trackingNumber: string | null;
    trackingUrl: string | null;
    carrier: string | null;
    status: string;
  } | null;
  review?: {
    rating: number;
    comment: string | null;
  } | null;
}

const statusConfig: Record<OrderStatus, { label: string; color: string; icon: any }> = {
  payment_pending: { label: 'Payment Pending', color: 'bg-yellow-100 text-yellow-800', icon: Clock },
  paid: { label: 'Paid', color: 'bg-green-100 text-green-800', icon: CheckCircle },
  needs_shipping: { label: 'Needs Shipping', color: 'bg-orange-100 text-orange-800', icon: Package },
  label_created: { label: 'Label Created', color: 'bg-blue-100 text-blue-800', icon: Package },
  shipped: { label: 'Shipped', color: 'bg-blue-100 text-blue-800', icon: Truck },
  in_transit: { label: 'In Transit', color: 'bg-blue-100 text-blue-800', icon: Truck },
  delivered: { label: 'Delivered', color: 'bg-green-100 text-green-800', icon: CheckCircle },
  complete: { label: 'Complete', color: 'bg-green-100 text-green-800', icon: CheckCircle },
  cancelled: { label: 'Cancelled', color: 'bg-red-100 text-red-800', icon: AlertCircle },
  refunded: { label: 'Refunded', color: 'bg-gray-100 text-gray-800', icon: RefreshCcw },
};

function OrderCard({ 
  order, 
  type, 
  onShip, 
  onMessage, 
  onReview 
}: { 
  order: OrderData; 
  type: 'purchase' | 'sale';
  onShip?: () => void;
  onMessage?: () => void;
  onReview?: () => void;
}) {
  const status = statusConfig[order.order.status] || statusConfig.payment_pending;
  const StatusIcon = status.icon;
  const otherParty = type === 'purchase' ? order.seller : order.buyer;
  const showShipButton = type === 'sale' && ['paid', 'needs_shipping'].includes(order.order.status);
  const showReviewButton = type === 'purchase' && order.order.status === 'delivered' && !order.review;
  
  return (
    <Card className="overflow-hidden" data-testid={`order-card-${order.order.id}`}>
      <div className="flex">
        <div className="w-24 h-24 bg-gray-100 flex-shrink-0">
          {order.card.frontImageUrl ? (
            <img 
              src={order.card.frontImageUrl} 
              alt={order.card.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400">
              <Package className="w-8 h-8" />
            </div>
          )}
        </div>
        
        <div className="flex-1 p-4">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">
                {order.card.name}
              </h3>
              <p className="text-sm text-gray-500">
                {order.cardSet.name} ({order.cardSet.year}) #{order.card.cardNumber}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Order #{order.order.orderNumber}
              </p>
            </div>
            
            <div className="text-right">
              <Badge className={status.color}>
                <StatusIcon className="w-3 h-3 mr-1" />
                {status.label}
              </Badge>
              <p className="text-lg font-bold text-gray-900 dark:text-white mt-1">
                ${parseFloat(order.order.total).toFixed(2)}
              </p>
            </div>
          </div>
          
          <Separator className="my-3" />
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Avatar className="w-6 h-6">
                <AvatarImage src={otherParty?.photoURL || undefined} />
                <AvatarFallback className="text-xs bg-gray-200">
                  {(otherParty?.displayName || otherParty?.username || '?').charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="text-sm text-gray-600">
                {type === 'purchase' ? 'Seller: ' : 'Buyer: '}
                {otherParty?.displayName || otherParty?.username}
              </span>
            </div>
            
            <div className="flex items-center gap-2">
              {order.shipment?.trackingNumber && (
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => order.shipment?.trackingUrl && window.open(order.shipment.trackingUrl, '_blank')}
                  data-testid={`track-package-${order.order.id}`}
                >
                  <Truck className="w-4 h-4 mr-1" />
                  Track
                </Button>
              )}
              
              {showShipButton && (
                <Button 
                  size="sm" 
                  className="bg-orange-500 hover:bg-orange-600"
                  onClick={onShip}
                  data-testid={`ship-order-${order.order.id}`}
                >
                  <Package className="w-4 h-4 mr-1" />
                  Ship
                </Button>
              )}
              
              {showReviewButton && (
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={onReview}
                  data-testid={`review-order-${order.order.id}`}
                >
                  <Star className="w-4 h-4 mr-1" />
                  Review
                </Button>
              )}
              
              <Button 
                variant="ghost" 
                size="sm"
                onClick={onMessage}
                data-testid={`message-${order.order.id}`}
              >
                <MessageCircle className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

export default function Activity() {
  const [, setLocation] = useLocation();
  const searchParams = new URLSearchParams(window.location.search);
  const initialTab = searchParams.get('tab') || 'purchases';
  const [activeTab, setActiveTab] = useState(initialTab);
  
  const { data: purchases, isLoading: purchasesLoading } = useQuery<OrderData[]>({
    queryKey: ['/api/marketplace/purchases'],
  });
  
  const { data: sales, isLoading: salesLoading } = useQuery<OrderData[]>({
    queryKey: ['/api/marketplace/sales'],
  });
  
  const needsShippingCount = sales?.filter(s => 
    ['paid', 'needs_shipping'].includes(s.order.status)
  ).length || 0;
  
  const handleShip = (orderId: number) => {
    setLocation(`/activity/ship/${orderId}`);
  };
  
  const handleMessage = (userId: number) => {
    setLocation(`/social?tab=messages&user=${userId}`);
  };
  
  const handleReview = (orderId: number) => {
    setLocation(`/activity/review/${orderId}`);
  };
  
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Activity Center</h1>
            <p className="text-gray-500">Track your purchases, sales, and reviews</p>
          </div>
        </div>
        
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-4 bg-white dark:bg-gray-800 border">
            <TabsTrigger 
              value="purchases" 
              className="data-[state=active]:bg-red-500 data-[state=active]:text-white"
              data-testid="tab-purchases"
            >
              <ShoppingBag className="w-4 h-4 mr-2" />
              Purchases
            </TabsTrigger>
            <TabsTrigger 
              value="sales" 
              className="data-[state=active]:bg-red-500 data-[state=active]:text-white relative"
              data-testid="tab-sales"
            >
              <Package className="w-4 h-4 mr-2" />
              Sales
              {needsShippingCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-orange-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                  {needsShippingCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger 
              value="trades" 
              className="data-[state=active]:bg-red-500 data-[state=active]:text-white"
              data-testid="tab-trades"
            >
              <TrendingUp className="w-4 h-4 mr-2" />
              Trades
            </TabsTrigger>
            <TabsTrigger 
              value="reviews" 
              className="data-[state=active]:bg-red-500 data-[state=active]:text-white"
              data-testid="tab-reviews"
            >
              <Star className="w-4 h-4 mr-2" />
              Reviews
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="purchases" className="space-y-4">
            {purchasesLoading ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-500 mx-auto"></div>
                <p className="text-gray-500 mt-2">Loading purchases...</p>
              </div>
            ) : purchases?.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <ShoppingBag className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-gray-600">No purchases yet</h3>
                  <p className="text-gray-500 mb-4">Browse the marketplace to find your next card!</p>
                  <Button onClick={() => setLocation('/marketplace')} data-testid="browse-marketplace">
                    Browse Marketplace
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {purchases?.map(order => (
                  <OrderCard 
                    key={order.order.id}
                    order={order}
                    type="purchase"
                    onMessage={() => order.seller && handleMessage(order.seller.id)}
                    onReview={() => handleReview(order.order.id)}
                  />
                ))}
              </div>
            )}
          </TabsContent>
          
          <TabsContent value="sales" className="space-y-4">
            {salesLoading ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-500 mx-auto"></div>
                <p className="text-gray-500 mt-2">Loading sales...</p>
              </div>
            ) : sales?.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Package className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-gray-600">No sales yet</h3>
                  <p className="text-gray-500 mb-4">List a card from your collection to start selling!</p>
                  <Button onClick={() => setLocation('/my-collection')} data-testid="go-to-collection">
                    Go to Collection
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {sales?.map(order => (
                  <OrderCard 
                    key={order.order.id}
                    order={order}
                    type="sale"
                    onShip={() => handleShip(order.order.id)}
                    onMessage={() => order.buyer && handleMessage(order.buyer.id)}
                  />
                ))}
              </div>
            )}
          </TabsContent>
          
          <TabsContent value="trades" className="space-y-4">
            <Card>
              <CardContent className="py-12 text-center">
                <TrendingUp className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-600">Trade Block Coming Soon</h3>
                <p className="text-gray-500">
                  Soon you'll be able to create trade listings and swap cards with other collectors!
                </p>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="reviews" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Star className="w-5 h-5 text-yellow-500" />
                  Your Reviews
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-500 text-center py-8">
                  Reviews you've given and received will appear here after completed transactions.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
