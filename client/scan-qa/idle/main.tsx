import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import Scan from "@/pages/scan";
import MyCollection from "@/pages/my-collection";
import { Route, Switch } from "wouter";
import { MobileHeader } from "@/components/layout/mobile-header";
import { Toaster } from "@/components/ui/toaster";
import "@/index.css";

// Real Scan page and real mobile app header, isolated BUILD-TIME auth aliases.
// There is no app navigation footer in AppLayout; Scan's collection footer is real.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <div className="min-h-[100dvh] bg-gray-50">
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 50 }}><MobileHeader /></div>
      <main style={{ paddingTop: "calc(4rem + var(--safe-area-top,0px))" }}>
        <Switch><Route path="/my-collection" component={MyCollection} /><Route component={Scan} /></Switch>
      </main>
      <aside style={{ position: "fixed", bottom: 0, left: 0, right: 0, height: 22, textAlign: "center", background: "#efe7e2", color: "#65524d", fontSize: 10 }}>
        ISOLATED QA · MOCK AUTH / COUNT / OWNERSHIP · NOT LIVE
      </aside>
    </div>
    <Toaster />
  </QueryClientProvider>,
);