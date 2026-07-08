import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Share2,
  Copy,
  RefreshCw,
  XCircle,
  ExternalLink,
  Check,
  Loader2,
} from "lucide-react";
import { SiFacebook, SiX, SiReddit, SiInstagram } from "react-icons/si";

interface ShareBinderModalProps {
  isOpen: boolean;
  onClose: () => void;
  cardSetId: number;
  setName: string;
  mainSetName?: string;
}

interface ShareXpResult {
  awarded: boolean;
  points: number;
  kind: "first" | "daily" | "limit";
}

export function ShareBinderModal({ isOpen, onClose, cardSetId, setName, mainSetName }: ShareBinderModalProps) {
  const [copied, setCopied] = useState(false);
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false);
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const displayName = (() => {
    if (!mainSetName) return setName;
    let subsetPart = setName;
    if (setName.startsWith(mainSetName + " - ")) {
      subsetPart = setName.slice(mainSetName.length + 3).trim();
    } else if (setName === mainSetName) {
      subsetPart = "Base";
    }
    return `${mainSetName} - ${subsetPart}`;
  })();

  const { data: shareLinkData, isLoading } = useQuery<{ shareLink: { token: string; url: string; cardSetId: number; id: number; createdAt: string } | null }>({
    queryKey: ['/api/share-links', cardSetId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/share-links/${cardSetId}`);
      return res.json();
    },
    enabled: isOpen,
  });

  // Award XP after a real share/copy action. The server enforces limits
  // (+25 first ever, +10 max once/day) — repeats are safe no-ops. One
  // consolidated toast covers both the action and the XP outcome.
  const awardMutation = useMutation({
    mutationFn: async (_vars: { base: string }) => {
      const res = await apiRequest("POST", `/api/share-links/${cardSetId}/shared`);
      return res.json() as Promise<ShareXpResult>;
    },
    onSuccess: (data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/xp-summary"] });
      if (data?.awarded) {
        toast({
          title: `${vars.base} +${data.points} XP!`,
          description: data.kind === "first"
            ? "First binder share bonus earned!"
            : "Daily share XP earned!",
        });
      } else {
        toast({
          title: vars.base,
          description: "You've already earned today's share XP — share again tomorrow!",
        });
      }
    },
    onError: (_err, vars) => {
      // Sharing still worked — just couldn't record XP. Don't scare the user.
      toast({ title: vars.base });
    },
  });

  const reportShare = (base: string) => {
    if (awardMutation.isPending) return;
    awardMutation.mutate({ base });
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/share-links", { cardSetId });
      return res.json();
    },
    onSuccess: async (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/share-links', cardSetId] });
      const url = data?.url;
      if (url) {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
          reportShare("Share link created and copied!");
        } catch {
          toast({ title: "Share link created" });
        }
      } else {
        toast({ title: "Share link created" });
      }
    },
    onError: () => {
      toast({ title: "Failed to create share link", variant: "destructive" });
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/share-links/${cardSetId}/regenerate`);
      return res.json();
    },
    onSuccess: async (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/share-links', cardSetId] });
      setShowRegenerateConfirm(false);
      const url = data?.url;
      if (url) {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
          reportShare("New link generated and copied!");
        } catch {
          toast({ title: "New share link generated. The old link no longer works." });
        }
      }
    },
    onError: () => {
      toast({ title: "Failed to regenerate link", variant: "destructive" });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/share-links/${cardSetId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/share-links', cardSetId] });
      setShowRevokeConfirm(false);
      toast({ title: "Share link revoked. The page is no longer accessible." });
    },
    onError: () => {
      toast({ title: "Failed to revoke link", variant: "destructive" });
    },
  });

  const shareLink = shareLinkData?.shareLink;
  const shareUrl = shareLink?.url || "";

  const buildShareMessage = (url?: string) => {
    const link = url || shareUrl;
    return `BEHOLD my collection of ${displayName}! ${link}\n\nTrack your collection and its value at marvelcardvault.com`;
  };

  // Native share (iOS/mobile browsers). Android WebView generally lacks
  // navigator.share, so the button only renders when it's available —
  // copy-link below is the universal fallback.
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const handleNativeShare = async () => {
    try {
      await navigator.share({
        title: `My ${displayName} binder`,
        text: `BEHOLD my collection of ${displayName}! Track your collection and its value at marvelcardvault.com`,
        url: shareUrl,
      });
      reportShare("Binder shared!");
    } catch (err: any) {
      // User cancelled the share sheet — not an error, no XP.
      if (err?.name === "AbortError") return;
      toast({ title: "Couldn't open share menu — try Copy instead", variant: "destructive" });
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      reportShare("Link copied to clipboard!");
    } catch {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  };

  const handleFacebookShare = () => {
    window.open(
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}&quote=${encodeURIComponent(`BEHOLD my collection of ${displayName}!\n\nTrack your collection and its value at marvelcardvault.com`)}`,
      "_blank",
      "noopener,noreferrer,width=600,height=400"
    );
  };

  const handleTwitterShare = () => {
    const tweetText = `BEHOLD my collection of ${displayName}!\n\nTrack your collection and its value at marvelcardvault.com`;
    window.open(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}&url=${encodeURIComponent(shareUrl)}`,
      "_blank",
      "noopener,noreferrer,width=600,height=400"
    );
  };

  const handleRedditShare = () => {
    window.open(
      `https://www.reddit.com/submit?url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(`BEHOLD my collection of ${displayName}!`)}`,
      "_blank",
      "noopener,noreferrer"
    );
  };

  const handleInstagramShare = async () => {
    try {
      await navigator.clipboard.writeText(buildShareMessage());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      reportShare("Share message copied for Instagram!");
      window.open("https://www.instagram.com/", "_blank", "noopener,noreferrer");
    } catch {
      toast({ title: "Failed to copy link", variant: "destructive" });
    }
  };

  const handlePreview = () => {
    window.open(shareUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="w-5 h-5 text-red-600" />
            Share This Binder
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Create a shareable link for your <span className="font-semibold">{displayName}</span> binder. Anyone with the link can view your collection and see which cards you own.
          </p>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : !shareLink ? (
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
              className="w-full bg-red-600 hover:bg-red-700"
            >
              {createMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Share2 className="w-4 h-4 mr-2" />
              )}
              Create Share Link
            </Button>
          ) : (
            <>
              {canNativeShare && (
                <Button
                  onClick={handleNativeShare}
                  disabled={awardMutation.isPending}
                  className="w-full bg-red-600 hover:bg-red-700 text-white"
                >
                  <Share2 className="w-4 h-4 mr-2" />
                  Share Binder
                </Button>
              )}

              <div className="flex gap-2">
                <Input
                  value={shareUrl}
                  readOnly
                  className="flex-1 bg-white text-gray-800 text-xs"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCopy}
                  disabled={awardMutation.isPending}
                  className="shrink-0"
                >
                  {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>

              <div>
                <p className="text-xs text-gray-500 text-center mb-2">Share on social media</p>
                <div className="flex items-center justify-center gap-3">
                  <button
                    onClick={handleFacebookShare}
                    className="w-10 h-10 rounded-full bg-[#1877F2] hover:bg-[#1565C0] text-white flex items-center justify-center transition-colors"
                    title="Share on Facebook"
                  >
                    <SiFacebook className="w-5 h-5" />
                  </button>
                  <button
                    onClick={handleTwitterShare}
                    className="w-10 h-10 rounded-full bg-black hover:bg-gray-800 text-white flex items-center justify-center transition-colors"
                    title="Share on X"
                  >
                    <SiX className="w-4 h-4" />
                  </button>
                  <button
                    onClick={handleRedditShare}
                    className="w-10 h-10 rounded-full bg-[#FF4500] hover:bg-[#E03D00] text-white flex items-center justify-center transition-colors"
                    title="Share on Reddit"
                  >
                    <SiReddit className="w-5 h-5" />
                  </button>
                  <button
                    onClick={handleInstagramShare}
                    disabled={awardMutation.isPending}
                    className="w-10 h-10 rounded-full bg-gradient-to-br from-[#833AB4] via-[#FD1D1D] to-[#F77737] hover:opacity-90 text-white flex items-center justify-center transition-colors"
                    title="Copy link & open Instagram"
                  >
                    <SiInstagram className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handlePreview}
                  className="flex-1"
                >
                  <ExternalLink className="w-4 h-4 mr-1" />
                  Preview
                </Button>
                {!showRegenerateConfirm ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowRegenerateConfirm(true)}
                    className="flex-1"
                  >
                    <RefreshCw className="w-4 h-4 mr-1" />
                    New Link
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => regenerateMutation.mutate()}
                    disabled={regenerateMutation.isPending}
                    className="flex-1"
                  >
                    {regenerateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                    Confirm
                  </Button>
                )}
                {!showRevokeConfirm ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowRevokeConfirm(true)}
                    className="flex-1 text-red-600 hover:text-red-700"
                  >
                    <XCircle className="w-4 h-4 mr-1" />
                    Revoke
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => revokeMutation.mutate()}
                    disabled={revokeMutation.isPending}
                    className="flex-1"
                  >
                    {revokeMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                    Confirm
                  </Button>
                )}
              </div>

              {(showRegenerateConfirm || showRevokeConfirm) && (
                <p className="text-xs text-amber-600 text-center">
                  {showRegenerateConfirm
                    ? "This will create a new link. The old link will stop working."
                    : "This will turn off sharing. The link will no longer be accessible."}
                </p>
              )}
            </>
          )}

          <p className="text-xs text-gray-400 text-center">
            No prices or personal info are shown on shared pages. Your binder always shows your latest collection.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
