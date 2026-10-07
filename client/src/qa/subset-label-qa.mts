// Run after a frontend build:
// npx tsx client/src/qa/subset-label-qa.mts [built-assets-directory]
// Isolated actual SetThumbnail + shared SubsetLabel; no account/API access.
import { build } from "esbuild";
import { chromium } from "playwright-core";
import express from "express";
import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
import path from "node:path";

const assetsDirectory = process.argv[2] || "dist/public/assets";
const cssName = (await readdir(assetsDirectory)).find(name => /^index-.*\.css$/.test(name));
assert.ok(cssName, "Build the frontend first; QA uses its real compiled CSS.");
const css = await readFile(path.join(assetsDirectory, cssName), "utf8");
const bundle = await build({
  stdin: {
    resolveDir: process.cwd(), loader: "tsx",
    contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
      import {SetThumbnail} from './client/src/components/cards/set-thumbnail';
      import {SubsetLabel} from './client/src/components/cards/subset-label';
      import {getCardSetDisplayName} from './client/src/lib/setDisplayName';
      const names = ['Astonishing', 'Marvel Platinum - Astonishing Rainbow Foil Superfractor Parallel',
        'Marvel Platinum - ExtremelyLongUnbrokenParallelNameThatMustNotOverflowTheTile',
        'Marvel Platinum - Base'];
      const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="140"><rect width="100" height="140" fill="#b8c5cf"/></svg>');
      function Harness(){
        return <QueryClientProvider client={new QueryClient()}>
          <main style={{padding:16}}>
            <section id="sets" className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 md:gap-4">
              {names.map((name,id)=><SetThumbnail key={id}
                set={{id:id+1,name,year:2024,totalCards:37,imageUrl:image}}
                mainSetName="Marvel Platinum" onClick={()=>{}} isFavorite={false} onFavorite={()=>{}} />)}
            </section>
            <section id="cards" style={{marginTop:24}} className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
              {names.map((name,id)=><article key={id} className="flex flex-col h-full min-w-0">
                <div className="aspect-[5/7] shrink-0" style={{background:'#b8c5cf'}} />
                <div className="p-2 flex flex-col flex-1 min-w-0">
                  <div className="flex items-baseline gap-1 min-w-0 mb-1">
                    <h3 title="Spider-Man and the Fantastic Four" className="text-xs truncate flex-1 min-w-0">Spider-Man and the Fantastic Four</h3>
                    <span className="text-[11px] leading-4 shrink-0">#A-137</span>
                  </div>
                  <SubsetLabel name={getCardSetDisplayName({cardSetName:name,isAdmin:false}).displayName} className="mb-2" />
                  <footer className="mt-auto"><button>Collection</button></footer>
                </div>
              </article>)}
            </section>
          </main>
        </QueryClientProvider>;
      }
      createRoot(document.getElementById('root')).render(<Harness/>);
    `,
  },
  alias: { "@": path.resolve("client/src") },
  bundle: true, write: false, format: "iife", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
});
const app = express();
app.get("/", (_req, res) => res.send('<link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/qa.js"></script>'));
app.get("/qa.js", (_req, res) => res.type("js").send(bundle.outputFiles[0].text));
app.get("/style.css", (_req, res) => res.type("css").send(css));
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
try {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium",
    headless: true, args: ["--no-sandbox"],
  });
  try {
    for (const width of [393, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", route => {
        const url = new URL(route.request().url());
        return url.hostname === "127.0.0.1" || url.protocol === "data:" ? route.continue() : route.abort();
      });
      await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
      await page.locator("#sets p[title]").first().waitFor();
      const labels = await page.locator("p[title]").evaluateAll(elements => elements.map(el => {
        const style = getComputedStyle(el);
        return {
          text: el.textContent, title: el.getAttribute("title"),
          font: parseFloat(style.fontSize), lineClamp: style.webkitLineClamp,
          overflow: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1,
        };
      }));
      assert.equal(labels.length, 8);
      for (const label of labels) {
        assert.equal(label.text, label.title);
        assert.ok(label.font >= 11, "Readable lower font bound");
        assert.ok(!label.overflow, `${width}: clipped label ${label.text}`);
        assert.ok(label.lineClamp === "none" || label.lineClamp === "", "No line clamp");
      }
      assert.equal(labels[0].text, "Astonishing");
      assert.equal(labels[3].text, "Base Set");
      for (const section of ["sets", "cards"]) {
        const rows = await page.locator("#" + section).evaluate(el =>
          Array.from(el.children).map(tile => {
            const box = tile.getBoundingClientRect();
            const footer = tile.querySelector("footer") || tile.lastElementChild?.lastElementChild;
            return { top: box.top, height: box.height, bottom: footer?.getBoundingClientRect().bottom };
          }));
        for (const tile of rows) {
          for (const peer of rows.filter(peer => Math.abs(peer.top - tile.top) < 1)) {
            assert.ok(Math.abs(peer.height - tile.height) < 1, `${section}: unequal row heights`);
            assert.ok(Math.abs(peer.bottom! - tile.bottom!) < 1, `${section}: footer misalignment`);
          }
        }
      }
      const number = page.locator("#cards span").first();
      assert.equal(await number.innerText(), "#A-137");
      assert.ok(await number.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      assert.equal(await page.locator("#cards h3").first().getAttribute("title"), "Spider-Man and the Fantastic Four");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
      console.log(`PASS subset labels + tile alignment at ${width}px`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
} finally {
  server.close();
}
