// Browser-only fixtures: renders the actual Social page; no production data is changed.
// Uses Chromium's DevTools protocol directly, so no test dependency is installed.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.env.PERKS_QA_URL || "http://127.0.0.1:5000";
const profile = await mkdtemp(join(tmpdir(), "perks-browser-"));
const chrome = spawn("/repl/tools/bin/chromium", [
  "--headless", "--no-sandbox", "--disable-dev-shm-usage", "--remote-debugging-port=0",
  `--user-data-dir=${profile}`, "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
let socket;
try {
  const browserUrl = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("Chromium startup timed out")), 10000);
    chrome.stderr.on("data", chunk => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    chrome.on("error", reject);
  });
  const browserOrigin = browserUrl.replace("ws:", "http:").split("/devtools/")[0];
  const target = await (await fetch(`${browserOrigin}/json/new?about:blank`, { method: "PUT" })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener("open", resolve, { once: true }));
  let id = 0;
  const pending = new Map();
  const errors = [];
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    pending.set(requestId, { resolve, reject });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  const appCode = await (await fetch(`${base}/src/App.tsx`)).text();
  const queryModule = appCode.match(/from ["']([^"']*@tanstack_react-query[^"']*)["']/)?.[1];
  assert.ok(queryModule, "existing dev app must be running");
  const fulfill = (requestId, body, mime = "application/javascript") => send("Fetch.fulfillRequest", {
    requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: mime }],
    body: Buffer.from(body).toString("base64"),
  });
  socket.addEventListener("message", async event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const callback = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) callback.reject(new Error(JSON.stringify(message.error)));
      else callback.resolve(message.result);
      return;
    }
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
    if (message.method !== "Fetch.requestPaused") return;
    const { requestId, request } = message.params;
    const path = new URL(request.url).pathname;
    try {
      if (path === "/src/App.tsx") {
        await fulfill(requestId, `import React from '/node_modules/.vite/deps/react.js';
          import {QueryClientProvider} from ${JSON.stringify(queryModule)};
          import {queryClient} from '/src/lib/queryClient.ts';
          import Social from '/src/pages/Social.tsx';
          export default function App(){return React.createElement(QueryClientProvider,
            {client:queryClient}, React.createElement('main',
              {className:'min-h-screen bg-gray-50 dark:bg-gray-950'},React.createElement(Social)));}`);
      } else if (path === "/src/contexts/AuthContext.tsx") {
        await fulfill(requestId, `export const useAuth=()=>({user:null,loading:false});
          export const AuthProvider=({children})=>children;`);
      } else {
        await fulfill(requestId, path.includes("unlock-stats") ? "{}" : "[]", "application/json");
      }
    } catch (error) { errors.push(error.message); }
  });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Fetch.enable", { patterns: [
    { urlPattern: "*/src/App.tsx*" }, { urlPattern: "*/src/contexts/AuthContext.tsx*" }, { urlPattern: "*/api/*" },
  ] });
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async expression => {
    const start = Date.now();
    while (!await evaluate(expression)) {
      if (Date.now() - start > 20000) throw new Error(`Timed out: ${expression}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  };
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 950, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${base}/social` });
  const trigger = `document.querySelector('button[aria-label="Actual Prints: $10 off One Touch stickers"]')`;
  await until(`!!${trigger}`);
  assert.equal(await evaluate(`document.querySelector('code')`), null, "coupon hidden until opened");
  assert.equal(await evaluate(`document.querySelector('a[href="https://actualprints.com/"]')`), null, "shop hidden until opened");
  await until(`${trigger}.querySelector('img').naturalWidth===160`);
  assert.ok(await evaluate(`${trigger}.getBoundingClientRect().height<=40`), "compact pill, not a banner");
  await evaluate(`${trigger}.focus();${trigger}.click()`);
  await until(`!!document.querySelector('a[href="https://actualprints.com/"]')`);
  assert.ok(await evaluate(`document.querySelector('[role="dialog"]')?.getAttribute('aria-labelledby')`), "accessible dialog title");
  assert.equal(await evaluate(`document.querySelector('code').textContent`), "MARVELCARDVAULT");
  assert.equal(await evaluate(`document.querySelector('a[href="https://actualprints.com/"]').rel`), "noopener noreferrer");
  assert.equal(await evaluate(`document.querySelector('a[href="https://actualprints.com/"]').target`), "_blank");
  assert.equal(await evaluate(`document.querySelectorAll('a[href="https://www.whatnot.com/invite/joshdlange045"]').length`), 1);
  assert.ok(await evaluate(`document.querySelector('a[href="https://www.whatnot.com/invite/joshdlange045"]').title.includes('new users get $25 to spend after their first purchase')`));
  const button = `document.querySelector('button[aria-label="Copy checkout code MARVELCARDVAULT"]')`;
  await evaluate(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copied=text}}});${button}.click()`);
  await until(`document.querySelector('[role="status"]').textContent.includes('Code copied.')`);
  assert.equal(await evaluate("window.__copied"), "MARVELCARDVAULT");
  await evaluate(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('permission denied')}}});
    document.querySelector('button[aria-label="Code copied"]').click()`);
  await until(`document.querySelector('[role="status"]').textContent.includes("Couldn't copy.")`);
  // Native routing uses the already-installed Capacitor object; no real shop is opened.
  await evaluate(`window.Capacitor.isNativePlatform=()=>true;
    window.Capacitor.Plugins.Browser={open:async({url})=>{window.__opened=url}};
    document.querySelector('a[href="https://actualprints.com/"]').click()`);
  await until(`window.__opened==='https://actualprints.com/'`);
  await evaluate(`window.Capacitor.Plugins.Browser.open=async()=>{throw new Error('browser unavailable')};
    document.querySelector('a[href="https://actualprints.com/"]').click()`);
  await until(`document.querySelector('[role="alert"]')?.textContent.includes("Couldn't open the shop.")`);
  await evaluate(`window.Capacitor.Plugins.Browser.open=async({url})=>{window.__opened=url};
    document.querySelector('a[href="https://actualprints.com/"]').click();
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{}}});${button}.click()`);
  await until(`document.querySelector('[role="status"]').textContent.includes('Code copied.')`);
  await new Promise(resolve => setTimeout(resolve, 400));
  const screenshot = async name => {
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(`/tmp/collector-perks-${name}.png`, Buffer.from(data, "base64"));
  };
  await screenshot("desktop-dialog");
  for (const width of [320, 375, 393, 768]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth`), `no overflow at ${width}px`);
    assert.ok(await evaluate(`document.querySelector('code').getBoundingClientRect().right<=innerWidth`));
    await screenshot(`${width}-dialog`);
  }
  await evaluate(`document.documentElement.classList.add('dark')`);
  await screenshot("dark-dialog");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await until(`!document.querySelector('[role="dialog"]')`);
  assert.equal(await evaluate(`document.activeElement===${trigger}`), true, "Escape restores trigger focus");
  assert.equal(await evaluate(`document.querySelector('code')`), null, "coupon unmounted when closed");
  await evaluate(`${trigger}.blur()`);
  await screenshot("dark");
  await evaluate(`document.documentElement.classList.remove('dark')`);
  for (const width of [320, 375, 393, 768, 1280]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 950, deviceScaleFactor: 1, mobile: false });
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth`), `closed header no overflow at ${width}px`);
    assert.ok(await evaluate(`${trigger}.getBoundingClientRect().right<=innerWidth`));
    await screenshot(`${width}`);
  }
  assert.deepEqual(errors, [], "no page runtime errors");
  console.log("PASS: compact official-logo pill, hidden coupon, accessible dialog, Escape/focus return, exact code/link, Whatnot preservation, clipboard success/failure, native shop success/failure, 320–1280px layouts and dark mode. Screenshots /tmp/collector-perks-*.png");
} finally {
  socket?.close();
  chrome.kill();
  await new Promise(resolve => chrome.once("exit", resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}