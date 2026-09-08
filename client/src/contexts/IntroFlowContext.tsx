import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from "react";

export type IntroFlowState = "checking" | "open" | "complete";

interface IntroFlowContextValue {
  profileCustomizationState: IntroFlowState;
  heardAboutState: IntroFlowState;
  setProfileCustomizationState: (state: IntroFlowState) => void;
  setHeardAboutState: (state: IntroFlowState) => void;
}

const IntroFlowContext = createContext<IntroFlowContextValue>({
  profileCustomizationState: "checking",
  heardAboutState: "checking",
  setProfileCustomizationState: () => {},
  setHeardAboutState: () => {},
});

export function resolveIntroFlowState({
  enabled,
  ready,
  open,
}: {
  enabled: boolean;
  ready: boolean;
  open: boolean;
}): IntroFlowState {
  if (!enabled || !ready) return "checking";
  return open ? "open" : "complete";
}

export function areIntroFlowsComplete(
  profileCustomizationState: IntroFlowState,
  heardAboutState: IntroFlowState,
): boolean {
  return profileCustomizationState === "complete" && heardAboutState === "complete";
}

export function IntroFlowProvider({ children }: { children: ReactNode }) {
  const [profileCustomizationState, setProfileCustomizationState] =
    useState<IntroFlowState>("checking");
  const [heardAboutState, setHeardAboutState] =
    useState<IntroFlowState>("checking");
  const value = useMemo(() => ({
    profileCustomizationState,
    heardAboutState,
    setProfileCustomizationState,
    setHeardAboutState,
  }), [heardAboutState, profileCustomizationState]);

  return (
    <IntroFlowContext.Provider value={value}>
      {children}
    </IntroFlowContext.Provider>
  );
}

export function useIntroFlow() {
  return useContext(IntroFlowContext);
}