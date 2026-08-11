import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAppStore } from "@/lib/store";
import { AVATAR_KEYS, AVATAR_MAP } from "@/lib/collectorAvatars";
import { CollectorAvatar } from "@/components/profile/CollectorAvatar";
import { Loader2, Sparkles } from "lucide-react";

/**
 * Skippable Collector Profile customization step (social/feed foundation).
 * Shows once after onboarding for users who haven't customized or dismissed it.
 * Skipping never blocks the app; it can always be edited later in Settings.
 */
export function ProfileCustomization() {
  const { currentUser } = useAppStore();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState(false);

  const { data: profile } = useQuery<any>({
    queryKey: ["/api/user/profile"],
    enabled: !!currentUser?.onboardingComplete,
  });

  const [avatarKey, setAvatarKey] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [tagline, setTagline] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [profilePublic, setProfilePublic] = useState<boolean | null>(null);
  const [allowFollowers, setAllowFollowers] = useState<boolean | null>(null);
  const [showActivity, setShowActivity] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  const open =
    !!currentUser?.onboardingComplete &&
    !!profile &&
    !profile.profileCustomizationCompletedAt &&
    !profile.profileCustomizationDismissedAt &&
    !dismissed;

  if (!open) return null;

  // Effective values: local edits win over saved profile values
  const vAvatar = avatarKey ?? profile.collectorAvatarKey ?? null;
  const vName = displayName ?? profile.displayName ?? "";
  const vTagline = tagline ?? profile.bio ?? "";
  const vFocus = focus ?? profile.collectorFocus ?? "";
  // Toggles default ON in this step (per Joshua); saving writes the shown values.
  const vPublic = profilePublic ?? (profile.profileVisibility ?? "public") !== "private";
  const vFollowers = vPublic && (allowFollowers ?? (profile.allowFollowers || !profile.profileCustomizationCompletedAt));
  const vActivity = showActivity ?? (profile.showActivityInFeed || !profile.profileCustomizationCompletedAt);

  const finish = async (action: "complete" | "dismiss") => {
    await apiRequest("POST", `/api/profile-customization/${action}`);
    queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
    setDismissed(true);
  };

  const handleSkip = async () => {
    setDismissed(true); // close immediately; never block the app
    try {
      await finish("dismiss");
    } catch {
      // Non-fatal: worst case the step reappears next session
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiRequest("PATCH", "/api/user/profile", {
        collectorAvatarKey: vAvatar,
        displayName: vName || undefined,
        bio: vTagline,
        collectorFocus: vFocus,
        allowFollowers: vFollowers,
        showActivityInFeed: vActivity,
        privacySettings: { profileVisibility: vPublic ? "public" : "private" },
      });
      await finish("complete");
      toast({ title: "Collector profile saved!", description: "You can update it anytime in Settings." });
    } catch (e: any) {
      toast({ title: "Couldn't save profile", description: e?.message || "Please try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) handleSkip(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto bg-zinc-950 border-zinc-800 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2 text-white">
            <Sparkles className="w-5 h-5 text-red-500" /> Customize Your Collector Profile
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            Choose an avatar and add a little collector personality. This will help other collectors
            recognize you when public profiles, follows, and the activity feed roll out.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Avatar grid */}
          <div>
            <Label className="text-zinc-200">Choose your avatar</Label>
            <div className="mt-2 grid grid-cols-5 sm:grid-cols-6 gap-2 max-h-56 overflow-y-auto pr-1 rounded-lg border border-zinc-800 bg-zinc-900/60 p-2">
              {AVATAR_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setAvatarKey(key)}
                  className={`rounded-full transition-all ${
                    vAvatar === key
                      ? "ring-2 ring-red-500 shadow-[0_0_10px_rgba(220,38,38,0.6)] scale-105"
                      : "opacity-85 hover:opacity-100 hover:scale-105"
                  }`}
                  aria-label={`Avatar ${key}`}
                  aria-pressed={vAvatar === key}
                >
                  <img
                    src={AVATAR_MAP[key]}
                    alt=""
                    loading="lazy"
                    draggable={false}
                    className="w-full aspect-square rounded-full object-cover"
                  />
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="pc-name" className="text-zinc-200">Display name</Label>
            <Input id="pc-name" value={vName} maxLength={50} onChange={(e) => setDisplayName(e.target.value)}
              className="mt-1 bg-zinc-900 border-zinc-700 text-zinc-100" placeholder="Your collector name" />
            <p className="text-xs text-zinc-500 mt-1">This is how other collectors may see you if your profile is public.</p>
          </div>

          <div>
            <Label htmlFor="pc-tagline" className="text-zinc-200">Collector tagline</Label>
            <Input id="pc-tagline" value={vTagline} maxLength={160} onChange={(e) => setTagline(e.target.value)}
              className="mt-1 bg-zinc-900 border-zinc-700 text-zinc-100" placeholder='Example: "Wolverine collector chasing 90s inserts."' />
          </div>

          <div>
            <Label htmlFor="pc-focus" className="text-zinc-200">Collecting focus</Label>
            <Input id="pc-focus" value={vFocus} maxLength={200} onChange={(e) => setFocus(e.target.value)}
              className="mt-1 bg-zinc-900 border-zinc-700 text-zinc-100" placeholder='Example: "X-Men, Women of Marvel, Topps Chrome, sketch cards."' />
          </div>

          {/* Privacy toggles */}
          <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-zinc-200">Make my collector profile public</p>
              </div>
              <Switch checked={vPublic} onCheckedChange={(v) => { setProfilePublic(v); if (!v) setAllowFollowers(false); }} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className={`text-sm font-medium ${vPublic ? "text-zinc-200" : "text-zinc-500"}`}>Allow other collectors to follow me</p>
              </div>
              <Switch checked={vFollowers} disabled={!vPublic} onCheckedChange={(v) => setAllowFollowers(v)} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-zinc-200">Show approved collector activity in the future feed</p>
              </div>
              <Switch checked={vActivity} onCheckedChange={(v) => setShowActivity(v)} />
            </div>
            <p className="text-xs text-zinc-500">
              Your email, address, billing details, and private binders are never shown publicly.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            <Button onClick={handleSave} disabled={saving} className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold">
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Save Profile
            </Button>
            <Button variant="ghost" onClick={handleSkip} disabled={saving} className="flex-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800">
              Skip for Now
            </Button>
          </div>
          <p className="text-xs text-zinc-500 text-center -mt-2">You can skip this now and customize your profile later in Settings.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ProfileCustomization;
