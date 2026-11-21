// Isolated browser test: real footer/hooks, mocked transport. No app auth bypass or database writes.
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";

let collection: any[] = [];
let wishlist: any[] = [];
let failNext = false;
let limitNext = false;
let writes = 0;
const errors: string[] = [];
const bundle = await build({
  stdin: {
    contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
      import {CardCollectionFooter} from './client/src/components/cards/card-collection-footer';
      const client=new QueryClient({defaultOptions:{queries:{retry:false,queryFn:async({queryKey})=>{
        const r=await fetch(queryKey[0]); if(!r.ok)throw Error('Load failed');return r.json();
      }}}});
      createRoot(document.getElementById('root')).render(
        <QueryClientProvider client={client}><CardCollectionFooter cardId={123} cardName="Spider-Man" isOpen={true}/></QueryClientProvider>
      );`,
    resolveDir: process.cwd(), loader: "tsx",
  },
  bundle: true, write: false, format: "iife", jsx: "automatic",
  alias: { "@": resolve("client/src") },
  plugins: [{
    name: "isolated-services",
    setup(builder) {
      builder.onResolve({ filter: /^@\/(lib\/queryClient|lib\/store|hooks\/use-toast|components\/subscription\/upgrade-modal)$/ },
        args => ({ path: args.path, namespace: "test-stub" }));
      builder.onLoad({ filter: /.*/, namespace: "test-stub" }, args => ({
        loader: "js", resolveDir: process.cwd(),
        contents: args.path.endsWith("queryClient") ? `
          export async function apiRequest(method,url,data){
            const r=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});
            if(!r.ok)throw Error((await r.json()).message);return r;
          }`
          : args.path.endsWith("store") ? `export const useAppStore=()=>({currentUser:{id:1,plan:"SIDE_KICK"}});`
          : args.path.endsWith("use-toast") ? `export const useToast=()=>({toast:()=>{}});`
          : `import React from 'react';export const UpgradeModal=({isOpen})=>isOpen?React.createElement('div',{'data-testid':'upgrade'},'Upgrade required'):null;`,
      }));
    },
  }],
});
const assets = readdirSync("dist/public/assets");
const css = assets.filter(name => name.endsWith(".css")).map(name => readFileSync(`dist/public/assets/${name}`, "utf8")).join("\n");
const server = createServer(async (req, res) => {
  if (req.url === "/bundle.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles[0].text); return; }
  if (req.url === "/styles.css") { res.setHeader("Content-Type", "text/css"); res.end(css); return; }
  if (!req.url?.startsWith("/api/")) {
    res.end('<html><head><link rel="stylesheet" href="/styles.css"></head><body><div id="root" style="width:95vw;max-width:512px"></div><script src="/bundle.js"></script></body></html>'); return;
  }
  res.setHeader("Content-Type", "application/json");
  const send = (value: any) => res.end(JSON.stringify(value));
  if (req.method === "GET") return send(req.url === "/api/collection" ? collection : req.url === "/api/wishlist" ? wishlist : {});
  writes++;
  let raw = ""; for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  if (failNext) { failNext = false; res.statusCode = 500; return send({ message: "Test failure" }); }
  if (limitNext) { limitNext = false; res.statusCode = 403; return send({ message: "COLLECTION_LIMIT_REACHED" }); }
  await new Promise(resolve => setTimeout(resolve, 100));
  if (req.url === "/api/collection") {
    assert.equal(body.incrementExisting, false);
    collection = [{ id: 42, cardId: 123, quantity: 1, card: { id: 123, name: "Spider-Man" } }];
    return send({ id: 42, cardId: 123, quantity: 1 });
  }
  if (req.url === "/api/collection/42") {
    if (req.method === "DELETE") { collection = []; return send({ message: "Removed" }); }
    collection[0].quantity = body.quantity; return send({ id: 42, cardId: 123, quantity: body.quantity });
  }
  if (req.url === "/api/wishlist") { wishlist = [{ id: 7, cardId: 123, card: { id: 123 } }]; return send({ id: 7, cardId: 123 }); }
  if (req.url === "/api/wishlist/7") { wishlist = []; return send({ message: "Removed" }); }
  res.statusCode = 404; send({ message: "Unknown test route" });
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address() as { port: number };
const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage({ viewport: { width: 320, height: 700 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${address.port}`);
  const button = (name: string) => page.getByTestId(`button-${name}`);
  const quantity = async (n: number) => {
    await page.waitForFunction(n => document.querySelector('[data-testid="text-quantity"]')?.textContent === String(n), n);
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('[data-testid="button-quantity-increase"]')?.disabled);
  };
  await button("add-to-collection").click();
  await quantity(1);
  await button("quantity-increase").click(); await quantity(2);
  const before = writes;
  await button("quantity-increase").evaluate((el: HTMLButtonElement) => { el.click(); el.click(); });
  await quantity(3); assert.equal(writes - before, 1, "duplicate taps must send one update");
  failNext = true;
  await button("quantity-increase").click();
  await page.waitForTimeout(250); await quantity(3);
  await button("quantity-decrease").click(); await quantity(2);
  await button("remove-from-collection").click();
  await page.getByRole("heading", { name: "Remove all 2 copies?" }).waitFor();
  await page.getByRole("button", { name: "Keep card" }).click(); assert.equal(collection[0].quantity, 2);
  await button("remove-from-collection").click();
  await page.getByRole("button", { name: "Remove all copies" }).click();
  await button("add-to-collection").waitFor(); assert.equal(collection.length, 0);
  await button("add-to-collection").click(); await quantity(1);
  await button("quantity-decrease").click();
  await page.getByRole("heading", { name: "Remove your last copy?" }).waitFor();
  await page.getByRole("button", { name: "Remove card", exact: true }).click();
  await button("add-to-collection").waitFor(); assert.equal(collection.length, 0);
  await button("add-to-wishlist").click(); await button("remove-from-wishlist").waitFor();
  await button("remove-from-wishlist").click(); await button("add-to-wishlist").waitFor();
  assert.equal(wishlist.length, 0);
  limitNext = true; await button("add-to-collection").click(); await page.getByTestId("upgrade").waitFor();
  assert.equal(collection.length, 0);
  await button("add-to-collection").click(); await quantity(1);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 700 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No horizontal overflow at ${width}px`);
    const row = await page.getByTestId("card-detail-actions").boundingBox();
    assert.ok(row && row.height <= 80, "Footer remains one compact row");
  }
  assert.deepEqual(errors, []);
  console.log("PASS: add, increment, decrement, duplicate taps, failure preservation, cancel, multi-copy removal, last-copy removal, wishlist toggle, upgrade limit, and compact 320/390/1280px layouts.");
} finally {
  await browser.close();
  await new Promise<void>(resolve => server.close(() => resolve()));
}
