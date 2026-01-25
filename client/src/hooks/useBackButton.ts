import { useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";

const ROOT_ROUTES = ['/', '/home', '/dashboard'];
const EXIT_TIMEOUT = 2000;

function showExitToast(): void {
  const existingToast = document.querySelector('[data-back-toast]');
  if (existingToast) return;
  
  const toast = document.createElement('div');
  toast.setAttribute('data-back-toast', 'true');
  toast.className = 'fixed bottom-20 left-1/2 transform -translate-x-1/2 bg-gray-800 text-white px-4 py-2 rounded-lg shadow-lg z-50 text-sm';
  toast.textContent = 'Press back again to exit';
  document.body.appendChild(toast);
  
  setTimeout(() => toast.remove(), EXIT_TIMEOUT);
}

export function useBackButton() {
  const [location, setLocation] = useLocation();
  const historyStack = useRef<string[]>([]);
  const isBackNavigation = useRef(false);
  const lastBackPressTime = useRef<number>(0);
  const capacitorListenerRef = useRef<any>(null);

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

  const isAtRoot = useCallback(() => {
    return ROOT_ROUTES.includes(location) || historyStack.current.length <= 1;
  }, [location]);

  const navigateBack = useCallback(() => {
    if (historyStack.current.length > 1) {
      historyStack.current.pop();
      const previousPath = historyStack.current[historyStack.current.length - 1] || "/";
      isBackNavigation.current = true;
      setLocation(previousPath);
      return true;
    }
    return false;
  }, [setLocation]);

  const handleBackPress = useCallback((): boolean => {
    if (navigateBack()) {
      return true;
    }
    
    if (isAtRoot()) {
      const now = Date.now();
      if (now - lastBackPressTime.current < EXIT_TIMEOUT) {
        return false;
      }
      lastBackPressTime.current = now;
      showExitToast();
      return true;
    }
    
    return false;
  }, [navigateBack, isAtRoot]);

  useEffect(() => {
    const handlePopState = () => {
      handleBackPress();
    };

    window.addEventListener("popstate", handlePopState);
    
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [handleBackPress]);

  useEffect(() => {
    const Capacitor = (window as any).Capacitor;
    if (!Capacitor?.Plugins?.App) return;

    const handler = () => {
      const handled = handleBackPress();
      if (!handled) {
        Capacitor.Plugins.App.exitApp();
      }
    };

    Capacitor.Plugins.App.addListener('backButton', handler).then((listener: any) => {
      capacitorListenerRef.current = listener;
    }).catch(() => {});

    return () => {
      if (capacitorListenerRef.current?.remove) {
        capacitorListenerRef.current.remove();
      }
    };
  }, [handleBackPress]);

  return {
    canGoBack: historyStack.current.length > 1,
    historyLength: historyStack.current.length,
    navigateBack,
    isAtRoot: isAtRoot(),
  };
}
