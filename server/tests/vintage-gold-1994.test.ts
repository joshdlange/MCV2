import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { db, pool } from '../db';
import { cards, cardSets } from '../../shared/schema';
import { vintageChecklists } from '../seeds/data/ownerVintageChecklists';
import { completeVintageAndGold1994Tx, masterpieces94 } from '../seeds/completeVintageAndGold1994';

test('1967 captions and characters exactly preserve owner attachment', () => {
  const text = readFileSync('attached_assets/Pasted-No-Character-Caption-1-The-Human-Torch-I-must-get-that-_1793980299039.txt', 'utf8');
  const expected = text.split('\n').map(line => line.match(/^\s*(\d+)\s+(.+?) - (.+)$/)).filter(Boolean)
    .map(m => ({ cardNumber: m![1], name: m![2], description: m![3] }));
  assert.equal(expected.length, 55);
  assert.deepEqual(vintageChecklists[1].cards, expected);
  assert.deepEqual(vintageChecklists.map(c => c.cards.length), [8,55,42,40]);
});

test('1978 checklist preserves 01–40, A/B notes, character subtitles and special cards', () => {
  const checklist = vintageChecklists[3].cards;
  assert.deepEqual(checklist.map(c => c.cardNumber), Array.from({length:40},(_,i)=>String(i+1).padStart(2,'0')));
  for (let i = 0; i < 38; i += 2) {
    assert.equal(checklist[i].name, checklist[i+1].name);
    assert.equal(checklist[i].description, 'Card A');
    assert.equal(checklist[i+1].description, 'Card B');
  }
  assert.equal(checklist[10].name, 'Sue Richards (Invisible Girl)');
  assert.equal(checklist[20].name, 'Doctor Strange (Master of the Mystic Arts)');
  assert.equal(checklist[22].name, 'Daredevil (The Man Without Fear)');
  assert.deepEqual(checklist.slice(38), [
    {cardNumber:'39',name:'Doctor Doom',description:'Single card / The "Old Maid" equivalent'},
    {cardNumber:'40',name:'Two-Sided Instruction / Directions Card',description:null},
  ]);
});

test('checklists complete, preserve existing metadata/holdings and repeat safely', async () => {
  assert.notEqual(process.env.NODE_ENV, 'production');
  assert.ok(process.env.DATABASE_URL && process.env.DATABASE_URL !== process.env.NEON_DATABASE_URL);
  class Rollback extends Error {}
  await assert.rejects(db.transaction(async tx => {
    const snapshot = async () => (await tx.execute(sql`SELECT c.* FROM cards c JOIN card_sets s ON s.id=c.set_id
      WHERE s.slug IN (${`1994-${masterpieces94}-base`},${`1994-${masterpieces94}-gold-foil-signature`}) ORDER BY c.id`)).rows;
    const holdings = async () => (await tx.execute(sql`SELECT user_id,sum(quantity)::text qty FROM user_collections GROUP BY user_id ORDER BY user_id`)).rows;
    const old = await snapshot(), owned = await holdings();
    console.log(await completeVintageAndGold1994Tx(tx));
    const after = await snapshot();
    for (const original of old) {
      const actual = after.find(c => c.id === original.id)!;
      assert.ok(actual);
      assert.equal(String(actual.name).toLowerCase(), String(original.name).toLowerCase());
      // PostgreSQL's update trigger advances the audit timestamp on name edits.
      assert.deepEqual({ ...actual, name: original.name, updated_at: original.updated_at }, original);
    }
    assert.deepEqual(await holdings(), owned);
    const mismatch = await tx.execute(sql`SELECT b.id FROM cards b JOIN card_sets bs ON bs.id=b.set_id
      JOIN card_sets gs ON gs.slug=${`1994-${masterpieces94}-gold-foil-signature`}
      LEFT JOIN cards g ON g.set_id=gs.id AND g.card_number=b.card_number AND g.archived_at IS NULL
      WHERE bs.slug=${`1994-${masterpieces94}-base`} AND b.archived_at IS NULL AND b.name IS DISTINCT FROM g.name`);
    assert.equal(mismatch.rows.length, 0);
    for (const checklist of vintageChecklists) {
      const [set] = await tx.select().from(cardSets).where(eq(cardSets.slug, `${checklist.year}-${checklist.parent}-base`));
      assert.equal(set.name, 'Base');
      assert.equal(set.totalCards, checklist.cards.length);
      const rows = (await tx.select().from(cards).where(eq(cards.setId,set.id))).filter(c=>!c.archivedAt)
        .sort((a,b)=>Number(a.cardNumber)-Number(b.cardNumber));
      assert.deepEqual(rows.map(c=>({cardNumber:c.cardNumber,name:c.name,description:c.description})),checklist.cards);
      assert.ok(rows.every(c=>!c.isInsert));
    }
    assert.deepEqual(await completeVintageAndGold1994Tx(tx), {goldAdded:0,vintageAdded:0,namesAligned:0,captionsAdded:0});
    throw new Rollback();
  }), e => e instanceof Rollback);
});
test.after(()=>pool.end());
