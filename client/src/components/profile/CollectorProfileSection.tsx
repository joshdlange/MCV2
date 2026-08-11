import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { AVATAR_KEYS, AVATAR_MAP } from "@/lib/collectorAvatars";
import { CollectorAvatar } from "@/components/profile/CollectorAvatar";
import { Sparkles } from "lucide-react";

/**
 * "Collector Profile" section in Account Settings.
 * Same fields as the post-onboarding customization step, editable anytime.
 */
export function CollectorProfileSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: profile } = useQuery<any>({ queryKey: ["/api/user/profile"] });

  const [avatarKey, setAvatarKey] = useState<string | null>(null);
  const [tagline, setTagline] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [allowFollowers, setAllowFollowers] = useState<boolean | null>(null);
  const [showActivity, setShowActivity] = useState<boolean | null>(null);

  const saveMutation = useMutation({
    mutationFn: async (updates: any) => apiRequest("PATCH", "/api/user/profile", updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
      toast({ title: "Collector profile updated" });
    },
    onError: (e: any) =>
      toast({ title: "Update failed", description: e?.message || "Please try again.", variant: "destructive" }),
  });

  if (!profile) return null;

  const vAvatar = avatarKey ?? profile.collectorAvatarKey ?? null;
  const vTagline = tagline ?? profile.bio ?? "";
  const vFocus = focus ?? profile.collectorFocus ?? "";
  const profileIsPublic = (profile.profileVisibility ?? "public") !== "private";
  const vFollowers = profileIsPublic && (allowFollowers ?? !!profile.allowFollowers);
  const vActivity = showActivity ?? !!profile.showActivityInFeed;

  const dirty =
    (avatarKey !== null && avatarKey !== profile.collectorAvatarKey) ||
    (tagline !== null && tagline !== (profile.bio ?? "")) ||
    (focus !== null && focus !== (profile.collectorFocus ?? ""));

  const handleSave = () =>
    saveMutation.mutate({
      collectorAvatarKey: vAvatar,
      bio: vTagline,
      collectorFocus: vFocus,
    });

  const saveToggle = (updates: any) => saveMutation.mutate(updates);

  return (
    <Card className="border-gray-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-red-600" /> Collector Profile
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Your collector avatar and details shown to other collectors when your profile is public.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center gap-4">
          <CollectorAvatar avatarKey={vAvatar} photoUrl={profile.photoURL} name={profile.displayName || profile.username} size={64} glow={!!vAvatar} />
          <div className="text-sm text-muted-foreground">
            {vAvatar ? "Your collector avatar" : "No avatar selected yet — pick one below"}
          </div>
        </div>

        <div>
          <Label className="text-sm font-medium text-gray-700">Avatar</Label>
          <div className="mt-2 grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 gap-2 max-h-52 overflow-y-auto pr-1 rounded-lg border border-gray-200 bg-gray-50 p-2">
            {AVATAR_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setAvatarKey(key)}
                className={`rounded-full transition-all ${
                  vAvatar === key
                    ? "ring-2 ring-red-500 shadow-[0_0_8px_rgba(220,38,38,0.5)] scale-105"
                    : "opacity-85 hover:opacity-100 hover:scale-105"
                }`}
                aria-label={`Avatar ${key}`}
                aria-pressed={vAvatar === key}
              >
                <img src={AVATAR_MAP[key]} alt="" loading="lazy" draggable={false} className="w-full aspect-square rounded-full object-cover" />
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label htmlFor="cp-tagline" className="text-sm font-medium text-gray-700">Collector tagline</Label>
          <Input id="cp-tagline" value={vTagline} maxLength={160} onChange={(e) => setTagline(e.target.value)}
            placeholder='Example: "Wolverine collector chasing 90s inserts."'
            className="mt-1.5 bg-white text-black border-gray-200 rounded-lg" />
        </div>

        <div>
          <Label htmlFor="cp-focus" className="text-sm font-medium text-gray-700">Collecting focus</Label>
          <Input id="cp-focus" value={vFocus} maxLength={200} onChange={(e) => setFocus(e.target.value)}
            placeholder='Example: "X-Men, Topps Chrome, sketch cards."'
            className="mt-1.5 bg-white text-black border-gray-200 rounded-lg" />
        </div>

        {(dirty || (avatarKey !== null && avatarKey !== profile.collectorAvatarKey)) && (
          <Button onClick={handleSave} disabled={saveMutation.isPending} className="bg-red-600 hover:bg-red-700 text-white rounded-lg">
            {saveMutation.isPending ? "Saving..." : "Save Collector Profile"}
          </Button>
        )}

        <div className="space-y-3 rounded-xl border border-gray-100 bg-gray-50 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className={`text-sm font-medium ${profileIsPublic ? "text-gray-900" : "text-gray-400"}`}>Allow other collectors to follow me</p>
              <p className="text-xs text-muted-foreground">
                {profileIsPublic
                  ? "Used when follows launch. Off means no one can follow you."
                  : "Make your profile public (Privacy tab) to enable followers."}
              </p>
            </div>
            <Switch
              checked={vFollowers}
              disabled={!profileIsPublic || saveMutation.isPending}
              onCheckedChange={(v) => { setAllowFollowers(v); saveToggle({ allowFollowers: v }); }}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-gray-900">Show my activity in the future community feed</p>
              <p className="text-xs text-muted-foreground">Only approved activity types will ever be shown. Off by default.</p>
            </div>
            <Switch
              checked={vActivity}
              disabled={saveMutation.isPending}
              onCheckedChange={(v) => { setShowActivity(v); saveToggle({ showActivityInFeed: v }); }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Your email, address, billing details, and private data are never shown publicly.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export default CollectorProfileSection;
