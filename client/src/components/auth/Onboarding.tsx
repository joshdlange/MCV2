import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/contexts/AuthContext";
import { useAppStore } from "@/lib/store";

export function Onboarding() {
  const { refreshUser } = useAuth();
  const { currentUser } = useAppStore();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [username, setUsername] = useState("");
  const [usernameValid, setUsernameValid] = useState<boolean | null>(null);
  const [usernameError, setUsernameError] = useState("");
  const [checkingUsername, setCheckingUsername] = useState(false);

  const [heardAbout, setHeardAbout] = useState("");
  const [heardAboutOther, setHeardAboutOther] = useState("");
  const [favoriteSets, setFavoriteSets] = useState("");
  const [marketingOptIn, setMarketingOptIn] = useState(false);

  const heardAboutOptions = [
    "Social Media",
    "Friend Recommendation",
    "Search Engine",
    "Reddit/Forum",
    "YouTube/Streamer",
    "Other"
  ];

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
        const response = await fetch(`/api/onboarding/check-username?username=${username}`);
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
      } finally {
        setCheckingUsername(false);
      }
    };

    const debounceTimer = setTimeout(validateUsername, 500);
    return () => clearTimeout(debounceTimer);
  }, [username]);

  const handleNext = () => {
    if (step === 1 && !usernameValid) {
      toast({
        title: "Invalid Username",
        description: "Please choose a valid username",
        variant: "destructive"
      });
      return;
    }
    if (step === 2 && !heardAbout) {
      toast({
        title: "Required Field",
        description: "Please let us know how you heard about us",
        variant: "destructive"
      });
      return;
    }
    setStep(step + 1);
  };

  const handleBack = () => {
    setStep(step - 1);
  };

  const handleComplete = async () => {
    setIsSubmitting(true);
    try {
      const heardAboutValue = heardAbout === "Other" ? heardAboutOther : heardAbout;
      
      await apiRequest("POST", "/api/onboarding/complete", {
        username,
        heardAbout: heardAboutValue,
        favoriteSets,
        marketingOptIn
      });

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
      <DialogContent className="sm:max-w-[500px]" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="text-2xl font-bebas tracking-wide">Welcome to Marvel Card Vault</DialogTitle>
          <DialogDescription>
            Let's get you set up! Step {step} of 4
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="username" className="text-base font-medium">
                  Choose Your Username
                </Label>
                <p className="text-sm text-gray-500 mt-1">
                  This will be your public display name (@username)
                </p>
              </div>
              
              <div className="space-y-2">
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
                {usernameError && (
                  <p className="text-sm text-red-500">{usernameError}</p>
                )}
                <p className="text-xs text-gray-500">
                  3-20 characters, lowercase letters, numbers, and underscores only
                </p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <Label className="text-base font-medium">
                  How did you hear about us?
                </Label>
              </div>
              
              <RadioGroup value={heardAbout} onValueChange={setHeardAbout}>
                {heardAboutOptions.map((option) => (
                  <div key={option} className="flex items-center space-x-2">
                    <RadioGroupItem value={option} id={option} data-testid={`radio-${option.toLowerCase().replace(/\s/g, '-')}`} />
                    <Label htmlFor={option} className="font-normal cursor-pointer">
                      {option}
                    </Label>
                  </div>
                ))}
              </RadioGroup>

              {heardAbout === "Other" && (
                <Input
                  placeholder="Please specify..."
                  data-testid="input-heard-about-other"
                  value={heardAboutOther}
                  onChange={(e) => setHeardAboutOther(e.target.value)}
                  className="mt-2"
                />
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="favorite-sets" className="text-base font-medium">
                  Favorite Card Sets (Optional)
                </Label>
                <p className="text-sm text-gray-500 mt-1">
                  Tell us about your favorite Marvel card sets or characters
                </p>
              </div>
              
              <Textarea
                id="favorite-sets"
                data-testid="textarea-favorite-sets"
                placeholder="e.g., Spider-Man Fleer Ultra, X-Men Series 1..."
                value={favoriteSets}
                onChange={(e) => setFavoriteSets(e.target.value)}
                rows={4}
              />
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div>
                <Label className="text-base font-medium">
                  Final Step!
                </Label>
                <p className="text-sm text-gray-500 mt-1">
                  Help us improve your experience
                </p>
              </div>
              
              <div className="flex items-start space-x-3 p-4 border rounded-lg">
                <Checkbox
                  id="marketing"
                  data-testid="checkbox-marketing"
                  checked={marketingOptIn}
                  onCheckedChange={(checked) => setMarketingOptIn(checked as boolean)}
                />
                <div className="space-y-1">
                  <Label htmlFor="marketing" className="font-normal cursor-pointer">
                    Keep me updated on new features and sets
                  </Label>
                  <p className="text-xs text-gray-500">
                    Get occasional emails about new card releases, features, and community highlights
                  </p>
                </div>
              </div>

              <div className="bg-gray-50 p-4 rounded-lg space-y-2">
                <p className="text-sm font-medium">Your Profile:</p>
                <p className="text-sm text-gray-600">Username: @{username}</p>
                <p className="text-sm text-gray-600">Heard about us: {heardAbout === "Other" ? heardAboutOther : heardAbout}</p>
                {favoriteSets && <p className="text-sm text-gray-600">Favorite sets: {favoriteSets}</p>}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-between pt-4 border-t">
          {step > 1 ? (
            <Button
              variant="outline"
              onClick={handleBack}
              data-testid="button-back"
            >
              Back
            </Button>
          ) : (
            <div />
          )}
          
          {step < 4 ? (
            <Button
              onClick={handleNext}
              data-testid="button-next"
              className="bg-red-600 hover:bg-red-700"
            >
              Next
            </Button>
          ) : (
            <Button
              onClick={handleComplete}
              disabled={isSubmitting}
              data-testid="button-complete"
              className="bg-red-600 hover:bg-red-700"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Completing...
                </>
              ) : (
                "Complete Setup"
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
