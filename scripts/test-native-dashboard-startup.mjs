// Controlled network/auth fixtures only; production still uses real providers.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: '/repl/tools/bin/chromium', headless: true, args: ['--no-sandbox'] });
const base = process.env.VAULT_QA_URL || 'http://127.0.0.1:5000';
try {
  if (!process.env.WEB_COUNTS_ONLY) {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  const requests = [];
  page.on('pageerror', error => console.error(error.message));
  await page.addInitScript(() => {
    window.webkit = { messageHandlers: { bridge: { postMessage() {} } } };
    window.Capacitor = { nativePromise: async () => 'qa-listener', PluginHeaders: [{ name: 'App', methods: [
      { name: 'addListener', rtype: 'promise' }, { name: 'removeListener', rtype: 'promise' },
    ] }] };
  });
  await page.route('**/src/contexts/AuthContext.tsx*', route => route.fulfill({
    contentType: 'application/javascript',
    body: `import React from '/node_modules/.vite/deps/react.js';
      const C=React.createContext({});
      export const useAuth=()=>React.useContext(C);
      export function AuthProvider({children}){
        const [loading,setLoading]=React.useState(true);
        React.useEffect(()=>{const t=setTimeout(()=>{
          window.__backendReady=performance.now();setLoading(false)
        },700);return()=>clearTimeout(t)},[]);
        return React.createElement(C.Provider,{value:{loading,
          user:loading?null:{uid:'qa-only',email:'qa@example.test'},syncError:null}},children);
      }`,
  }));
  await page.route('**/src/pages/dashboard.tsx*', async route => {
    assert.equal(await page.evaluate(() => window.__backendReady), undefined,
      'dashboard code starts loading during authentication, not afterwards');
    await new Promise(r => setTimeout(r, 500));
    await route.continue();
  });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const ready = await page.evaluate(() => window.__backendReady);
    const covered = await page.locator('[data-vault-launch]').count() > 0;
    requests.push({ path, ready, covered });
    await new Promise(r => setTimeout(r, 250));
    const data = path === '/api/stats' ? { totalCards: 4321, totalValue: 1234, wishlistCount: 17 }
      : path === '/api/user/xp-summary' ? { level: 2, xpIntoLevel: 10, xpForNextLevel: 100, totalXp: 110, breakdown: { cardXp: 110, badgeXp: 0, imageXp: 0, totalXp: 110 }, recentXpEvents: [] }
      : path === '/api/recent-cards' ? [{ id: 1, cardId: 1, cardName: 'QA Recent Card', cardNumber: '1', setName: 'QA Set', acquiredDate: '2026-01-01', frontImageUrl: null }]
      : path === '/api/social/user-badges' ? [{ id: 1 }]
      : [];
    await route.fulfill({ json: data });
  });
  await page.goto(base);
  await page.locator('[data-vault-launch]').waitFor();
  await page.getByText('4,321', { exact: true }).waitFor({ timeout: 10000 }).catch(async error => {
    await page.screenshot({ path: '/tmp/native-dashboard-failed.png' });
    console.error(await page.locator('body').innerText(), requests);
    throw error;
  });
  assert.equal(await page.locator('[data-vault-launch]').count(), 1, 'real totals render while video still covers app');
  await page.locator('[data-vault-launch]').waitFor({ state: 'detached', timeout: 5000 });
  assert.ok(await page.getByText('4,321', { exact: true }).isVisible());
  assert.ok(await page.getByText('QA Recent Card', { exact: true }).isVisible());
  for (const path of ['/api/stats', '/api/recent-cards', '/api/user/xp-summary', '/api/social/user-badges']) {
    const matches = requests.filter(r => r.path === path);
    assert.equal(matches.length, 1, `${path} is deduplicated`);
    assert.ok(matches[0].ready, `${path} waits for backend authentication`);
    assert.ok(matches[0].covered, `${path} begins behind splash`);
  }
  await page.screenshot({ path: '/tmp/native-dashboard-ready.png', fullPage: true });
  console.log('PASS: authenticated primary queries during splash, no duplicates, ready totals/recent cards at reveal');
  await page.close();
  }

  // Regression: unknown counts must not seed NaN into the WEB count-up state.
  // Render the real stats component; only the network and surrounding App are fixtures.
  const web = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  web.on('pageerror', error => errors.push(error.message));
  let releaseBadges;
  const badgesReady = new Promise(resolve => { releaseBadges = resolve; });
  let statsRequests = 0;
  await web.route('**/src/App.tsx*', async route => {
    // Match Vite's versioned module URL so the fixture shares query context.
    const original = await (await route.fetch()).text();
    const queryModule = original.match(/from ["']([^"']*@tanstack_react-query[^"']*)["']/)?.[1];
    assert.ok(queryModule);
    return route.fulfill({
    contentType: 'application/javascript',
    body: `import React from '/node_modules/.vite/deps/react.js';
      import { QueryClientProvider } from ${JSON.stringify(queryModule)};
      import { queryClient } from '/src/lib/queryClient.ts';
      import { StatsDashboard } from '/src/components/dashboard/stats-dashboard.tsx';
      window.__reloadStats=()=>queryClient.invalidateQueries({queryKey:['/api/stats']});
      export default function App(){
        return React.createElement(QueryClientProvider,{client:queryClient},React.createElement(StatsDashboard));
      }`,
    });
  });
  await web.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/social/user-badges') {
      await badgesReady;
      return route.fulfill({ json: Array.from({ length: 47 }, (_, id) => ({ id })) });
    }
    const data = path === '/api/stats'
      ? { totalCards: 321, totalValue: 123, ...(++statsRequests > 1 ? { wishlistCount: 19 } : {}) }
      : { level: 2, xpIntoLevel: 10, xpForNextLevel: 100, totalXp: 110,
          breakdown: { cardXp: 110, badgeXp: 0, imageXp: 0, totalXp: 110 }, recentXpEvents: [] };
    await route.fulfill({ json: data });
  });
  await web.goto(base);
  const powers = web.locator('.group').filter({ has: web.getByText('POWERS', { exact: true }) }).locator('span.text-2xl');
  const wishlist = web.locator('.group').filter({ has: web.getByText('WISHLIST', { exact: true }) }).locator('span.text-2xl');
  await powers.waitFor({ timeout: 10000 }).catch(async error => {
    console.error(errors, await web.locator('body').innerText());
    throw error;
  });
  assert.equal(await powers.innerText(), '—');
  assert.equal(await wishlist.innerText(), '—');
  // Leave unknowns mounted for longer than one animation to catch poisoned refs.
  await web.waitForTimeout(1000);
  await web.evaluate(() => {
    window.__countSamples = [];
    const until = performance.now() + 1600;
    const sample = () => {
      const value = label => [...document.querySelectorAll('.group')].find(el =>
        [...el.querySelectorAll('span')].some(s => s.textContent === label))?.querySelector('span.text-2xl')?.textContent;
      window.__countSamples.push({ powers: value('POWERS'), wishlist: value('WISHLIST') });
      if (performance.now() < until) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  releaseBadges();
  await web.evaluate(() => window.__reloadStats());
  await web.waitForTimeout(1400);
  assert.equal(await powers.innerText(), '47', 'badges settle at fetched count, not NaN');
  assert.equal(await wishlist.innerText(), '19', 'wishlist recovers from missing field');
  const samples = await web.evaluate(() => window.__countSamples);
  for (const [key, target] of [['powers', 47], ['wishlist', 19]]) {
    assert.ok(samples.some(s => Number(s[key]) > 0 && Number(s[key]) < target), `${key} still animates on web`);
    assert.ok(samples.every(s => s[key] !== 'NaN'), `${key} never displays NaN`);
  }
  assert.deepEqual(errors, []);
  await web.close();
  console.log('PASS: web unknown badge/wishlist counts show dash, animate after fetch, and settle at real totals');
} finally {
  await browser.close();
}