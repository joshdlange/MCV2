import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Papa from 'papaparse';
import { sql } from 'drizzle-orm';
import checklist from '../seeds/data/skybox-wizard-chromium-1996.json';

test('Wizard checklist preserves all supplied CSV names, numbers, and artist details', () => {
  const parsed = Papa.parse<Record<string, string>>(readFileSync(
    'attached_assets/1996_Wizard_Series_4_Chromium_-_Sheet1_(1)_1790345293877.csv', 'utf8'),
  { header: true, skipEmptyLines: true });
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.data.length, 20);
  assert.ok(parsed.data.every(row => row['Main set'] === '1996 Skybox Wizard Chromium' &&
    row['Sub Set'] === 'Series 4' && row['Is Insert'] === 'FALSE'));
  assert.deepEqual(checklist, parsed.data.map(row => ({
    number: row['Card Number'], name: row['Card Name'], details: row.Details,
  })));
  assert.deepEqual(checklist[7], { number: '8', name: 'Spider-Man', details: 'Mike Wieringo' });
});

test('development import is atomic, repeatable, audited, and preserves subsequent edits', {
  skip: process.env.RUN_WIZARD_IMPORT_DB_TEST !== '1',
}, async () => {
  assert.notEqual(process.env.NODE_ENV, 'production');
  assert.notEqual(process.env.DATABASE_URL, process.env.NEON_DATABASE_URL);
  const { db, pool, healthPool } = await import('../db');
  const { importSkyboxWizardChromium1996: run } = await import('../seeds/importSkyboxWizardChromium1996');
  const marker = 'import_skybox_wizard_chromium_1996';
  try {
    await run();
    assert.deepEqual(await run(), { imported: false, inserted: 0 });
    const evidence = await db.execute(sql`
      SELECT m.thumbnail_image_url, s.year, s.total_cards, count(c.id)::int AS actual,
        count(c.id) FILTER (WHERE c.front_image_url IS NOT NULL)::int AS illustrated
      FROM main_sets m JOIN card_sets s ON s.main_set_id=m.id JOIN cards c ON c.set_id=s.id
      WHERE m.slug='1996-skybox-wizard-chromium'
      GROUP BY m.thumbnail_image_url,s.year,s.total_cards`);
    assert.equal(evidence.rows.length, 1);
    assert.equal(evidence.rows[0].year, 1996);
    assert.equal(evidence.rows[0].total_cards, 20);
    assert.equal(evidence.rows[0].actual, 20);
    assert.equal(evidence.rows[0].illustrated, 1);
    const audit = await db.execute(sql`
      SELECT a.id FROM admin_audit_logs a JOIN cards c ON a.entity_id=c.id
      JOIN card_sets s ON c.set_id=s.id
      WHERE s.slug='1996-skybox-wizard-chromium-series-4'
        AND c.card_number='8' AND c.name='Spider-Man'
        AND a.action_type='card_image_update' AND a.notes::jsonb->>'source'=${marker}`);
    assert.equal(audit.rows.length, 1);
    const rollback = new Error('expected test rollback');
    await assert.rejects(db.transaction(async tx => {
      await tx.execute(sql`UPDATE main_sets SET thumbnail_image_url='https://example.com/later-admin-edit.jpg'
        WHERE slug='1996-skybox-wizard-chromium'`);
      await tx.execute(sql`UPDATE cards SET front_image_url='https://example.com/later-card-edit.jpg'
        WHERE set_id=(SELECT id FROM card_sets WHERE slug='1996-skybox-wizard-chromium-series-4')
          AND card_number='8'`);
      assert.deepEqual(await run(tx), { imported: false, inserted: 0 });
      const edited = await tx.execute(sql`SELECT thumbnail_image_url FROM main_sets
        WHERE slug='1996-skybox-wizard-chromium'`);
      assert.equal(edited.rows[0].thumbnail_image_url, 'https://example.com/later-admin-edit.jpg');
      const card = await tx.execute(sql`SELECT front_image_url FROM cards
        WHERE set_id=(SELECT id FROM card_sets WHERE slug='1996-skybox-wizard-chromium-series-4')
          AND card_number='8'`);
      assert.equal(card.rows[0].front_image_url, 'https://example.com/later-card-edit.jpg');
      // No marker: scoped identity conflicts must fail, not overwrite the image.
      await tx.execute(sql`DELETE FROM startup_migrations WHERE name=${marker}`);
      await assert.rejects(run(tx), /existing main-set conflict/);
      throw rollback;
    }), error => error === rollback);
  } finally {
    await Promise.all([pool.end(), healthPool.end()]);
  }
});