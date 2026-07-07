import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import type { PluginListenerHandle } from "@capacitor/core";

/**
 * Android hardware back button handling for the Capacitor app.
 *
 * ONLY active on native Android (Capacitor). Does nothing on web or iOS, so
 * browser back behavior and iOS navigation are completely untouched.
 *
 * Priority order on each back press:
 *  1. Page-registered handlers (e.g. the scan flow's stage machine) — LIFO.
 *  2. An open overlay (dialog / sheet / drawer / popover / dropdown) — close it.
 *  3. On a root screen (Dashboard) — double-press-to-exit with a toast hint.
 *  4. Otherwise — navigate back one step through in-app history.
 */

const ROOT_ROUTES = ["/"];
const EXIT_TIMEOUT = 2000;

// ── Page-level back handler registry ────────────────────────────────────────

type BackHandler = () => boolean;

const backHandlers: BackHandler[] = [];

/** Register a back handler (LIFO). Returns an unregister function. */
export function registerBackHandler(handler: BackHandler): () => void {
  backHandlers.push(handler);
  return () => {
    const i = backHandlers.indexOf(handler);
    if (i !== -1) backHandlers.splice(i, 1);
  };
}

/**
 * Hook for pages with internal navigation state (wizards, multi-stage flows).
 * The handler should return true if it consumed the back press, false to let
 * the global handler (overlay close / history back / exit) take over.
 */
export function useHardwareBackHandler(handler: BackHandler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => registerBackHandler(() => ref.current()), []);
}

// ── Overlay (modal/sheet/popover) detection ─────────────────────────────────

const OPEN_MODAL_SELECTOR = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
].join(", ");

function hasOpenOverlay(): boolean {
  if (document.querySelector(OPEN_MODAL_SELECTOR)) return true;
  // Popovers, dropdown menus, selects — anything rendered through Radix popper.
  // Ignore tooltips: they're transient and not something "back" should target.
  const poppers = document.querySelectorAll("[data-radix-popper-content-wrapper]");
  for (const p of Array.from(poppers)) {
    if (!p.querySelector('[role="tooltip"]')) return true;
  }
  return false;
}

/** Close the top-most overlay the same way the user would: via Escape. */
function closeTopOverlay(): boolean {
  if (!hasOpenOverlay()) return false;
  document.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      keyCode: 27,
      which: 27,
      bubbles: true,
      cancelable: true,
    })
  );
  return true;
}

// ── Exit hint toast (plain DOM — independent of the app toaster) ────────────

function showExitToast(): void {
  if (document.querySelector("[data-back-toast]")) return;
  const toast = document.createElement("div");
  toast.setAttribute("data-back-toast", "true");
  toast.className =
    "fixed bottom-20 left-1/2 transform -translate-x-1/2 bg-gray-800 text-white px-4 py-2 rounded-lg shadow-lg z-50 text-sm";
  toast.textContent = "Press back again to exit";
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), EXIT_TIMEOUT);
}

// ── Main hook (mounted once in App) ─────────────────────────────────────────

export function useBackButton() {
  const [location, setLocation] = useLocation();
  const historyStack = useRef<string[]>([]);
  const isBackNavigation = useRef(false);
  const lastBackPressTime = useRef(0);
  const locationRef = useRef(location);
  locationRef.current = location;

  // Track visited in-app locations (used only by the native Android handler).
  useEffect(() => {
    if (isBackNavigation.current) {
      isBackNavigation.current = false;
      return;
    }
    if (historyStack.current[historyStack.current.length - 1] !== location) {
      historyStack.current.push(location);
      if (historyStack.current.length > 50) {
        historyStack.current = historyStack.current.slice(-50);
      }
    }
  }, [location]);

  useEffect(() => {
    // Native Android ONLY. No web popstate handling — the browser (and the
    // Android WebView on non-native builds) keeps its native back behavior.
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") {
      return;
    }

    const handleBack = () => {
      // 1. Page-level handlers (scan flow stages, etc.) — most recent first.
      for (let i = backHandlers.length - 1; i >= 0; i--) {
        try {
          if (backHandlers[i]()) return;
        } catch {
          // A broken page handler must never block back navigation.
        }
      }

      // 2. Open modal / dialog / sheet / popover → close it, don't navigate.
      if (closeTopOverlay()) return;

      // 3. Root screen (Dashboard) → double-press to exit.
      const atRoot =
        ROOT_ROUTES.includes(locationRef.current) || historyStack.current.length <= 1;
      if (atRoot) {
        const now = Date.now();
        if (now - lastBackPressTime.current < EXIT_TIMEOUT) {
          CapApp.exitApp();
          return;
        }
        lastBackPressTime.current = now;
        showExitToast();
        return;
      }

      // 4. Navigate back one step through in-app history.
      historyStack.current.pop();
      const previousPath = historyStack.current[historyStack.current.length - 1] || "/";
      isBackNavigation.current = true;
      setLocation(previousPath);
    };

    let removed = false;
    let handle: PluginListenerHandle | null = null;

    CapApp.addListener("backButton", handleBack)
      .then((h) => {
        if (removed) {
          h.remove();
        } else {
          handle = h;
        }
      })
      .catch((err) => {
        // Native App plugin missing from this binary — hardware back can't be
        // intercepted until a new build includes @capacitor/app.
        console.warn("[BackButton] Could not attach backButton listener:", err);
      });

    return () => {
      removed = true;
      handle?.remove();
    };
  }, [setLocation]);
}
