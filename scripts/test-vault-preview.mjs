// Development-studio QA and real-time capture. Runner stays outside app dependencies.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({ executablePath: '/repl/tools/bin/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const frames = '/tmp/vault-preview-recording';
await fs.mkdir(frames, { recursive: true });
await fs.mkdir('screenshots', { recursive: true });
try {
  await page.goto('http://127.0.0.1:5000/__dev/vault');
  const app = page.frameLocator('iframe[title="Live app beneath the vault transition"]');
  await app.getByText('Welcome to the Vault', { exact: true }).waitFor({ timeout: 60000 });
  for (let device = 0; device < 4; device++) {
    await page.locator('#vault-device').selectOption(String(device));
    await page.waitForTimeout(100);
    const size = await app.locator('body').evaluate(() => [innerWidth, innerHeight]);
    assert.deepEqual(size, [[393, 852], [375, 667], [360, 800], [412, 915]][device]);
    await page.evaluate(() => {
      window.samples = [];
      let seen = false;
      const sample = () => {
        const root = document.querySelector('[data-vault-launch]');
        if (!root && seen) return;
        if (root) {
          seen = true;
          window.samples.push([Number(getComputedStyle(root).opacity),
            Number(getComputedStyle(root.querySelector('.vault-launch__surface')).opacity)]);
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.getByRole('button', { name: 'Play sequence', exact: true }).click();
    await page.locator('[data-vault-launch]').waitFor();
    await page.locator('[data-vault-launch]').waitFor({ state: 'detached', timeout: 5000 });
    const samples = await page.evaluate(() => window.samples);
    const black = samples.findIndex(([root, surface]) => root === 1 && surface === 0);
    const reveal = samples.findIndex(([root]) => root > 0 && root < 1);
    assert.ok(black >= 0 && reveal > black, 'opaque black precedes actual app reveal');
    assert.ok(samples.every(([root, surface]) => root === 1 || surface === 0));
    assert.equal(await app.locator('[data-vault-launch]').count(), 0, 'web iframe never starts a second splash');
    await app.getByText('Welcome to the Vault', { exact: true }).waitFor();
  }
  await page.locator('#vault-device').selectOption('0');
  await page.waitForTimeout(250);
  const cdp = await page.context().newCDPSession(page);
  const shots = [];
  const writes = [];
  cdp.on('Page.screencastFrame', event => {
    const filename = `${frames}/frame-${String(shots.length).padStart(5, '0')}.jpg`;
    shots.push({ filename, time: event.metadata.timestamp });
    writes.push(fs.writeFile(filename, Buffer.from(event.data, 'base64')));
    void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId });
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1280, maxHeight: 900, everyNthFrame: 1 });
  await page.getByRole('button', { name: 'Play sequence', exact: true }).click();
  await page.waitForTimeout(6200);
  await cdp.send('Page.stopScreencast');
  await Promise.all(writes);
  assert.ok(shots.length > 70, 'enough real frames to show short reveal');
  const origin = shots[0].time;
  const lines = shots.flatMap((shot, i) => [
    `file '${shot.filename}'`,
    `duration ${Math.max(0.001, (shots[i + 1]?.time ?? origin + 6.2) - shot.time)}`,
  ]);
  lines.push(`file '${shots.at(-1).filename}'`);
  await fs.writeFile(`${frames}/frames.txt`, lines.join('\n'));
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0',
    '-i', `${frames}/frames.txt`, '-vf', 'fps=60', '-c:v', 'libx264', '-crf', '19',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', 'screenshots/vault-fade-preview.mp4']);
  await page.screenshot({ path: 'screenshots/vault-fade-preview-revealed.png' });
  console.log(`PASS four device sizes, live login underneath, black then fade, no nested splash; recorded ${shots.length} timed frames at 1280×900.`);
} finally {
  await browser.close();
}