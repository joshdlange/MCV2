import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/contexts/AuthContext";
import { useAppStore } from "@/lib/store";
import { auth } from "@/lib/firebase";
import { AVATAR_KEYS } from "@/lib/collectorAvatars";
import { CollectorAvatar } from "@/components/profile/CollectorAvatar";

/**
 * Single-screen onboarding: username + avatar + opt-ins, one "Enter the Vault"
 * click. "How did you hear about us?" is deferred to a later sign-in (see
 * HeardAboutPrompt); the favorite-sets question is retired.
 */
export function Onboarding() {
  const { refreshUser } = useAuth();
  const { currentUser } = useAppStore();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [username, setUsername] = useState("");
  const [usernameValid, setUsernameValid] = useState<boolean | null>(null);
  const [usernameError, setUsernameError] = useState("");
  const [checkingUsername, setCheckingUsername] = useState(false);

  const [avatarKey, setAvatarKey] = useState<string | null>(null);
  const [marketingOptIn, setMarketingOptIn] = useState(true);
  const [pushEnabled, setPushEnabled] = useState(true);

  useEffect(() => {
    const validateUsername = async () => {
      if (!username) {
        setUsernameValid(null);
        setUsernameError("");
        return;
      }

      const usernameRegex = /^[a-z0-9_]{3,20}$/;
      if (!usernameRegex.test(username)) {
        setUsernameValid(false);
        setUsernameError("Username must be 3-20 characters, lowercase letters, numbers, and underscores only");
        return;
      }

      setCheckingUsername(true);
      try {
        const user = auth.currentUser;
        if (!user) {
          setUsernameError("Please sign in to continue");
          setUsernameValid(false);
          return;
        }

        const token = await user.getIdToken();
        const response = await fetch(`/api/onboarding/check-username?username=${username}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();

        if (data.available) {
          setUsernameValid(true);
          setUsernameError("");
        } else {
          setUsernameValid(false);
          setUsernameError("Username is already taken");
        }
      } catch (error) {
        console.error("Username check error:", error);
        setUsernameError("Failed to check username availability");
        setUsernameValid(false);
      } finally {
        setCheckingUsername(false);
      }
    };

    const debounceTimer = setTimeout(validateUsername, 500);
    return () => clearTimeout(debounceTimer);
  }, [username]);

  const handleComplete = async () => {
    setIsSubmitting(true);
    try {
      await apiRequest("POST", "/api/onboarding/complete", {
        username,
        marketingOptIn,
        pushEnabled
      });

      // Save the chosen avatar (non-fatal, editable in Settings) and —
      // independently — mark the old customization step done so the legacy
      // second popup never appears, even if the avatar PATCH fails.
      if (avatarKey) {
        try {
          await apiRequest("PATCH", "/api/user/profile", { collectorAvatarKey: avatarKey });
        } catch (e) {
          console.error("Avatar save failed (non-fatal):", e);
        }
      }
      try {
        await apiRequest("POST", "/api/profile-customization/complete");
      } catch (e) {
        console.error("Customization completion stamp failed (non-fatal):", e);
      }
      // The profile query may already be cached from the app shell rendering
      // behind this dialog — invalidate it BEFORE onboardingComplete flips,
      // or ProfileCustomization could read the stale pre-completion profile
      // and resurrect the old modal.
      await queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });

      toast({
        title: "Welcome!",
        description: `@${username} - Your account is ready!`
      });

      await refreshUser();
    } catch (error: any) {
      console.error("Onboarding error:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to complete onboarding",
        variant: "destructive"
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!currentUser || currentUser.onboardingComplete) {
    return null;
  }

  return (
    <Dialog open={true}>
      <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="text-2xl font-bebas tracking-wide">Welcome to Marvel Card Vault</DialogTitle>
          <DialogDescription>
            Pick a username and an avatar — that's it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Username */}
          <div className="space-y-2">
            <Label htmlFor="username" className="text-base font-medium">
              Choose Your Username
            </Label>
            <div className="relative">
              <Input
                id="username"
                data-testid="input-username"
                placeholder="e.g., spider_fan_98"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                className={`${
                  username && usernameValid === true
                    ? "border-green-500"
                    : username && usernameValid === false
                    ? "border-red-500"
                    : ""
                }`}
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                {checkingUsername && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
                {!checkingUsername && username && usernameValid === true && (
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                )}
                {!checkingUsername && username && usernameValid === false && (
                  <XCircle className="w-4 h-4 text-red-500" />
                )}
              </div>
            </div>
            {usernameError && <p className="text-sm text-red-500">{usernameError}</p>}
            <p className="text-xs text-gray-500">
              Your public handle (@username). 3-20 characters, lowercase letters, numbers, and underscores.
            </p>
          </div>

          {/* Avatar picker */}
          <div className="space-y-2">
            <Label className="text-base font-medium">Pick an Avatar</Label>
            <div className="grid grid-cols-5 sm:grid-cols-6 gap-2 max-h-44 overflow-y-auto pr-1 rounded-lg border p-2">
              {AVATAR_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  data-testid={`avatar-${key}`}
                  onClick={() => setAvatarKey(key)}
                  className={`rounded-full transition-all ${
                    avatarKey === key
                      ? "ring-2 ring-red-500 shadow-[0_0_10px_rgba(220,38,38,0.5)] scale-105"
                      : "opacity-85 hover:opacity-100 hover:scale-105"
                  }`}
                >
                  <CollectorAvatar avatarKey={key} size={44} />
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-500">Optional — you can change it anytime in Settings.</p>
          </div>

          {/* Opt-ins */}
          <div className="space-y-2">
            <div className="flex items-start space-x-3 p-3 border rounded-lg">
              <Checkbox
                id="marketing"
                data-testid="checkbox-marketing"
                checked={marketingOptIn}
                onCheckedChange={(checked) => setMarketingOptIn(checked as boolean)}
              />
              <Label htmlFor="marketing" className="font-normal cursor-pointer text-sm">
                Keep me updated on new features and sets
              </Label>
            </div>
            <div className="flex items-start space-x-3 p-3 border rounded-lg">
              <Checkbox
                id="push-notifications"
                data-testid="checkbox-push-notifications"
                checked={pushEnabled}
                onCheckedChange={(checked) => setPushEnabled(checked as boolean)}
              />
              <Label htmlFor="push-notifications" className="font-normal cursor-pointer text-sm">
                Push notifications for milestones and updates
              </Label>
            </div>
          </div>
        </div>

        <div className="pt-4 border-t">
          <Button
            onClick={handleComplete}
            data-testid="button-complete"
            className="w-full bg-red-600 hover:bg-red-700"
            disabled={isSubmitting || !username || usernameValid !== true || checkingUsername}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Setting up...
              </>
            ) : (
              "Enter the Vault"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Deferred "How did you hear about us?" — shows once on a sign-in after the
 * account is at least a day old (i.e. not during first-run onboarding), only
 * if the user never answered. Skipping stores a marker so it never reappears.
 */
export function HeardAboutPrompt() {
  const { currentUser } = useAppStore();
  const { data: profile } = useQuery<any>({
    queryKey: ["/api/user/profile"],
    enabled: !!currentUser?.onboardingComplete,
  });
  const [dismissed, setDismissed] = useState(false);
  const [choice, setChoice] = useState("");
  const [otherText, setOtherText] = useState("");
  const [saving, setSaving] = useState(false);

  const options = ["Social Media", "Friend Recommendation", "Search Engine", "Reddit/Forum", "YouTube/Streamer", "Other"];

  const accountAgeMs = profile?.createdAt ? Date.now() - new Date(profile.createdAt).getTime() : 0;
  const open =
    !!currentUser?.onboardingComplete &&
    !!profile &&
    !profile.heardAbout &&
    accountAgeMs > 24 * 60 * 60 * 1000 &&
    !dismissed;

  if (!open) return null;

  const save = async (value: string) => {
    setSaving(true);
    setDismissed(true); // close immediately; never block the app
    try {
      await apiRequest("PUT", `/api/users/${currentUser!.id}`, { heardAbout: value.slice(0, 200) });
    } catch (e) {
      console.error("heardAbout save failed (non-fatal):", e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) save("(skipped)"); }}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="text-lg">Quick question</DialogTitle>
          <DialogDescription>How did you hear about Marvel Card Vault?</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              data-testid={`heard-${option.toLowerCase().replace(/\W+/g, '-')}`}
              onClick={() => (option === "Other" ? setChoice("Other") : save(option))}
              className={`w-full text-left text-sm px-3 py-2 rounded-lg border transition-colors ${
                choice === option ? "border-red-500 bg-red-50 dark:bg-red-950/30" : "hover:bg-gray-50 dark:hover:bg-gray-800"
              }`}
            >
              {option}
            </button>
          ))}
          {choice === "Other" && (
            <div className="flex gap-2">
              <Input
                placeholder="Tell us..."
                value={otherText}
                onChange={(e) => setOtherText(e.target.value)}
                data-testid="input-heard-other"
              />
              <Button size="sm" disabled={!otherText.trim() || saving} onClick={() => save(otherText.trim())} className="bg-red-600 hover:bg-red-700">
                Save
              </Button>
            </div>
          )}
        </div>
        <Button variant="ghost" size="sm" className="text-gray-400" onClick={() => save("(skipped)")}>
          Skip
        </Button>
      </DialogContent>
    </Dialog>
  );
}
