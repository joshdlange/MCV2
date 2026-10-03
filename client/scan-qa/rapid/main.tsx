import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import Scan from "@/pages/scan";
import { MobileHeader } from "@/components/layout/mobile-header";
import { Toaster } from "@/components/ui/toaster";
import { ReportImageHost } from "@/components/scan/report-image-dialog";
import "@/index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <div className="min-h-[100dvh] bg-stone-50">
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 50 }}><MobileHeader /></div>
      <main style={{ paddingTop: "calc(4rem + var(--safe-area-top,0px))" }}><Scan /></main>
      <aside style={{ position: "fixed", bottom: 0, left: 0, right: 0, height: 22, zIndex: 100, textAlign: "center", background: "#efe7e2", color: "#65524d", fontSize: 10 }}>
        ISOLATED QA · FAKE CAMERA / MOCK AUTH · NOT REAL HARDWARE
      </aside>
    </div>
    <ReportImageHost /><Toaster />
  </QueryClientProvider>,
);