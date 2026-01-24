import { useEffect, useRef } from "react";
import { useLocation } from "wouter";

export function useBackButton() {
  const [location] = useLocation();
  const historyStack = useRef<string[]>([]);
  const isBackNavigation = useRef(false);

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
    const handlePopState = (event: PopStateEvent) => {
      if (historyStack.current.length > 1) {
        event.preventDefault();
        
        historyStack.current.pop();
        const previousPath = historyStack.current[historyStack.current.length - 1] || "/";
        
        isBackNavigation.current = true;
        window.history.pushState(null, "", previousPath);
        window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
      }
    };

    window.history.pushState(null, "", window.location.href);
    
    window.addEventListener("popstate", handlePopState);
    
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  return {
    canGoBack: historyStack.current.length > 1,
    historyLength: historyStack.current.length,
  };
}
