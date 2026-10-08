import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { Router, Route, Switch } from "wouter";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { StatsDashboard } from "@/components/dashboard/stats-dashboard";
import CollectionValue from "@/pages/collection-value";
import CollectorProfile from "@/pages/CollectorProfile";
import MarketTrends from "@/pages/market-trends";
import MyCollection from "@/pages/my-collection";
import { queryClient } from "@/lib/queryClient";
import { useAppStore } from "@/lib/store";
import { VALUE_QUERY_KEY, valueParams } from "@/lib/collectionValue";
import { fixtureValueResponse } from "./value-fixtures";
import "@/index.css";

// Standalone Vite dev entry, not an app route. Production builds do not include
// this HTML/entry. It neither wraps AuthProvider nor changes app authentication.
function Harness() {
  const params = new URLSearchParams(window.location.search);
  const screen = params.get("screen") ?? "value";
  const [location, setLocation] = useState(screen === "profile" ? "/collectors/inkvault" : screen === "dashboard" ? "/" : screen === "collection" ? "/my-collection" : screen === "trends" ? "/trends" : "/collection/value");
  return <QueryClientProvider client={queryClient}><TooltipProvider>
    <Router hook={() => [location, setLocation]}>
      <div className="min-h-[100dvh] bg-gray-50">
        <div className="border-b border-gray-200 bg-white px-4 py-4 font-bebas text-xl text-red-600">MARVELOUS CARD VAULT</div>
        <Switch>
          <Route path="/collection/value" component={CollectionValue} />
          <Route path="/collectors/:username" component={CollectorProfile} />
          <Route path="/my-collection" component={MyCollection} />
          <Route path="/trends" component={MarketTrends} />
          <Route path="/"><div className="p-4"><StatsDashboard /></div></Route>
        </Switch>
      </div>
    </Router><Toaster />
  </TooltipProvider></QueryClientProvider>;
}

if (import.meta.env.DEV) {
  useAppStore.setState({ currentUser: { id: 1, name: "UI fixture", username: "inkvault", email: "", avatar: "", isAdmin: false, imageAdmin: false, plan: "SUPER_HERO", subscriptionStatus: "active", onboardingComplete: true, totalLogins: 6 } });
  // Initial cached data lets a static screenshot show the actual value page
  // without any auth bypass. Browser tests intercept subsequent API requests.
  if (!new URLSearchParams(window.location.search).has("network")) {
    queryClient.setQueryData([VALUE_QUERY_KEY, 1, "/api/collection/value", valueParams({ hideUnder5: false, order: "desc" })], {
      pages: [fixtureValueResponse(new URLSearchParams(valueParams({ hideUnder5: false, order: "desc" })))], pageParams: [0],
    });
  }
  createRoot(document.getElementById("root")!).render(<Harness />);
}
