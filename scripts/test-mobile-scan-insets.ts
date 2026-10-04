/** Isolated real-component rendering. No production auth, data or writes. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import express from "express";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright-core";

const root = process.cwd();
const dir = path.join(root, ".local/mobile-inset-qa");
await mkdir(dir, { recursive: true });
await writeFile(path.join(dir, "index.html"), '<html><head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>');
await writeFile(path.join(dir, "auth.ts"), "export const useAuth=()=>({user:null,loading:false});");
await writeFile(path.join(dir, "firebase.ts"), "export const auth={currentUser:null};");
await writeFile(path.join(dir, "rapid.ts"), `export const useRapidScan=()=>({
items:[{id:"fixture",status:"failed",families:[],previewUrl:"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",selected:null}],
accepted:1,queueCount:0,busy:null,paused:false,
enqueue:()=>{},remove:()=>{},retry:()=>{},submitPhoto:()=>{},addAll:()=>{},undoAll:()=>{},select:()=>{}
});`);
await writeFile(path.join(dir, "main.tsx"), `
import React from "react";
import {createRoot} from "react-dom/client";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {DevScanWorkspace} from "${root}/client/src/components/scan/dev-scan-workspace";
import {RapidScanWorkspace} from "${root}/client/src/components/scan/rapid-scan-workspace";
import "${root}/client/src/index.css";
const families = Array.from({length:5},(_,i)=>({familyKey:String(i),score:.8,representativeCardId:i+1,options:[{cardId:i+1,name:"Fixture card",cardNumber:String(i+1),imageUrl:null,setName:"Fixture set",year:1992}]}));
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>
<div style={{height:"calc(64px + var(--safe-area-top))"}} />
{location.search.includes("rapid") ? <RapidScanWorkspace onExit={()=>{}}/> : <DevScanWorkspace families={families} margin={.02} previewUrl={null} photo={null} elapsedMs={1800} initialSearch={false} record={()=>{}} onNext={()=>{}} onReset={()=>{}}/>}
</QueryClientProvider>);`);
await build({
  configFile: false, root: dir, logLevel: "error", plugins: [react()],
  resolve: { alias: [
    { find: "@/contexts/AuthContext", replacement: path.join(dir, "auth.ts") },
    { find: "@/lib/firebase", replacement: path.join(dir, "firebase.ts") },
    { find: "@/hooks/use-rapid-scan", replacement: path.join(dir, "rapid.ts") },
    { find: "@", replacement: path.join(root, "client/src") },
    { find: "@shared", replacement: path.join(root, "shared") },
  ] },
  css: { postcss: path.join(root, "client") },
  build: { outDir: path.join(dir, "public"), emptyOutDir: true },
});
const app = express().use("/api", (_req, res) => res.json([])).use(express.static(path.join(dir, "public")));
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const origin = `http://127.0.0.1:${(server.address() as any).port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  for (const height of [640, 852]) {
    await page.setViewportSize({ width: 360, height });
    for (const inset of [0, 24, 48]) {
      await page.goto(origin);
      await page.evaluate(n => {
        document.documentElement.style.setProperty("--safe-area-inset-bottom", `${n}px`);
        document.documentElement.style.setProperty("--safe-area-inset-top", "24px");
      }, inset);
      await page.getByTestId("scan-close-match-guidance").waitFor();
      const button = await page.getByTestId("scan-not-here").boundingBox();
      assert.ok(button && button.y >= 0 && button.y + button.height <= height - inset, `Scan action clears bottom ${inset} at height ${height}`);
      assert.ok(button.height >= 44);
      await page.screenshot({ path: path.join(dir, `scan-${height}-${inset}.png`) });
      await page.goto(`${origin}?rapid`);
      await page.evaluate(n => document.documentElement.style.setProperty("--safe-area-inset-bottom", `${n}px`), inset);
      await page.getByTestId("rapid-review").click();
      const footer = page.locator(".rapid-footer");
      await footer.waitFor();
      await footer.scrollIntoViewIfNeeded();
      const padding = await footer.evaluate(el => parseFloat(getComputedStyle(el).paddingBottom));
      assert.equal(padding, 10 + inset, "Rapid footer reserves native inset plus its own spacing");
    }
  }
  assert.deepEqual(errors, []);
  console.log("PASS: real Scan and Rapid Scan components, 2 phone heights × 3 native insets; close-match guidance; no browser exceptions");
} finally {
  await browser.close();
  server.close();
}