// Real development origin, real browser decoders. Does NOT simulate signed-in auth.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const dir = await mkdtemp(path.join(os.tmpdir(), 'scan-phone-images-'));
const fixture = await fetch('https://raw.githubusercontent.com/alexcorvi/heic2any/master/demo/1.heic');
assert.equal(fixture.ok, true);
const heic = path.join(dir, 'sample.heic');
await writeFile(heic, Buffer.from(await fixture.arrayBuffer()));
const large = path.join(dir, 'large-camera-size.jpg');
const jpeg = await sharp(randomBytes(4032 * 3024 * 3), {
  raw: { width: 4032, height: 3024, channels: 3 },
}).jpeg({ quality: 100, chromaSubsampling: '4:4:4' }).toBuffer();
assert.ok(jpeg.length > 10 * 1024 * 1024);
await writeFile(large, jpeg);
const browser = await chromium.launch({ executablePath: '/repl/tools/bin/chromium', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  await page.goto(`https://${process.env.REPLIT_DEV_DOMAIN}/scan`);
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.type = 'file'; input.id = 'decoder-test-input'; document.body.append(input);
  });
  for (const file of [heic, large]) {
    await page.locator('#decoder-test-input').setInputFiles(file);
    const result = await page.evaluate(async () => {
      const { prepareScanImage, scanCanvasBlob } = await import('/src/lib/scanImage.ts');
      const input = document.querySelector('#decoder-test-input').files[0];
      const canvas = await prepareScanImage(input, 0);
      const output = await scanCanvasBlob(canvas);
      return { kind: input.name.endsWith('.heic') ? 'public HEIC sample' : 'synthetic 12MP JPEG',
        inputBytes: input.size, width: canvas.width, height: canvas.height,
        outputBytes: output.size, outputType: output.type };
    });
    assert.ok(Math.max(result.width, result.height) <= 1600);
    assert.equal(result.outputType, 'image/jpeg');
    assert.ok(result.outputBytes < 5 * 1024 * 1024);
    console.log(result);
  }
  console.log('PASS: real dev origin decoding. Not a signed-in scan or physical-phone test.');
} finally { await browser.close(); }