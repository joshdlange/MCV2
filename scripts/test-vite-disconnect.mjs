// Isolated reproduction of Vite's reload behavior, not a physical-phone claim.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = await mkdtemp(path.join(tmpdir(), 'vite-disconnect-'));
await writeFile(path.join(root, 'index.html'), '<html><body>HMR disconnect test</body></html>');
const server = await createServer({configFile:false, root, server:{host:'127.0.0.1',port:0}});
const browser = await chromium.launch({executablePath:'/repl/tools/bin/chromium',args:['--no-sandbox']});
try {
  await server.listen();
  const page = await browser.newPage();
  let navigations = 0;
  const messages = [];
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
  page.on('console', message => { if (message.text().includes('[vite]')) messages.push(message.text()); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.waitForFunction(() => true);
  await new Promise(resolve => setTimeout(resolve, 1000));
  assert.ok(server.ws.clients.size > 0);
  for (const client of server.ws.clients) client.socket.terminate();
  await page.waitForFunction(() => performance.getEntriesByType('navigation')[0]?.type === 'reload', {timeout:10000});
  assert.ok(navigations >= 2);
  console.log(JSON.stringify({result:'PASS',navigations,navigationType:'reload',messages}));
} finally { await browser.close(); await server.close(); }