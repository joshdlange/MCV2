import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { eq, inArray, sql } from 'drizzle-orm';
import { db, pool } from '../db';
import { users, cardSets, cards, cardPriceCache, userCollections, blocks, follows } from '../../shared/schema';
import { getCollectionValue, getCollectionValueSummary, parseCollectionValueOptions, canViewTopCards } from '../services/collectionValue';
import { resolveCollectorAccess } from '../services/collectorAccess';
import { registerCollectionValueRoutes } from '../collection-value-routes';
import { optimizedStorage } from '../optimized-storage';
import { storage } from '../storage';
import { migrationPrice, publicPrice } from '../pricing/soldgraph-cache';

test('collection totals and dates match card-detail sold pricing, fallback and refresh', async () => {
  assert.notEqual(process.env.NODE_ENV, 'production');
  const oldProvider = process.env.PRICING_PROVIDER;
  const oldMaxAge = process.env.SOLDGRAPH_DISPLAY_MAX_AGE_DAYS;
  class Rollback extends Error {}
  try {
    process.env.PRICING_PROVIDER = 'soldgraph';
    process.env.SOLDGRAPH_DISPLAY_MAX_AGE_DAYS = '14';
    await assert.rejects(db.transaction(async tx => {
      const tag = `value-sold-${Date.now()}`;
      const [owner] = await tx.insert(users).values({
        username: tag, firebaseUid: tag, email: `${tag}@example.invalid`,
        marketingOptIn: false, emailUpdates: false,
      }).returning();
      const [set] = await tx.insert(cardSets).values({ name: tag, slug: tag, year: 2026 }).returning();
      const baselineAt = new Date(Date.now() - 20 * 86400000);
      const cases = [
        { age: 2, median: 60, usableCount: 4, baseline: 20 },
        { age: 13, median: 70, usableCount: 1, baseline: 30 },
        { age: 15, median: 90, usableCount: 3, baseline: 40 },
        { age: 1.5, median: null, usableCount: 0, baseline: 50 },
        { age: 15, median: 100, usableCount: 3, baseline: null },
        { age: 1.5, median: 25, usableCount: 2, baseline: null },
        { age: 1.5, median: 0, usableCount: 0, baseline: -1 },
      ];
      const ids: number[] = [];
      const expected = [];
      for (const [i, item] of cases.entries()) {
        const [card] = await tx.insert(cards).values({
          setId: set.id, name: `Price fixture ${i}`, cardNumber: String(i + 1), rarity: 'Common',
        }).returning();
        ids.push(card.id);
        await tx.insert(userCollections).values({ userId: owner.id, cardId: card.id, quantity: 2 });
        if (item.baseline !== null) {
          await tx.insert(cardPriceCache).values([
            { cardId: card.id, avgPrice: String(item.baseline), salesCount: 5, lastFetched: baselineAt },
          ]);
        }
        const refreshedAt = new Date(Date.now() - item.age * 86400000);
        const result = { median: item.median, usableCount: item.usableCount };
        await tx.execute(sql`INSERT INTO soldgraph_price_cache (card_id, query, result, refreshed_at, expires_at)
          VALUES (${card.id}, 'isolated value test', ${JSON.stringify(result)}::jsonb,
            ${refreshedAt}, ${new Date(Date.now() - 1000)})`);
        expected.push(migrationPrice(publicPrice(result, refreshedAt, new Date(0)),
          item.baseline === null ? undefined : { avg_price: item.baseline, last_fetched: baselineAt, sales_count: 5 }));
      }
      const options = parseCollectionValueOptions({ hideUnder5: 'false' });
      const value = await getCollectionValue(owner.id, options, tx);
      const total = expected.reduce((sum, p) => sum + (p.avgPrice ?? 0) * 2, 0);
      assert.equal(value.summary.totalValue, total);
      assert.equal(value.summary.pricedCards, 5);
      assert.equal(value.summary.unpricedCards, 2);
      assert.equal(value.summary.pricedCopies, 10);
      assert.equal(value.summary.oldestPriceUpdatedAt, baselineAt.toISOString());
      const latest = Math.max(...expected.filter(p => p.avgPrice != null).map(p => new Date(p.lastFetched!).getTime()));
      assert.equal(value.summary.pricesUpdatedAt, new Date(latest).toISOString());
      for (const card of value.cards) {
        assert.equal(card.marketValue, expected[ids.indexOf(card.id)].avgPrice);
      }
      assert.deepEqual(await getCollectionValueSummary(owner.id, tx), value.summary);

      const refreshTime = new Date();
      await tx.execute(sql`UPDATE soldgraph_price_cache SET
        result = '{"median":80,"usableCount":4}'::jsonb, refreshed_at = ${refreshTime}
        WHERE card_id = ${ids[0]}`);
      const refreshed = await getCollectionValueSummary(owner.id, tx);
      assert.equal(refreshed.totalValue, total + 40, 'refresh changes quantity-inclusive total immediately');
      assert.equal(refreshed.pricesUpdatedAt, refreshTime.toISOString());
      assert.equal(refreshed.oldestPriceUpdatedAt, baselineAt.toISOString());

      process.env.SOLDGRAPH_DISPLAY_MAX_AGE_DAYS = '1';
      assert.equal((await getCollectionValueSummary(owner.id, tx)).totalValue, (80 + 30 + 40 + 50) * 2);
      process.env.PRICING_PROVIDER = 'legacy';
      assert.equal((await getCollectionValueSummary(owner.id, tx)).totalValue, (20 + 30 + 40 + 50) * 2);
      throw new Rollback();
    }), error => error instanceof Rollback);
  } finally {
    if (oldProvider === undefined) delete process.env.PRICING_PROVIDER;
    else process.env.PRICING_PROVIDER = oldProvider;
    if (oldMaxAge === undefined) delete process.env.SOLDGRAPH_DISPLAY_MAX_AGE_DAYS;
    else process.env.SOLDGRAPH_DISPLAY_MAX_AGE_DAYS = oldMaxAge;
  }
});

