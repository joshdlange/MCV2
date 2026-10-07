import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import express from 'express';
import assert from 'node:assert/strict';

const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: 'tsx',
    contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {MessageComposer} from './client/src/components/message-composer';
      import {createMessageDraft} from './client/src/lib/messageDraft';
      window.parentRenders = 0; window.sent = [];
      function Harness() {
        window.parentRenders++;
        const [draft] = useState(createMessageDraft);
        const [pending, setPending] = useState(false);
        window.setPending = setPending;
        const send = () => {
          if (pending || !draft.getSnapshot().trim()) return;
          const text = draft.getSnapshot().trim();
          window.sent.push(text); draft.clearIfSent(text);
        };
        return <><div style={{display:'flex'}}>
          <MessageComposer draft={draft} pending={pending} onSend={send}/>
        </div><div style={{display:'none'}}>
          <MessageComposer draft={draft} pending={pending} onSend={send}/>
        </div><div>{Array.from({length:1000},(_,i)=><p key={i}>Message {i}</p>)}</div></>;
      }
      createRoot(document.getElementById('root')).render(<Harness/>);
    `,
  },
  bundle: true, write: false, format: 'iife', jsx: 'automatic',
  alias: { '@': './client/src' }, define: { 'process.env.NODE_ENV': '"production"' },
});
const app = express();
app.get('/', (_req, res) => res.send('<div id="root"></div><script src="/qa.js"></script>'));
app.get('/qa.js', (_req, res) => res.type('js').send(bundle.outputFiles[0].text));
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium',
  args: ['--no-sandbox'], headless: true,
});
try {
  for (const width of [393, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.goto(`http://127.0.0.1:${(server.address() as any).port}`);
    const input = page.locator('textarea').first();
    await input.waitFor();
    const renders = await page.evaluate(() => (window as any).parentRenders);
    await input.type('Typing remains responsive', { delay: 5 });
    assert.equal(await input.inputValue(), 'Typing remains responsive');
    assert.equal(await page.locator('textarea').nth(1).inputValue(), 'Typing remains responsive');
    assert.equal(await page.evaluate(() => (window as any).parentRenders), renders);
    await input.press('Shift+Enter');
    await input.type('Second line');
    assert.ok((await input.inputValue()).includes('\n'));
    await input.press('Enter');
    assert.equal(await input.inputValue(), '');
    assert.deepEqual(await page.evaluate(() => (window as any).sent), ['Typing remains responsive\nSecond line']);
    await input.fill('   ');
    assert.equal(await page.getByRole('button', { name: 'Send message' }).first().isDisabled(), true);
    await input.fill('Pending draft');
    await page.evaluate(() => (window as any).setPending(true));
    assert.equal(await page.getByRole('button', { name: 'Send message' }).first().isDisabled(), true);
    await input.press('Enter');
    assert.equal(await input.inputValue(), 'Pending draft');
    await page.close();
    console.log(`${width}px: typing caused zero parent renders; shared drafts, multiline, send/reset and pending checks passed (4x CPU throttle)`);
  }
} finally {
  await browser.close();
  server.close();
}
