import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShipModal } from "@/components/marketplace/ShipModal";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { 
  Package, ShoppingBag, TrendingUp, Star, MessageCircle, 
  Truck, CheckCircle, Clock, AlertCircle, ExternalLink,
  ArrowRight, RefreshCcw, DollarSign, Wallet, CheckCircle2
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
  onReview,
  onConfirmDelivery 
}: { 
  order: OrderData; 
  type: 'purchase' | 'sale';
  onShip?: () => void;
  onMessage?: () => void;
  onReview?: () => void;
  onConfirmDelivery?: () => void;
}) {
  const status = statusConfig[order.order.status] || statusConfig.payment_pending;
  const StatusIcon = status.icon;
  const otherParty = type === 'purchase' ? order.seller : order.buyer;
  const showShipButton = type === 'sale' && ['paid', 'needs_shipping'].includes(order.order.status);
  const showReviewButton = type === 'purchase' && order.order.status === 'delivered' && !order.review;
  const showConfirmDeliveryButton = type === 'purchase' && ['shipped', 'in_transit', 'label_created'].includes(order.order.status);
  
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
              
              {showConfirmDeliveryButton && (
                <Button 
                  size="sm" 
                  variant="outline"
                  className="border-green-500 text-green-600 hover:bg-green-50"
                  onClick={onConfirmDelivery}
                  data-testid={`confirm-delivery-${order.order.id}`}
                >
                  <CheckCircle className="w-4 h-4 mr-1" />
                  Confirm Delivered
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

interface EarningsData {
  summary: {
    availableToWithdraw: string;
    pendingDelivery: string;
    pendingPayout: string;
    paidOut: string;
    totalEarnings: string;
  };
  orders: any[];
}

interface PayoutAccount {
  id: number;
  paypalEmail: string | null;
  venmoHandle: string | null;
  preferredMethod: string;
}

export default function Activity() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const searchParams = new URLSearchParams(window.location.search);
  const initialTab = searchParams.get('tab') || 'purchases';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [shipModalOrder, setShipModalOrder] = useState<{ id: number; orderNumber: string } | null>(null);
  const [showPayoutModal, setShowPayoutModal] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState('');
  const [payoutMethod, setPayoutMethod] = useState<'paypal' | 'venmo'>('paypal');
  const [paypalEmail, setPaypalEmail] = useState('');
  const [venmoHandle, setVenmoHandle] = useState('');
  
  const { data: purchases, isLoading: purchasesLoading } = useQuery<OrderData[]>({
    queryKey: ['/api/marketplace/purchases'],
  });
  
  const { data: sales, isLoading: salesLoading } = useQuery<OrderData[]>({
    queryKey: ['/api/marketplace/sales'],
  });
  
  const { data: earnings, isLoading: earningsLoading } = useQuery<EarningsData>({
    queryKey: ['/api/marketplace/earnings'],
  });
  
  const { data: payoutAccount } = useQuery<PayoutAccount>({
    queryKey: ['/api/marketplace/payout-account'],
  });
  
  const { data: payoutRequests } = useQuery<any[]>({
    queryKey: ['/api/marketplace/payout-requests'],
  });
  
  const { data: unreadNotifications } = useQuery<{ count: number }>({
    queryKey: ['/api/marketplace/notifications/unread-count'],
  });
  
  const markNotificationsReadMutation = useMutation({
    mutationFn: async () => {
      await apiRequest('POST', '/api/marketplace/notifications/mark-read', {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/marketplace/notifications/unread-count'] });
    },
  });
  
  const savePayoutAccountMutation = useMutation({
    mutationFn: async (data: { paypalEmail?: string; venmoHandle?: string; preferredMethod?: string }) => {
      const res = await apiRequest('POST', '/api/marketplace/payout-account', data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/marketplace/payout-account'] });
      toast({ title: "Payout account saved!" });
      setShowAccountModal(false);
    },
    onError: () => {
      toast({ title: "Failed to save payout account", variant: "destructive" });
    },
  });
  
  const requestPayoutMutation = useMutation({
    mutationFn: async (data: { amount: number; method: string }) => {
      const res = await apiRequest('POST', '/api/marketplace/payout-requests', data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/marketplace/payout-requests'] });
      queryClient.invalidateQueries({ queryKey: ['/api/marketplace/earnings'] });
      toast({ 
        title: "Payout requested!", 
        description: "Your payout will be processed within 5-7 business days." 
      });
      setShowPayoutModal(false);
      setPayoutAmount('');
    },
    onError: (error: any) => {
      let msg = "Failed to request payout";
      try {
        const match = error.message?.match(/\d+: (.+)/);
        if (match) {
          const parsed = JSON.parse(match[1]);
          msg = parsed.message || msg;
        }
      } catch {}
      toast({ title: msg, variant: "destructive" });
    },
  });
  
  const confirmDeliveryMutation = useMutation({
    mutationFn: async (orderId: number) => {
      const res = await apiRequest('POST', `/api/marketplace/orders/${orderId}/confirm-delivery`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/marketplace/purchases'] });
      toast({ title: "Delivery confirmed! Thank you." });
    },
    onError: () => {
      toast({ title: "Failed to confirm delivery", variant: "destructive" });
    },
  });
  
  // Mark sale notifications as read when viewing Sales tab
  useEffect(() => {
    if (activeTab === 'sales' && unreadNotifications?.count && unreadNotifications.count > 0) {
      markNotificationsReadMutation.mutate();
    }
  }, [activeTab, unreadNotifications?.count]);
  
  // Load payout account data into form
  useEffect(() => {
    if (payoutAccount) {
      setPaypalEmail(payoutAccount.paypalEmail || '');
      setVenmoHandle(payoutAccount.venmoHandle || '');
      setPayoutMethod(payoutAccount.preferredMethod as 'paypal' | 'venmo' || 'paypal');
    }
  }, [payoutAccount]);
  
  const needsShippingCount = sales?.filter(s => 
    ['paid', 'needs_shipping'].includes(s.order.status)
  ).length || 0;
  
  const saleNotificationCount = unreadNotifications?.count || 0;
  
  const handleShip = (orderId: number, orderNumber: string) => {
    setShipModalOrder({ id: orderId, orderNumber });
  };
  
  const handleMessage = (userId: number) => {
    setLocation(`/social?tab=messages&user=${userId}`);
  };
  
  const handleReview = (orderId: number) => {
    setLocation(`/activity/review/${orderId}`);
  };
  
  const handleRequestPayout = () => {
    if (!payoutAccount?.paypalEmail && !payoutAccount?.venmoHandle) {
      setShowAccountModal(true);
      return;
    }
    setShowPayoutModal(true);
  };
  
  const submitPayoutRequest = () => {
    const amount = parseFloat(payoutAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({ title: "Please enter a valid amount", variant: "destructive" });
      return;
    }
    requestPayoutMutation.mutate({ amount, method: payoutMethod });
  };
  
  const savePayoutAccount = () => {
    if (!paypalEmail && !venmoHandle) {
      toast({ title: "Please enter PayPal email or Venmo handle", variant: "destructive" });
      return;
    }
    savePayoutAccountMutation.mutate({
      paypalEmail: paypalEmail || undefined,
      venmoHandle: venmoHandle || undefined,
      preferredMethod: paypalEmail ? 'paypal' : 'venmo',
    });
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
          <TabsList className="grid w-full grid-cols-5 bg-white dark:bg-gray-800 border">
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
              {(needsShippingCount > 0 || saleNotificationCount > 0) && (
                <span className="absolute -top-1 -right-1 bg-orange-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                  {needsShippingCount + saleNotificationCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger 
              value="earnings" 
              className="data-[state=active]:bg-red-500 data-[state=active]:text-white"
              data-testid="tab-earnings"
            >
              <Wallet className="w-4 h-4 mr-2" />
              Earnings
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
                    onConfirmDelivery={() => confirmDeliveryMutation.mutate(order.order.id)}
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
                    onShip={() => handleShip(order.order.id, order.order.orderNumber)}
                    onMessage={() => order.buyer && handleMessage(order.buyer.id)}
                  />
                ))}
              </div>
            )}
          </TabsContent>
          
          <TabsContent value="earnings" className="space-y-6">
            {earningsLoading ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-500 mx-auto"></div>
                <p className="text-gray-500 mt-2">Loading earnings...</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <Card>
                    <CardContent className="pt-6 text-center">
                      <DollarSign className="w-8 h-8 text-green-500 mx-auto mb-2" />
                      <p className="text-2xl font-bold text-green-600">${earnings?.summary.availableToWithdraw || '0.00'}</p>
                      <p className="text-sm text-gray-500">Available to Withdraw</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6 text-center">
                      <Clock className="w-8 h-8 text-yellow-500 mx-auto mb-2" />
                      <p className="text-2xl font-bold text-yellow-600">${earnings?.summary.pendingDelivery || '0.00'}</p>
                      <p className="text-sm text-gray-500">Pending Delivery</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6 text-center">
                      <Truck className="w-8 h-8 text-orange-500 mx-auto mb-2" />
                      <p className="text-2xl font-bold text-orange-600">${earnings?.summary.pendingPayout || '0.00'}</p>
                      <p className="text-sm text-gray-500">Pending Payout</p>
                    </CardContent>
                  </Card>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Card>
                    <CardContent className="pt-6 text-center">
                      <CheckCircle2 className="w-8 h-8 text-blue-500 mx-auto mb-2" />
                      <p className="text-2xl font-bold text-blue-600">${earnings?.summary.paidOut || '0.00'}</p>
                      <p className="text-sm text-gray-500">Paid Out</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6 text-center">
                      <Wallet className="w-8 h-8 text-purple-500 mx-auto mb-2" />
                      <p className="text-2xl font-bold text-purple-600">${earnings?.summary.totalEarnings || '0.00'}</p>
                      <p className="text-sm text-gray-500">Total Earnings</p>
                    </CardContent>
                  </Card>
                </div>
                
                <div className="flex gap-3">
                  <Button 
                    onClick={handleRequestPayout}
                    disabled={parseFloat(earnings?.summary.availableToWithdraw || '0') <= 0}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    <DollarSign className="w-4 h-4 mr-2" />
                    Request Payout
                  </Button>
                  <Button variant="outline" onClick={() => setShowAccountModal(true)}>
                    {payoutAccount ? 'Edit Payout Account' : 'Set Up Payout Account'}
                  </Button>
                </div>
                
                {payoutRequests && payoutRequests.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Payout History</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {payoutRequests.map((req: any) => (
                          <div key={req.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                            <div>
                              <p className="font-medium">${req.amount} via {req.method}</p>
                              <p className="text-sm text-gray-500">
                                {new Date(req.createdAt).toLocaleDateString()} • {req.destination}
                              </p>
                            </div>
                            <Badge className={
                              req.status === 'paid' ? 'bg-green-100 text-green-800' :
                              req.status === 'requested' ? 'bg-yellow-100 text-yellow-800' :
                              req.status === 'approved' ? 'bg-blue-100 text-blue-800' :
                              req.status === 'rejected' ? 'bg-red-100 text-red-800' :
                              'bg-gray-100 text-gray-800'
                            }>
                              {req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
                
                {earnings?.orders && earnings.orders.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Order Breakdown</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {earnings.orders.map((order: any) => (
                          <div key={order.orderId} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg text-sm">
                            <div>
                              <p className="font-medium">Order #{order.orderNumber}</p>
                              <p className="text-gray-500">{new Date(order.createdAt).toLocaleDateString()}</p>
                            </div>
                            <div className="text-right">
                              <p className="font-medium text-green-600">${order.netAfterLabel}</p>
                              <p className="text-xs text-gray-400">
                                Item: ${order.itemPrice} | Fee: -${order.platformFee} | Label: -${order.shippingLabelCost}
                              </p>
                            </div>
                            <Badge className={
                              order.payoutStatus === 'paid' ? 'bg-green-100 text-green-800' :
                              order.status === 'delivered' ? 'bg-blue-100 text-blue-800' :
                              'bg-gray-100 text-gray-800'
                            }>
                              {order.payoutStatus === 'paid' ? 'Paid Out' : 
                               order.status === 'delivered' ? 'Eligible' : 'Pending'}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
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
        
        {shipModalOrder && (
          <ShipModal
            orderId={shipModalOrder.id}
            orderNumber={shipModalOrder.orderNumber}
            open={true}
            onClose={() => setShipModalOrder(null)}
          />
        )}
        
        <Dialog open={showPayoutModal} onOpenChange={setShowPayoutModal}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Request Payout</DialogTitle>
              <DialogDescription>
                Enter the amount you'd like to withdraw. Payouts are processed within 5-7 business days.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label>Amount</Label>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-lg">$</span>
                  <Input 
                    type="number" 
                    placeholder="0.00"
                    value={payoutAmount}
                    onChange={(e) => setPayoutAmount(e.target.value)}
                    max={parseFloat(earnings?.summary.availableToWithdraw || '0')}
                  />
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  Available: ${earnings?.summary.availableToWithdraw || '0.00'}
                </p>
              </div>
              <div>
                <Label>Payment Method</Label>
                <Select value={payoutMethod} onValueChange={(v) => setPayoutMethod(v as 'paypal' | 'venmo')}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {payoutAccount?.paypalEmail && (
                      <SelectItem value="paypal">PayPal ({payoutAccount.paypalEmail})</SelectItem>
                    )}
                    {payoutAccount?.venmoHandle && (
                      <SelectItem value="venmo">Venmo ({payoutAccount.venmoHandle})</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowPayoutModal(false)}>Cancel</Button>
              <Button 
                onClick={submitPayoutRequest}
                disabled={requestPayoutMutation.isPending}
                className="bg-green-600 hover:bg-green-700"
              >
                {requestPayoutMutation.isPending ? 'Requesting...' : 'Request Payout'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        
        <Dialog open={showAccountModal} onOpenChange={setShowAccountModal}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Payout Account</DialogTitle>
              <DialogDescription>
                Set up your PayPal or Venmo account to receive payouts.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label>PayPal Email</Label>
                <Input 
                  type="email" 
                  placeholder="your@email.com"
                  value={paypalEmail}
                  onChange={(e) => setPaypalEmail(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Venmo Handle</Label>
                <Input 
                  placeholder="@username"
                  value={venmoHandle}
                  onChange={(e) => setVenmoHandle(e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAccountModal(false)}>Cancel</Button>
              <Button 
                onClick={savePayoutAccount}
                disabled={savePayoutAccountMutation.isPending}
              >
                {savePayoutAccountMutation.isPending ? 'Saving...' : 'Save Account'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