test('query validation rejects invalid sort, pagination and filter inputs', () => {
  assert.deepEqual(parseCollectionValueOptions({}).order, 'desc');
  for (const query of [{ order: 'desc;drop' }, { limit: '26' }, { offset: '-1' }, { offset: ['0'] }, { hideUnder5: 'yes' }, { setId: '0' }]) {
    assert.throws(() => parseCollectionValueOptions(query));
  }
  assert.equal(canViewTopCards({ showCollection: false, profileVisibility: 'private' }, true), true);
  assert.equal(canViewTopCards({ showCollection: true, profileVisibility: 'friends' }, false), false);
});

test('1,205-card development fixture: SQL pagination, totals, quantities, privacy and speed', { timeout: 120_000 }, async () => {
  assert.notEqual(process.env.NODE_ENV, 'production', 'Development-only fixture');
  assert.ok(process.env.DATABASE_URL && process.env.DATABASE_URL !== process.env.NEON_DATABASE_URL, 'Never run against production');
  const token = `value-qa-${Date.now()}`;
  const fixtureUserIds: number[] = [];
  let setId: number | undefined;
  let server: ReturnType<typeof express.application.listen> | undefined;
  try {
    const createdUsers = await db.insert(users).values(['owner', 'visitor'].map(role => ({
      username: `${token}-${role}`, firebaseUid: `${token}-${role}`, email: `${token}-${role}@example.invalid`,
      marketingOptIn: false, emailUpdates: false, plan: 'SUPER_HERO', onboardingComplete: true,
    }))).returning();
    const [owner, visitor] = createdUsers;
    fixtureUserIds.push(owner.id, visitor.id);
    const [set] = await db.insert(cardSets).values({ name: 'Value QA (temporary)', slug: token, year: 2026 }).returning();
    setId = set.id;
    const fixtureCards = await db.insert(cards).values(Array.from({ length: 1206 }, (_, i) => ({
      name: `QA Card ${i + 1}`, cardNumber: `${i + 1}`, setId: set.id, rarity: 'Common',
      estimatedValue: '99999.00', isInsert: i % 2 === 0,
      archivedAt: i === 1205 ? new Date() : null,
    }))).returning({ id: cards.id });
    const priceAt = new Date('2026-10-01T12:00:00Z');
    const price = (n: number) => n <= 900 ? (n % 9 + 1) * 0.5 : n <= 1150 ? 5 + n % 90 : n <= 1190 ? 100 + n % 11 * 50 : n <= 1195 ? 0 : -1;
    const quantity = (n: number) => n % 10 === 0 ? 2 : 1;
    await db.insert(userCollections).values(fixtureCards.map((c, i) => ({
      userId: owner.id, cardId: c.id, quantity: quantity(i + 1), personalValue: '88888', isFavorite: i % 3 === 0,
    })));
    await db.insert(cardPriceCache).values(fixtureCards.slice(0, 1200).map((c, i) => ({
      cardId: c.id, avgPrice: String(price(i + 1)), salesCount: 5, lastFetched: priceAt,
    })));
    await db.insert(cardPriceCache).values({ cardId: fixtureCards[1205].id, avgPrice: '500000', salesCount: 5, lastFetched: priceAt });
    const expected = fixtureCards.slice(0, 1190).map((c, i) => ({ id: c.id, value: price(i + 1), quantity: quantity(i + 1) }));
    const expectedTotal = expected.reduce((sum, c) => sum + c.value * c.quantity, 0);
    const summary = await getCollectionValueSummary(owner.id);
    assert.equal(summary.totalValue, expectedTotal);
    assert.equal(summary.pricedCards, 1190);
    assert.equal(summary.unpricedCards, 15);
    assert.equal(summary.pricesUpdatedAt, priceAt.toISOString());
    assert.equal((await optimizedStorage.getUserStatsOptimized(owner.id)).totalValue, expectedTotal);
    assert.equal((await storage.getProfileStats(owner.id)).totalValue, expectedTotal);

    const timings: number[] = [];
    for (const order of ['asc', 'desc'] as const) {
      const sorted = [...expected].filter(c => c.value >= 5).sort((a, b) => (order === 'asc' ? a.value - b.value : b.value - a.value) || a.id - b.id);
      const received: number[] = [];
      for (let offset = 0; offset < sorted.length; offset += 25) {
        const start = performance.now();
        const result = await getCollectionValue(owner.id, parseCollectionValueOptions({ order, offset: String(offset) }));
        timings.push(performance.now() - start);
        assert.equal(result.total, 290);
        assert.equal(result.summary.totalValue, expectedTotal);
        assert.deepEqual(result.cards.map(c => c.id), sorted.slice(offset, offset + 25).map(c => c.id));
        assert.equal(result.hasMore, offset + result.cards.length < sorted.length);
        result.cards.forEach(c => assert.equal(c.lineTotal, c.marketValue * c.quantity));
        received.push(...result.cards.map(c => c.id));
      }
      assert.equal(new Set(received).size, 290);
    }
    const all = await getCollectionValue(owner.id, parseCollectionValueOptions({ order: 'asc', hideUnder5: 'false' }));
    assert.equal(all.total, 1190);
    assert.equal(all.cards[0].marketValue, 0.5);
    const filter = await getCollectionValue(owner.id, parseCollectionValueOptions({ hideUnder5: 'false', search: 'QA Card 1205', setId: String(setId) }));
    assert.equal(filter.total, 0, 'Unpriced cards never enter value list');
    assert.equal(filter.summary.totalValue, expectedTotal, 'Summary is independent of filters');
    const empty = await getCollectionValue(visitor.id, parseCollectionValueOptions({}));
    assert.equal(empty.summary.totalValue, 0);
    assert.deepEqual(empty.cards, []);

    // Real route + real DB privacy guard, with test-only auth in this isolated
    // Express harness. No Firebase bypass is added to the application.
    const app = express();
    registerCollectionValueRoutes(app, (req: any, res, next) => {
      const id = Number(req.headers['x-test-user']);
      if (!fixtureUserIds.includes(id)) return res.sendStatus(401);
      req.user = { id };
      next();
    }, resolveCollectorAccess);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server!.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const path = `/api/collectors/${owner.username}/top-cards`;
    const fetchAs = (id: number, route = path) => fetch(base + route, { headers: { 'x-test-user': String(id) } });
    assert.equal((await fetch(base + '/api/collection/value')).status, 401);
    assert.equal((await fetchAs(owner.id, '/api/collection/value?limit=26')).status, 400);
    assert.equal((await (await fetchAs(visitor.id)).json()).summary.totalValue, expectedTotal);
    assert.equal((await (await fetchAs(visitor.id, '/api/collection/value')).json()).summary.totalValue, 0);
    for (const visibility of ['public', 'friends', 'private']) {
      await db.update(users).set({ profileVisibility: visibility, showCollection: false }).where(eq(users.id, owner.id));
      assert.equal((await fetchAs(visitor.id)).status, 403);
      assert.equal((await fetchAs(owner.id)).status, 200);
    }
    await db.update(users).set({ profileVisibility: 'friends', showCollection: true }).where(eq(users.id, owner.id));
    await db.insert(follows).values([
      { followerUserId: visitor.id, followingUserId: owner.id },
      { followerUserId: owner.id, followingUserId: visitor.id },
    ]);
    assert.equal((await resolveCollectorAccess(owner.username, visitor.id)).ok, true);
    assert.equal((await fetchAs(visitor.id)).status, 403, 'Friends-only is not a public value collection');
    await db.update(users).set({ profileVisibility: 'public' }).where(eq(users.id, owner.id));
    for (const [blockerId, blockedUserId] of [[visitor.id, owner.id], [owner.id, visitor.id]]) {
      const [block] = await db.insert(blocks).values({ blockerId, blockedUserId }).returning();
      assert.equal((await fetchAs(visitor.id)).status, 403);
      await db.delete(blocks).where(eq(blocks.id, block.id));
    }
    assert.equal((await fetchAs(visitor.id)).status, 200);
    const p95 = timings.sort((a, b) => a - b)[Math.floor(timings.length * 0.95)];
    console.log(JSON.stringify({ collectionSize: 1205, priced: 1190, unpriced: 15, totalValue: expectedTotal, sqlPageP95Ms: Math.round(p95), pageRequests: timings.length }));
    assert.ok(p95 < 1500, `SQL pagination p95 exceeded 1.5s: ${p95}ms`);
  } finally {
    server?.closeAllConnections();
    server?.close();
    if (fixtureUserIds.length) {
      await db.delete(blocks).where(inArray(blocks.blockerId, fixtureUserIds));
      await db.delete(follows).where(inArray(follows.followerUserId, fixtureUserIds));
      await db.delete(userCollections).where(inArray(userCollections.userId, fixtureUserIds));
    }
    if (setId) {
      const ids = await db.select({ id: cards.id }).from(cards).where(eq(cards.setId, setId));
      if (ids.length) await db.delete(cardPriceCache).where(inArray(cardPriceCache.cardId, ids.map(c => c.id)));
      await db.delete(cards).where(eq(cards.setId, setId));
      await db.delete(cardSets).where(eq(cardSets.id, setId));
    }
    if (fixtureUserIds.length) await db.delete(users).where(inArray(users.id, fixtureUserIds));
  }
});

test.after(async () => { await pool.end(); });
