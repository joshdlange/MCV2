import { build } from "esbuild";
import { chromium } from "playwright-core";
import express from "express";
import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
import path from "node:path";

// Isolated real component test; no live account sign-in or data mutations.
const imageUrl = "https://res.cloudinary.com/dgu7hjfvn/image/upload/v1785901763/marvel-cards/external-migration/card_36092_front.jpg";
const imageResponse = await fetch(imageUrl);
assert.ok(imageResponse.ok);
const imageBytes = Buffer.from(await imageResponse.arrayBuffer());
const bundle = await build({
  stdin: {
    resolveDir: process.cwd(), loader: "tsx",
    contents: `
      import React,{useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {CardDetailImage} from './client/src/components/cards/card-detail-image';
      function Harness(){
        const [src,setSrc]=useState('/card.jpg');
        return <div style={{height:550,overflowY:'auto',padding:50}}>
          <CardDetailImage src={src} alt="Amadeus Cho" fallback="/fallback.svg" auraTier="common">
            <button style={{position:'absolute',top:8,right:8}} onClick={()=>setSrc('/back.svg')}>Flip</button>
          </CardDetailImage>
          <button onClick={()=>setSrc('/missing.jpg')}>Broken image</button>
          <div style={{height:900}}>Scroll content</div>
        </div>;
      }
      createRoot(document.getElementById('root')).render(<Harness/>);
    `,
  },
  bundle: true, write: false, format: "iife", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
});
const cssFiles = await readdir("dist/public/assets");
const cssName = cssFiles.find(name => /^index-.*\.css$/.test(name));
assert.ok(cssName);
const css = await readFile(path.join("dist/public/assets", cssName), "utf8");
const app = express();
app.get("/", (_req, res) => res.send('<link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/qa.js"></script>'));
app.get("/qa.js", (_req, res) => res.type("js").send(bundle.outputFiles[0].text));
app.get("/style.css", (_req, res) => res.type("css").send(css));
app.get("/card.jpg", (_req, res) => res.type("jpg").send(imageBytes));
app.get(["/back.svg", "/fallback.svg"], (req, res) => res.type("svg").send(`<svg xmlns="http://www.w3.org/2000/svg" width="280" height="392"><rect width="280" height="392" fill="${req.path.includes("back") ? "blue" : "gray"}"/></svg>`));
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", headless: true, args: ["--no-sandbox"] });
try {
  for (const width of [393, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    await page.goto(`http://127.0.0.1:${(server.address() as any).port}`);
    const img = page.getByTestId("card-detail-image");
    await img.waitFor();
    await page.waitForFunction(() => {
      const el = document.querySelector<HTMLImageElement>('[data-testid="card-detail-image"]');
      return el?.complete && el.naturalWidth === 800;
    });
    const metrics = await img.evaluate(el => {
      const frame = el.parentElement!;
      const box = el.getBoundingClientRect();
      const parentBox = frame.getBoundingClientRect();
      const animatedAncestors = [];
      for (let p: Element | null = el; p; p = p.parentElement) {
        if (getComputedStyle(p).animationName !== "none") animatedAncestors.push(p.tagName);
      }
      return { w: box.width, h: box.height, top: box.top, parentTop: parentBox.top, animatedAncestors };
    });
    assert.equal(metrics.w, 280);
    assert.equal(metrics.h, 392);
    assert.equal(metrics.top, metrics.parentTop);
    assert.deepEqual(metrics.animatedAncestors, []);
    assert.notEqual(await page.getByTestId("card-detail-glow").evaluate(el => getComputedStyle(el).animationName), "none");
    await page.getByRole("button", { name: "Flip", exact: true }).click();
    await page.waitForFunction(() => document.querySelector<HTMLImageElement>('[data-testid="card-detail-image"]')?.src.endsWith("/back.svg"));
    await page.getByRole("button", { name: "Broken image" }).click();
    await page.waitForFunction(() => {
      const el = document.querySelector<HTMLImageElement>('[data-testid="card-detail-image"]');
      return el?.src.endsWith("/fallback.svg") && el.complete && el.naturalWidth > 0;
    });
    assert.equal((await img.boundingBox())?.height, 392);
    console.log(`${width}px: original image, fixed frame, separate glow, flip and error fallback passed`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
