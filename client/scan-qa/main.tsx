import { useState } from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { DevScanWorkspace } from "@/components/scan/dev-scan-workspace";
import { ReportImageHost } from "@/components/scan/report-image-dialog";
import { Toaster } from "@/components/ui/toaster";
import "@/index.css";
import type { ScanArtworkFamily } from "@/components/scan/scan-result-tile";
import type { ScanBrowseHint } from "@/components/scan/dev-scan-workspace";

declare global {
  interface Window {
    __scanFixture: { families: ScanArtworkFamily[]; browseHint: ScanBrowseHint; margin: number; previewUrl?: string };
    __scanQaRecords: unknown[];
  }
}
function FixtureApp() {
  const [completed, setCompleted] = useState(false);
  const fixture = window.__scanFixture;
  return <QueryClientProvider client={queryClient}>
    <div style={{ minHeight: "100dvh", background: "#f5f3f0" }}>
      <header style={{ height: 64, padding: "0 12px", display: "flex", alignItems: "center", background: "#201e21", color: "#faf5f2", fontSize: 12 }}>MCV · ISOLATED FIXTURE QA · NOT AUTHENTICATED</header>
      {completed ? <div data-testid="scan-qa-completed">Ready for next scan</div> : <DevScanWorkspace
        families={fixture.families} margin={fixture.margin} browseHint={fixture.browseHint}
        previewUrl={fixture.previewUrl ?? null} photo={null} elapsedMs={1384} initialSearch={false}
        record={update => window.__scanQaRecords.push(update)}
        onNext={() => setCompleted(true)} onReset={() => setCompleted(true)}
      />}
    </div>
    <ReportImageHost /><Toaster />
  </QueryClientProvider>;
}
ReactDOM.createRoot(document.getElementById("root")!).render(<FixtureApp />);