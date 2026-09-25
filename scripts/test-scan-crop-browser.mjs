// Isolated browser fixture: real CardCrop component, synthetic pixels, no auth or paid scan API.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: '/repl/tools/bin/chromium',
  headless: true,
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));

try {
  await page.route('**/src/main.tsx*', route => route.fulfill({
    contentType: 'application/javascript',
    body: `
      import React from '/node_modules/.vite/deps/react.js';
      import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
      import { CardCrop } from '/src/components/CardCrop.tsx';
      import '/src/index.css';
      function Fixture() {
        const [file, setFile] = React.useState(null);
        const [result, setResult] = React.useState(null);
        React.useEffect(() => {
          const canvas = document.createElement('canvas');
          canvas.width = 900; canvas.height = 900;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#de2222'; ctx.fillRect(0, 0, 900, 900);
          ctx.fillStyle = '#126acf'; ctx.fillRect(250, 150, 400, 600);
          canvas.toBlob(blob => setFile(new File([blob], 'front.png', { type: 'image/png' })));
        }, []);
        return React.createElement('main', {className:'max-w-lg mx-auto p-4 bg-gray-50 min-h-screen'},
          file && !result && React.createElement(CardCrop, {
            file, onCancel: () => {}, onConfirm: (cropped) => {
              createImageBitmap(cropped).then(bitmap => {
                const resultCanvas = document.createElement('canvas');
                resultCanvas.width = bitmap.width; resultCanvas.height = bitmap.height;
                const ctx = resultCanvas.getContext('2d');
                ctx.drawImage(bitmap, 0, 0);
                const pixels = [[1,1],[bitmap.width >> 1, bitmap.height >> 1]].map(([x,y]) =>
                  Array.from(ctx.getImageData(x,y,1,1).data));
                window.__cropResult = {width:bitmap.width,height:bitmap.height,pixels,size:cropped.size};
                setResult(resultCanvas.toDataURL());
              });
            }
          }),
          result && React.createElement('img',{src:result,alt:'Cropped output'}));
      }
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Fixture));
    `,
  }));
  await page.goto(process.env.VAULT_QA_URL || 'http://127.0.0.1:5000/scan');
  await page.getByText('Crop your card front').waitFor({ timeout: 15000 }).catch(async error => {
    console.error('crop fixture failed', errors, await page.locator('body').innerText());
    throw error;
  });
  const frame = page.getByRole('slider', { name: 'Drag to position card crop' });
  const controls = page.getByRole('button', { name: 'Use front crop' });
  assert.ok(await controls.isVisible(), 'crop button must not be covered by dark overlay');
  await page.getByRole('slider', { name: 'Frame size' }).fill('64');
  const box = await frame.boundingBox();
  assert.ok(box);
  const dragBefore = await frame.getAttribute('aria-valuetext');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2);
  await page.mouse.up();
  assert.notEqual(await frame.getAttribute('aria-valuetext'), dragBefore, 'pointer drag moves frame');
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: 'Rotate' }).click();
    await frame.waitFor({ state: 'visible' });
  }
  await page.getByRole('button', { name: 'Landscape 3:2' }).click();
  const landscape = await frame.boundingBox();
  assert.ok(landscape.width > landscape.height, 'landscape card frame should be wider');
  await page.getByRole('button', { name: 'Portrait 2:3' }).click();
  await page.getByRole('slider', { name: 'Frame size' }).fill('64');
  await frame.focus();
  const before = await frame.getAttribute('aria-valuetext');
  await page.keyboard.press('ArrowRight');
  assert.notEqual(await frame.getAttribute('aria-valuetext'), before, 'keyboard moves crop');
  await page.keyboard.press('ArrowLeft');
  await mkdir('screenshots', { recursive: true });
  await page.screenshot({ path: 'screenshots/scan-crop-mobile.png', fullPage: true });
  await controls.click();
  await page.waitForFunction(() => Boolean(window.__cropResult));
  const result = await page.evaluate(() => window.__cropResult);
  assert.ok(Math.abs(result.width / result.height - 2 / 3) < 0.01);
  assert.ok(result.pixels.every(([red, , blue]) => blue > red + 50),
    'rendered crop must exclude red surrounding pixels at corners and center');
  assert.ok(result.size > 0);
  await page.screenshot({ path: 'screenshots/scan-crop-output-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS crop browser: keyboard move, usable controls, 2:3 blue-only output; screenshots saved');
} finally {
  await browser.close();
}