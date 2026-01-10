import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { 
  DollarSign, Clock, CheckCircle, XCircle, AlertTriangle, 
  ExternalLink, User, ArrowLeft 
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

interface PayoutRequest {
  request: {
    id: number;
    sellerId: number;
    amount: string;
    method: string;
    destination: string;
    status: string;
    adminNotes: string | null;
    breakdownJson: string | null;
    createdAt: string;
    processedAt: string | null;
  };
  seller: {
    id: number;
    username: string;
    email: string;
  };
}

const statusColors: Record<string, string> = {
  requested: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-blue-100 text-blue-800',
  paid: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  on_hold: 'bg-gray-100 text-gray-800',
};

const statusIcons: Record<string, any> = {
  requested: Clock,
  approved: CheckCircle,
  paid: DollarSign,
  rejected: XCircle,
  on_hold: AlertTriangle,
};

export default function AdminPayouts() {
  const [, setLocation] = useLocation();
  const [selectedRequest, setSelectedRequest] = useState<PayoutRequest | null>(null);
  const [newStatus, setNewStatus] = useState('');
  const [adminNotes, setAdminNotes] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: requests = [], isLoading } = useQuery<PayoutRequest[]>({
    queryKey: ['/api/admin/payout-requests', filterStatus],
    queryFn: async () => {
      const url = filterStatus === 'all' 
        ? '/api/admin/payout-requests' 
        : `/api/admin/payout-requests?status=${filterStatus}`;
      return apiRequest('GET', url).then(res => res.json());
    }
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status, adminNotes }: { id: number; status: string; adminNotes?: string }) => {
      return apiRequest('PATCH', `/api/admin/payout-requests/${id}`, { status, adminNotes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/payout-requests'] });
      toast({ title: "Payout request updated" });
      setSelectedRequest(null);
      setNewStatus('');
      setAdminNotes('');
    },
    onError: () => {
      toast({ title: "Failed to update payout request", variant: "destructive" });
    }
  });

  const handleUpdateStatus = () => {
    if (!selectedRequest || !newStatus) return;
    updateStatusMutation.mutate({
      id: selectedRequest.request.id,
      status: newStatus,
      adminNotes: adminNotes || undefined,
    });
  };

  const openUpdateDialog = (request: PayoutRequest) => {
    setSelectedRequest(request);
    setNewStatus(request.request.status);
    setAdminNotes(request.request.adminNotes || '');
  };

  const pendingCount = requests.filter(r => r.request.status === 'requested').length;
  const totalRequested = requests.reduce((sum, r) => {
    if (r.request.status === 'requested') {
      return sum + parseFloat(r.request.amount);
    }
    return sum;
  }, 0);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-6xl mx-auto p-6">
        <div className="flex items-center gap-4 mb-6">
          <Button variant="ghost" size="sm" onClick={() => setLocation('/admin/users')}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Admin
          </Button>
        </div>
        
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Payout Management</h1>
            <p className="text-gray-500">Review and process seller payout requests</p>
          </div>
          
          <div className="flex items-center gap-4">
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Filter status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Requests</SelectItem>
                <SelectItem value="requested">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="on_hold">On Hold</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-4 mb-6">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <Clock className="w-10 h-10 text-yellow-500" />
                <div>
                  <p className="text-3xl font-bold text-yellow-600">{pendingCount}</p>
                  <p className="text-sm text-gray-500">Pending Requests</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <DollarSign className="w-10 h-10 text-green-500" />
                <div>
                  <p className="text-3xl font-bold text-green-600">${totalRequested.toFixed(2)}</p>
                  <p className="text-sm text-gray-500">Total Pending Amount</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
        
        {isLoading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-500 mx-auto"></div>
            <p className="text-gray-500 mt-2">Loading payout requests...</p>
          </div>
        ) : requests.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <DollarSign className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-600">No Payout Requests</h3>
              <p className="text-gray-500">No payout requests match your filter.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {requests.map(item => {
              const StatusIcon = statusIcons[item.request.status] || Clock;
              return (
                <Card key={item.request.id} className="overflow-hidden">
                  <div className="flex items-start p-4 gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <Badge className={statusColors[item.request.status] || 'bg-gray-100'}>
                          <StatusIcon className="w-3 h-3 mr-1" />
                          {item.request.status.replace('_', ' ').charAt(0).toUpperCase() + item.request.status.slice(1)}
                        </Badge>
                        <span className="text-2xl font-bold text-green-600">${item.request.amount}</span>
                        <span className="text-gray-500">via {item.request.method}</span>
                      </div>
                      
                      <div className="flex items-center gap-4 text-sm text-gray-500 mb-2">
                        <span className="flex items-center gap-1">
                          <User className="w-4 h-4" />
                          {item.seller.username} ({item.seller.email})
                        </span>
                        <span>
                          {new Date(item.request.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      
                      <p className="text-sm text-gray-600">
                        <strong>Destination:</strong> {item.request.destination}
                      </p>
                      
                      {item.request.adminNotes && (
                        <p className="text-sm text-gray-500 mt-2 italic">
                          Note: {item.request.adminNotes}
                        </p>
                      )}
                      
                      {item.request.processedAt && (
                        <p className="text-xs text-gray-400 mt-1">
                          Processed: {new Date(item.request.processedAt).toLocaleString()}
                        </p>
                      )}
                    </div>
                    
                    <div className="flex flex-col gap-2">
                      <Button 
                        size="sm" 
                        onClick={() => openUpdateDialog(item)}
                      >
                        Update Status
                      </Button>
                      {item.request.method === 'paypal' && (
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={() => window.open(`https://www.paypal.com/cgi-bin/webscr?cmd=_xclick&business=${item.request.destination}&amount=${item.request.amount}&currency_code=USD`, '_blank')}
                        >
                          <ExternalLink className="w-4 h-4 mr-1" />
                          Pay via PayPal
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
        
        <Dialog open={!!selectedRequest} onOpenChange={() => setSelectedRequest(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Update Payout Status</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label>New Status</Label>
                <Select value={newStatus} onValueChange={setNewStatus}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="requested">Pending</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                    <SelectItem value="on_hold">On Hold</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Admin Notes</Label>
                <Textarea 
                  placeholder="Optional notes about this payout..."
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSelectedRequest(null)}>Cancel</Button>
              <Button 
                onClick={handleUpdateStatus}
                disabled={updateStatusMutation.isPending}
              >
                {updateStatusMutation.isPending ? 'Updating...' : 'Update Status'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
