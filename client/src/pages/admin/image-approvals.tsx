import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CheckCircle, XCircle, Image, User, Calendar, Loader2, AlertCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { convertGoogleDriveUrl } from "@/lib/utils";

interface PendingSubmission {
  id: number;
  userId: number;
  cardId: number;
  frontImageUrl: string | null;
  backImageUrl: string | null;
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason: string | null;
  reviewedBy: number | null;
  reviewedAt: string | null;
  createdAt: string;
  user: {
    id: number;
    username: string;
    email: string;
    photoURL: string | null;
  };
  card: {
    id: number;
    name: string;
    cardNumber: string;
    frontImageUrl: string | null;
    backImageUrl: string | null;
    set: {
      id: number;
      name: string;
      year: number;
    };
  };
}

export default function AdminImageApprovals() {
  const [selectedSubmission, setSelectedSubmission] = useState<PendingSubmission | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch pending submissions
  const { data: submissions = [], isLoading } = useQuery({
    queryKey: ['/api/admin/pending-images'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/admin/pending-images');
      const data = await response.json();
      return (data.items || data) as PendingSubmission[];
    }
  });

  // Approve mutation
  const approveMutation = useMutation({
    mutationFn: async (submissionId: number) => {
      return apiRequest('POST', `/api/admin/pending-images/${submissionId}/approve`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/pending-images'] });
      queryClient.invalidateQueries({ queryKey: ['/api/cards'] });
      toast({ 
        title: "Image approved!",
        description: "The image has been added to the card database."
      });
      setSelectedSubmission(null);
    },
    onError: (error: any) => {
      toast({ 
        title: "Approval failed", 
        description: error.message,
        variant: "destructive" 
      });
    }
  });

  // Reject mutation
  const rejectMutation = useMutation({
    mutationFn: async ({ submissionId, reason }: { submissionId: number; reason: string }) => {
      return apiRequest('POST', `/api/admin/pending-images/${submissionId}/reject`, { reason });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/pending-images'] });
      toast({ 
        title: "Image rejected",
        description: "The submitter has been notified."
      });
      setShowRejectDialog(false);
      setSelectedSubmission(null);
      setRejectionReason("");
    },
    onError: (error: any) => {
      toast({ 
        title: "Rejection failed", 
        description: error.message,
        variant: "destructive" 
      });
    }
  });

  const handleApprove = (submission: PendingSubmission) => {
    approveMutation.mutate(submission.id);
  };

  const handleReject = () => {
    if (!selectedSubmission) return;
    if (!rejectionReason.trim()) {
      toast({
        title: "Rejection reason required",
        description: "Please provide a reason for rejection",
        variant: "destructive"
      });
      return;
    }
    rejectMutation.mutate({ 
      submissionId: selectedSubmission.id, 
      reason: rejectionReason 
    });
  };

  const pendingSubmissions = submissions.filter(s => s.status === 'pending');
  const reviewedSubmissions = submissions.filter(s => s.status !== 'pending');

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bebas tracking-wide text-gray-900 dark:text-white">
            User Image Submissions
          </h1>
          <p className="text-gray-600 dark:text-gray-300">
            Review and approve community-contributed card images
          </p>
        </div>
        <div className="flex gap-2">
          <Badge variant="secondary" className="text-lg px-4 py-2">
            {pendingSubmissions.length} Pending
          </Badge>
        </div>
      </div>

      {/* Pending Submissions */}
      {pendingSubmissions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <CheckCircle className="w-16 h-16 text-green-500 mb-4" />
            <p className="text-lg font-medium text-gray-900 dark:text-white">All caught up!</p>
            <p className="text-sm text-gray-600 dark:text-gray-300">No pending image submissions to review</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {pendingSubmissions.map((submission) => (
            <Card key={submission.id} className="border-2 border-orange-200 bg-orange-50/50 dark:bg-orange-950/20" data-testid={`submission-${submission.id}`}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-lg text-gray-900 dark:text-white">
                      {submission.card.name} #{submission.card.cardNumber}
                    </CardTitle>
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                      {submission.card.set.name} ({submission.card.set.year})
                    </p>
                  </div>
                  <Badge className="bg-orange-500">Pending</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Submitter Info */}
                <div className="flex items-center gap-3 p-3 bg-white dark:bg-gray-900 rounded-lg border">
                  <div className="w-10 h-10 rounded-full bg-marvel-red flex items-center justify-center text-white font-bold">
                    {submission.user.photoURL ? (
                      <img src={submission.user.photoURL} alt={submission.user.username} className="w-full h-full rounded-full" />
                    ) : (
                      <User className="w-5 h-5" />
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-gray-900 dark:text-white">{submission.user.username}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(submission.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                {/* Image Previews */}
                <div className="grid grid-cols-2 gap-4">
                  {/* Current Images */}
                  <div className="space-y-2">
                    <Label className="text-xs text-gray-600 dark:text-gray-300">Current Front</Label>
                    <div className="aspect-[2.5/3.5] rounded border bg-gray-100 dark:bg-gray-800 overflow-hidden">
                      {submission.card.frontImageUrl ? (
                        <img
                          src={convertGoogleDriveUrl(submission.card.frontImageUrl)}
                          alt="Current front"
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-400">
                          <AlertCircle className="w-8 h-8" />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Submitted Front */}
                  <div className="space-y-2">
                    <Label className="text-xs font-medium text-green-600 dark:text-green-400">Submitted Front</Label>
                    <div className="aspect-[2.5/3.5] rounded border-2 border-green-500 bg-gray-100 dark:bg-gray-800 overflow-hidden">
                      {submission.frontImageUrl ? (
                        <img
                          src={submission.frontImageUrl}
                          alt="Submitted front"
                          className="w-full h-full object-contain"
                          data-testid="img-submitted-front"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-400">
                          <AlertCircle className="w-8 h-8" />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Current Back */}
                  {submission.card.backImageUrl && (
                    <div className="space-y-2">
                      <Label className="text-xs text-gray-600 dark:text-gray-300">Current Back</Label>
                      <div className="aspect-[2.5/3.5] rounded border bg-gray-100 dark:bg-gray-800 overflow-hidden">
                        <img
                          src={convertGoogleDriveUrl(submission.card.backImageUrl)}
                          alt="Current back"
                          className="w-full h-full object-contain"
                        />
                      </div>
                    </div>
                  )}

                  {/* Submitted Back */}
                  {submission.backImageUrl && (
                    <div className="space-y-2">
                      <Label className="text-xs font-medium text-green-600 dark:text-green-400">Submitted Back</Label>
                      <div className="aspect-[2.5/3.5] rounded border-2 border-green-500 bg-gray-100 dark:bg-gray-800 overflow-hidden">
                        <img
                          src={submission.backImageUrl}
                          alt="Submitted back"
                          className="w-full h-full object-contain"
                          data-testid="img-submitted-back"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={() => handleApprove(submission)}
                    disabled={approveMutation.isPending}
                    className="flex-1 bg-green-600 hover:bg-green-700"
                    data-testid="button-approve"
                  >
                    {approveMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <CheckCircle className="w-4 h-4 mr-2" />
                    )}
                    Approve
                  </Button>
                  <Button
                    onClick={() => {
                      setSelectedSubmission(submission);
                      setShowRejectDialog(true);
                    }}
                    disabled={rejectMutation.isPending}
                    variant="destructive"
                    className="flex-1"
                    data-testid="button-reject"
                  >
                    <XCircle className="w-4 h-4 mr-2" />
                    Reject
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Recently Reviewed */}
      {reviewedSubmissions.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Recently Reviewed</h2>
          <div className="space-y-2">
            {reviewedSubmissions.slice(0, 10).map((submission) => (
              <Card key={submission.id} className={submission.status === 'approved' ? 'bg-green-50 dark:bg-green-950/20' : 'bg-red-50 dark:bg-red-950/20'}>
                <CardContent className="py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <p className="font-medium text-gray-900 dark:text-white">
                        {submission.card.name} #{submission.card.cardNumber}
                      </p>
                      <p className="text-sm text-gray-600 dark:text-gray-300">
                        Submitted by {submission.user.username}
                      </p>
                    </div>
                    <Badge className={submission.status === 'approved' ? 'bg-green-600' : 'bg-red-600'}>
                      {submission.status === 'approved' ? 'Approved' : 'Rejected'}
                    </Badge>
                  </div>
                  {submission.rejectionReason && (
                    <p className="text-sm text-red-600 dark:text-red-400 mt-2">
                      Reason: {submission.rejectionReason}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Rejection Dialog */}
      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Image Submission</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="rejectionReason">Rejection Reason</Label>
              <Textarea
                id="rejectionReason"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Please explain why this image is being rejected (e.g., 'Image is blurry', 'Wrong card', 'Poor lighting')"
                rows={4}
                className="mt-2"
                data-testid="input-rejection-reason"
              />
              <p className="text-xs text-gray-500 mt-1">
                This reason will be shown to the user
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleReject}
                disabled={rejectMutation.isPending || !rejectionReason.trim()}
                variant="destructive"
                className="flex-1"
                data-testid="button-confirm-reject"
              >
                {rejectMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Rejecting...
                  </>
                ) : (
                  <>
                    <XCircle className="w-4 h-4 mr-2" />
                    Confirm Rejection
                  </>
                )}
              </Button>
              <Button
                onClick={() => {
                  setShowRejectDialog(false);
                  setRejectionReason("");
                }}
                variant="outline"
                className="flex-1"
              >
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
