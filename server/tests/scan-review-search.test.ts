import assert from 'node:assert/strict';
import { test } from 'node:test';

test('development catalog structured search, paging, relevance, archived and filters (read only)',
  { skip: !process.env.DATABASE_URL }, async () => {
    const { searchReviewCatalog } = await import('../services/scanReviewSearch');
    const { pool } = await import('../db');
    try {
      for (const q of ['2026 Cyclops', 'Cyclops 2026', 'Topps Chrome Invisible Woman',
        '1993 Phoenix 41', 'Marvel Masterpieces Phoenix 85']) {
        const result = await searchReviewCatalog({ q });
        assert.ok(result.total > 0, q);
        assert.ok(result.cards.length > 0, q);
      }
      for (const year of ['1993', '2025', '2026']) {
        const standalone = await searchReviewCatalog({ q: year, status: 'all' });
        assert.ok(standalone.total > 0, year);
        assert.ok(standalone.cards.every(card => card.year === Number(year)), `standalone ${year}`);
        const filtered = await searchReviewCatalog({ q: 'Phoenix', year, status: 'all' });
        assert.ok(filtered.cards.every(card => card.year === Number(year)), `filtered ${year}`);
      }
      for (const q of ['1993 Phoenix', '1993 Marvel Masterpieces', '1993 Phoenix 85']) {
        const result = await searchReviewCatalog({ q, status: 'all' });
        assert.ok(result.cards.length, q);
        assert.ok(result.cards.every(card => card.year === 1993), q);
      }
      await assert.rejects(searchReviewCatalog({ q: 'null' }), /Missing-value tokens/);
      await assert.rejects(searchReviewCatalog({ q: '1993 null' }), /Missing-value tokens/);
      const cyclops = await searchReviewCatalog({ q: '2026 Cyclops', year: '2026' });
      assert.ok(cyclops.total > 30);
      assert.ok(cyclops.cards.every(card => card.year === 2026));
      assert.ok(cyclops.cards[0].name.toLowerCase().includes('cyclops'));
      const later = await searchReviewCatalog({ q: '2026 Cyclops', year: '2026', page: '2' });
      assert.equal(later.from, 31);
      assert.equal(later.total, cyclops.total);
      assert.ok(later.cards.every(card => !cyclops.cards.some(first => first.cardId === card.cardId)));
      const exact = await searchReviewCatalog({ q: 'Phoenix', year: '1993',
        mainSet: '1993 SkyBox Marvel Masterpieces',
        subset: '1993 SkyBox Marvel Masterpieces - Base', cardNumber: '85', status: 'all' });
      assert.ok(exact.cards.some(card => card.cardId === 17202));
      const archived = await searchReviewCatalog({ q: 'Marvel Masterpieces Phoenix 85', status: 'archived' });
      const old = archived.cards.find(card => card.cardId === 198);
      assert.ok(old?.isArchived);
      assert.equal(old?.canonicalActiveId, null); // Different structured set identities; no guessed merge with 17202.
      assert.ok(archived.cards.every(card => card.isArchived));
      const active = await searchReviewCatalog({ q: 'Marvel Masterpieces Phoenix 85', status: 'active' });
      assert.ok(active.cards.every(card => !card.isArchived));
    } finally { await pool.end(); }
  });