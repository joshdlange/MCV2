import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { CheckCircle, XCircle, Image, User, Calendar, Loader2, AlertCircle, ScanLine, Link2, ChevronDown, ChevronUp, ShieldCheck, UserPlus, X } from "lucide-react";
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
  source: 'manual_upload' | 'scan_to_add';
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

interface TrustedUploader {
  id: number;
  username: string;
  email: string;
  photoURL: string | null;
}

function TrustedUploadersCard() {
  const [identifier, setIdentifier] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: trusted = [], isLoading } = useQuery({
    queryKey: ['/api/admin/trusted-uploaders'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/admin/trusted-uploaders');
      return (await response.json()) as TrustedUploader[];
    }
  });

  const toggleMutation = useMutation({
    mutationFn: async (payload: { identifier?: string; userId?: number; trusted: boolean }) => {
      const response = await apiRequest('POST', '/api/admin/trusted-uploaders', payload);
      return await response.json();
    },
    onSuccess: (data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/trusted-uploaders'] });
      setIdentifier("");
      toast({
        title: vars.trusted ? "Trusted uploader added" : "Trusted uploader removed",
        description: vars.trusted
          ? `${data.username}'s image uploads will now be approved automatically.`
          : `${data.username}'s uploads will go through the approval queue again.`,
      });
    },
    onError: (error: any) => {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
    }
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2 text-gray-900 dark:text-white">
          <ShieldCheck className="w-5 h-5 text-green-600" />
          Trusted Uploaders
        </CardTitle>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          These users skip the approval queue — their card images go live immediately.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            placeholder="Username or email…"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && identifier.trim()) {
                toggleMutation.mutate({ identifier: identifier.trim(), trusted: true });
              }
            }}
            className="bg-white text-gray-900 max-w-sm"
            data-testid="input-trusted-identifier"
          />
          <Button
            onClick={() => toggleMutation.mutate({ identifier: identifier.trim(), trusted: true })}
            disabled={!identifier.trim() || toggleMutation.isPending}
            className="bg-green-600 hover:bg-green-700"
            data-testid="button-add-trusted"
          >
            {toggleMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <UserPlus className="w-4 h-4 mr-2" />
            )}
            Add
          </Button>
        </div>
        {isLoading ? (
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
        ) : trusted.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No trusted uploaders yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {trusted.map((u) => (
              <span
                key={u.id}
                className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-full bg-green-50 dark:bg-green-950/30 border border-green-300 dark:border-green-800 text-sm text-green-800 dark:text-green-300"
                data-testid={`trusted-user-${u.id}`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                {u.username}
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Remove ${u.username} from trusted uploaders? Their future uploads will need approval again.`)) {
                      toggleMutation.mutate({ userId: u.id, trusted: false });
                    }
                  }}
                  className="ml-0.5 p-0.5 rounded-full hover:bg-green-200 dark:hover:bg-green-900"
                  aria-label={`Remove ${u.username}`}
                  data-testid={`button-remove-trusted-${u.id}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminImageApprovals() {
  // Per-submission override image URLs
  const [overrideUrls, setOverrideUrls] = useState<Record<number, string>>({});
  const [showOverride, setShowOverride] = useState<Record<number, boolean>>({});
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

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
    mutationFn: async ({ submissionId, overrideImageUrl }: { submissionId: number; overrideImageUrl?: string }) => {
      return apiRequest('POST', `/api/admin/pending-images/${submissionId}/approve`, 
        overrideImageUrl ? { overrideImageUrl } : undefined
      );
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/pending-images'] });
      queryClient.invalidateQueries({ queryKey: ['/api/cards'] });
      // Clear override state for this submission
      setOverrideUrls(prev => { const n = { ...prev }; delete n[vars.submissionId]; return n; });
      setShowOverride(prev => { const n = { ...prev }; delete n[vars.submissionId]; return n; });
      toast({ 
        title: vars.overrideImageUrl ? "Approved with custom image!" : "Image approved!",
        description: "The image has been added to the card database."
      });
    },
    onError: (error: any) => {
      toast({ 
        title: "Approval failed", 
        description: error.message,
        variant: "destructive" 
      });
    }
  });

  // Bulk approve mutation
  const bulkApproveMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const response = await apiRequest('POST', '/api/admin/pending-images/bulk-approve', { ids });
      return (await response.json()) as { approved: number; failed: { id: number; reason: string }[] };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/pending-images'] });
      queryClient.invalidateQueries({ queryKey: ['/api/cards'] });
      setSelectedIds(new Set());
      toast({
        title: `${data.approved} image${data.approved === 1 ? '' : 's'} approved`,
        description: data.failed.length > 0
          ? `${data.failed.length} could not be approved (already reviewed or missing).`
          : "All selected images are now live on their cards.",
        variant: data.failed.length > 0 ? "destructive" : undefined,
      });
    },
    onError: (error: any) => {
      toast({ title: "Bulk approval failed", description: error.message, variant: "destructive" });
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
    const override = overrideUrls[submission.id]?.trim();
    approveMutation.mutate({ submissionId: submission.id, overrideImageUrl: override || undefined });
  };

  const handleReject = (submission: PendingSubmission) => {
    rejectMutation.mutate({ submissionId: submission.id, reason: '' });
  };

  const pendingSubmissions = submissions.filter(s => s.status === 'pending');
  const reviewedSubmissions = submissions.filter(s => s.status !== 'pending');

  const toggleSelected = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const allSelected = pendingSubmissions.length > 0 && pendingSubmissions.every(s => selectedIds.has(s.id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingSubmissions.map(s => s.id)));
    }
  };

  const handleBulkApprove = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (window.confirm(`Approve ${ids.length} selected image${ids.length === 1 ? '' : 's'}? They will go live on their cards immediately.`)) {
      bulkApproveMutation.mutate(ids);
    }
  };

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

      {/* Trusted Uploaders */}
      <TrustedUploadersCard />

      {/* Bulk actions toolbar */}
      {pendingSubmissions.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 p-3 rounded-lg border bg-white dark:bg-gray-900">
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
            <Checkbox
              checked={allSelected}
              onCheckedChange={toggleSelectAll}
              data-testid="checkbox-select-all"
            />
            Select all ({pendingSubmissions.length})
          </label>
          {selectedIds.size > 0 && (
            <span className="text-sm text-gray-500 dark:text-gray-400">{selectedIds.size} selected</span>
          )}
          <Button
            onClick={handleBulkApprove}
            disabled={selectedIds.size === 0 || bulkApproveMutation.isPending}
            className="bg-green-600 hover:bg-green-700 ml-auto"
            data-testid="button-bulk-approve"
          >
            {bulkApproveMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <CheckCircle className="w-4 h-4 mr-2" />
            )}
            Approve Selected{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
          </Button>
        </div>
      )}

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
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={selectedIds.has(submission.id)}
                      onCheckedChange={() => toggleSelected(submission.id)}
                      className="mt-1"
                      data-testid={`checkbox-select-${submission.id}`}
                    />
                    <div className="space-y-1">
                    <CardTitle className="text-lg text-gray-900 dark:text-white">
                      {submission.card.name} #{submission.card.cardNumber}
                    </CardTitle>
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                      {submission.card.set.name} ({submission.card.set.year})
                    </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge className="bg-orange-500">Pending</Badge>
                    {submission.source === 'scan_to_add' && (
                      <Badge variant="outline" className="text-xs border-blue-300 text-blue-600 flex items-center gap-1">
                        <ScanLine className="w-3 h-3" /> Scan to Add
                      </Badge>
                    )}
                  </div>
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

                {/* Override Image URL */}
                <div className="border rounded-lg overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowOverride(prev => ({ ...prev, [submission.id]: !prev[submission.id] }))}
                    className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-800 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  >
                    <span className="flex items-center gap-1.5">
                      <Link2 className="w-3 h-3" />
                      Use a different image URL
                    </span>
                    {showOverride[submission.id] ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
                  {showOverride[submission.id] && (
                    <div className="p-3 space-y-2 bg-white dark:bg-gray-900">
                      <Input
                        placeholder="Paste image URL here…"
                        value={overrideUrls[submission.id] || ""}
                        onChange={(e) => setOverrideUrls(prev => ({ ...prev, [submission.id]: e.target.value }))}
                        className="text-xs bg-white"
                      />
                      {overrideUrls[submission.id]?.trim() && (
                        <div className="flex gap-2 items-start">
                          <div className="w-16 h-20 flex-shrink-0 rounded border overflow-hidden bg-gray-100 dark:bg-gray-800">
                            <img
                              src={overrideUrls[submission.id]}
                              alt="Preview"
                              className="w-full h-full object-contain"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                          </div>
                          <p className="text-xs text-gray-500 dark:text-gray-400 pt-1">
                            Clicking <strong>Approve</strong> below will use this URL instead of the submitted image.
                          </p>
                        </div>
                      )}
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
                    {overrideUrls[submission.id]?.trim() ? "Approve with Custom Image" : "Approve"}
                  </Button>
                  <Button
                    onClick={() => handleReject(submission)}
                    disabled={rejectMutation.isPending}
                    variant="destructive"
                    className="flex-1"
                    data-testid="button-reject"
                  >
                    {rejectMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <XCircle className="w-4 h-4 mr-2" />
                    )}
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

    </div>
  );
}
