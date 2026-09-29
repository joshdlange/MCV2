// Isolated feed fixture: real Feed + CardDetailModal, all API writes intercepted.
// Requires an already-running Vite preview; never signs in or mutates user data.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: '/repl/tools/bin/chromium',
  headless: true,
  args: ['--no-sandbox'],
});
const base = process.env.VAULT_QA_URL || 'http://127.0.0.1:5000/feed';
const user = { id: 1, username: 'fixture-collector', displayName: null, photoURL: null, collectorAvatarKey: null, collectorLevel: 1 };
const card = {
  id: 721, setId: 8, cardNumber: '7', name: 'Fixture Hero',
  rarity: 'Common', variation: null, isInsert: false, estimatedValue: '7.50',
  frontImageUrl: null, backImageUrl: null, description: 'Fixture card details',
  set: { id: 8, name: 'Fixture Set', year: 2024 },
};
const events = [
  { id: 1, eventType: 'first_card', title: 'added their first card to the Vault', image: null, relatedType: 'card', relatedId: 721 },
  { id: 2, eventType: 'first_card', title: 'added their first card to the Vault', image: 'https://feed-fixture.invalid/dead.png', relatedType: 'card', relatedId: 721 },
].map(event => ({
  ...event, metadata: null, previewImages: null, createdAt: new Date().toISOString(),
  user, reactions: {}, myReaction: null,
}));

try {
  for (const width of [1280, 393]) {
    card.frontImageUrl = null;
    events[0].image = null;
    const page = await browser.newPage({ viewport: { width, height: 852 } });
    const errors = [];
    const writes = [];
    let collection = [];
    let wishlist = [];
    let refreshed = false;
    page.on('pageerror', error => errors.push(error.message));
    const queryClientSource = await (await page.request.get(new URL('/src/lib/queryClient.ts', base).href)).text();
    const reactQueryUrl = queryClientSource.match(/"(\/node_modules\/\.vite\/deps\/@tanstack_react-query\.js\?v=[^"]+)"/)?.[1];
    assert.ok(reactQueryUrl, 'Vite React Query module should be available');
    await page.route('**/src/main.tsx*', route => route.fulfill({
      contentType: 'application/javascript',
      body: `
        import React from '/node_modules/.vite/deps/react.js';
        import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
        import { QueryClientProvider } from '${reactQueryUrl}';
        import { queryClient } from '/src/lib/queryClient.ts';
        import Feed from '/src/pages/Feed.tsx';
        import '/src/index.css';
        window.__fixtureQueryClient = queryClient;
        ReactDOM.createRoot(document.getElementById('root')).render(
          React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(Feed))
        );
      `,
    }));
    await page.route('**/api/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      const method = request.method();
      if (method !== 'GET') writes.push(`${method} ${path}`);
      let result;
      if (path === '/api/feed') result = url.searchParams.has('before')
        ? { events: [{
          ...events[0], id: 3, eventType: 'level_milestone', title: 'reached a new level',
          relatedType: null, relatedId: null, image: null,
        }], nextCursor: null }
        : { events, nextCursor: refreshed ? null : 'fixture-cursor' };
      else if (path === '/api/feed/following') result = { viewerId: 1, ids: [] };
      else if (path === '/api/collection') {
        if (method === 'POST') collection = [{ id: 41, cardId: 721, quantity: 1, card }];
        result = method === 'GET' ? collection : collection[0];
      } else if (path === '/api/collection/41') {
        collection = [];
        result = { success: true };
      } else if (path === '/api/wishlist') {
        if (method === 'POST') wishlist = [{ id: 51, cardId: 721, card }];
        result = method === 'GET' ? wishlist : wishlist[0];
      } else if (path === '/api/wishlist/51') {
        wishlist = [];
        result = { success: true };
      } else if (path === '/api/cards/721') result = card;
      else if (path === '/api/card-pricing/721') result = { avgPrice: 8.5, salesCount: 2, lastFetched: new Date().toISOString() };
      else if (path === '/api/subscription-status') result = { plan: 'SIDE_KICK', subscriptionStatus: 'active' };
      else if (path === '/api/stats') result = {};
      else if (path === '/api/badges') result = [];
      else return route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"Unexpected fixture endpoint"}' });
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(result) });
    });
    await page.route('https://feed-fixture.invalid/**', route => route.fulfill({ status: 404, body: '' }));
    await page.goto(base);
    await page.getByTestId('button-view-card-1').waitFor({ timeout: 10000 }).catch(async error => {
      console.error('Feed fixture failed', errors, (await page.locator('body').innerText()).slice(0, 900));
      throw error;
    });
    await page.getByTestId('feed-event-3').waitFor();
    await page.waitForFunction(() => document.querySelectorAll('img[alt="Card image not yet available"]').length === 2);
    assert.equal(await page.getByAltText('Card image not yet available').count(), 2, 'missing and dead images must have placeholders');
    await page.getByTestId('button-view-card-2').click();
    await page.getByText('Fixture Hero').waitFor();
    assert.ok(await page.getByText('Fixture card details').isVisible());
    assert.ok(await page.getByText('$8.50').first().isVisible(), 'card pricing should be available');
    await page.getByTestId('button-add-to-collection').click();
    await page.getByTestId('button-remove-from-collection').waitFor();
    await page.getByTestId('button-remove-from-collection').click();
    await page.getByTestId('button-add-to-collection').waitFor();
    await page.getByTestId('button-add-to-wishlist').click();
    await page.getByTestId('button-remove-from-wishlist').waitFor();
    await page.getByTestId('button-remove-from-wishlist').click();
    await page.getByTestId('button-add-to-wishlist').waitFor();
    await page.keyboard.press('Escape');
    await page.getByTestId('button-view-card-1').click();
    await page.getByText('Fixture Hero').waitFor();
    assert.ok(!(await page.getByAltText('Fixture Hero').getAttribute('src'))?.startsWith('data:image/svg+xml'), 'missing image remains viewable');
    await page.keyboard.press('Escape');
    // Simulate a subsequent image import in the intercepted response. Reopening
    // details must refresh the cached card, not preserve the missing image.
    card.frontImageUrl = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E';
    await page.getByTestId('button-view-card-1').click();
    await page.waitForFunction(() => document.querySelector('img[alt="Fixture Hero"]')?.getAttribute('src')?.startsWith('data:image/svg+xml'));
    await page.keyboard.press('Escape');
    refreshed = true;
    events[0].image = card.frontImageUrl;
    await page.evaluate(() => window.__fixtureQueryClient.refetchQueries({ queryKey: ['/api/feed', 'everyone'] }));
    await page.getByTestId('feed-event-3').waitFor({ state: 'detached' });
    assert.ok(await page.getByTestId('feed-event-1').locator('img[src^="data:image/svg+xml"]').count(), 'refreshed first page shows new image');
    events[0].image = null;
    assert.deepEqual(writes, [
      'POST /api/collection', 'DELETE /api/collection/41',
      'POST /api/wishlist', 'DELETE /api/wishlist/51',
    ]);
    assert.deepEqual(errors, [], `browser errors at ${width}px`);
    await page.close();
    console.log(`Feed fixture passed at ${width}px (no live API writes)`);
  }
} finally {
  await browser.close();
}