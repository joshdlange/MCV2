// Isolated component fixture. No real authentication or API traffic.
import { build } from "esbuild";
import { chromium } from "playwright-core";
import express from "express";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "message-qa-"));
execFileSync("node_modules/.bin/tailwindcss", ["-i", "client/src/index.css", "-o", join(temp, "style.css")], { stdio: "pipe" });
const bundle = await build({
  stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
    import Social from './client/src/pages/Social';
    import {useAppStore} from './client/src/lib/store';
    useAppStore.setState({currentUser:{id:1,username:'me'}});
    const client = new QueryClient({defaultOptions:{queries:{retry:false}}});
    window.qaClient = client;
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><Social/></QueryClientProvider>);
  ` },
  bundle: true, write: false, format: "iife", jsx: "automatic",
  alias: { "@": "./client/src" },
  loader: { ".png": "dataurl", ".webp": "dataurl", ".svg": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
  plugins: [{ name: "isolated-auth", setup(builder) {
    builder.onResolve({ filter: /lib\/collectorAvatars$/ }, () => ({ path: "avatars", namespace: "fixture" }));
    builder.onResolve({ filter: /(?:contexts\/AuthContext|lib\/firebase|\.\/firebase)$/ }, () => ({ path: "auth", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({
      contents: args.path === "avatars" ? `export const avatarUrl=()=>null;` : `const user={getIdToken:async()=>'fixture'}; export const auth={currentUser:user}; export const useAuth=()=>({user});`,
      loader: "js",
    }));
  } }],
});
const app = express();
app.get("/", (_, res) => res.send('<link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/qa.js"></script>'));
app.get("/style.css", (_, res) => res.type("css").send(readFileSync(join(temp, "style.css"))));
app.get("/qa.js", (_, res) => res.type("js").send(bundle.outputFiles[0].text));
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"], headless: true });
try {
  for (const width of [393, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    const errors: string[] = [];
    page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
    const people = [2, 3, 4].map(id => ({ id, username: `collector${id}`, displayName: `Collector ${id}`, isFriend: id === 2 }));
    const threads = people.slice(0, 2).map((user, index) => ({
      user, unreadCount: index === 0 ? 1 : 0,
      lastMessage: { senderId: user.id, content: `preview ${user.id}`, createdAt: "2026-01-02T12:00:00Z" },
    }));
    const history = Array.from({ length: 60 }, (_, i) => ({
      id: i + 1, senderId: 2, recipientId: 1, content: `Message ${i + 1}`,
      createdAt: "2026-01-02T12:00:00Z", sender: people[0], isRead: true,
    }));
    const sends: any[] = [];
    await page.route("**/api/**", async route => {
      const url = new URL(route.request().url());
      let data: any = [];
      if (url.pathname.endsWith("/relationships")) data = { friends: [people[0]], followers: [], following: [] };
      else if (url.pathname.endsWith("/message-threads")) data = threads;
      else if (url.pathname.endsWith("/message-users")) {
        const q = url.searchParams.get("q") ?? "";
        data = q ? people.filter(p => p.username.includes(q)) : [people[0]];
      } else if (url.pathname.endsWith("/unread-count")) data = { count: 1 };
      else if (url.pathname.endsWith("/messages/2")) data = history;
      else if (url.pathname.endsWith("/messages") && route.request().method() === "POST") {
        sends.push(route.request().postDataJSON()); data = { id: 100 };
      }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
    });
    await page.goto(`http://127.0.0.1:${(server.address() as any).port}/?tab=messages`);
    const visible = (selector: string) => page.locator(`${selector}:visible`);
    await visible('[aria-label="Search conversations"]').fill("preview 3");
    await page.getByText("Collector 3", { exact: true }).filter({ visible: true }).waitFor();
    assert.equal(await page.getByText("Collector 2", { exact: true }).filter({ visible: true }).count(), 0);
    await visible('[aria-label="Search conversations"]').fill("");
    await page.getByRole("button", { name: "Unread", exact: true }).filter({ visible: true }).click();
    assert.equal(await page.getByText("Collector 3", { exact: true }).filter({ visible: true }).count(), 0);
    await page.getByRole("button", { name: "All", exact: true }).filter({ visible: true }).click();
    await page.getByText("Collector 2", { exact: true }).filter({ visible: true }).click();
    await page.waitForFunction(() => Array.from(document.querySelectorAll("div.overflow-y-auto")).some(el =>
      (el as HTMLElement).offsetHeight > 0 && el.textContent?.includes("Message 60") && el.scrollHeight > el.clientHeight && el.scrollHeight - el.clientHeight - el.scrollTop < 5));
    const pane = visible("div.overflow-y-auto").filter({ has: page.getByText("Message 60", { exact: true }) });
    await pane.evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event("scroll", { bubbles: true })); });
    await page.evaluate(() => (window as any).qaClient.invalidateQueries({ queryKey: ["social/messages"] }));
    await page.waitForTimeout(150);
    assert.equal(await pane.evaluate(el => el.scrollTop), 0, "poll preserves older reading");
    if (width < 768) await page.getByTestId("button-back-to-chats").click();
    await page.getByRole("button", { name: /New/ }).filter({ visible: true }).click();
    await page.getByTestId("message-user-2").click();
    await page.getByText("Message 60", { exact: true }).filter({ visible: true }).waitFor();
    if (width < 768) await page.getByTestId("button-back-to-chats").click();
    await page.getByRole("button", { name: /New/ }).filter({ visible: true }).click();
    await page.getByTestId("input-message-user-search").fill("collector4");
    await page.getByTestId("message-user-4").click();
    await page.getByRole("heading", { name: "Collector 4", exact: true }).filter({ visible: true }).waitFor();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await visible("textarea").fill("Hello new collector");
    await visible("textarea").press("Enter");
    await page.waitForTimeout(150);
    assert.deepEqual(sends, [{ recipientId: 4, content: "Hello new collector" }]);
    assert.deepEqual(errors, []);
    console.log(`${width}px: filters, existing/new lookup, send, bottom on open, reader position passed`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
  rmSync(temp, { recursive: true, force: true });
}
