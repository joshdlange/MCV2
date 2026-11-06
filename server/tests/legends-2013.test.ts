import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { db, pool } from '../db';
import { cards, cardSets, mainSets } from '../../shared/schema';
import { completeLegends2013Tx, legends2013Lists, legends2013ReleaseNote } from '../seeds/completeLegends2013';

test('2013 artist notes exactly preserve all 54 source rows', () => {
  const text = readFileSync('attached_assets/Pasted-No-Artist-s-front-Artist-s-back-Daredevil-L1-Jimmy-Palm_1793989376848.txt','utf8');
  const expected: {cardNumber:string;name:string;description:string}[] = [];
  let name = '';
  for (const line of text.split('\n').map(l=>l.trim())) {
    if (legends2013Lists.some(l=>l.name===line)) name=line;
    else if (/^L\d+\s/.test(line)) {
      const [cardNumber,front,back] = line.split(/\s{2,}/);
      expected.push({cardNumber,name,description:`Artists — Front: ${front}; Back: ${back}`});
    }
  }
  assert.equal(expected.length,54);
  assert.deepEqual(legends2013Lists.flatMap(l=>l.cards),expected);
});

test('2013 Legends combines six existing subsets, preserves earlier years and repeat safety', async () => {
  assert.notEqual(process.env.NODE_ENV,'production');
  assert.ok(process.env.DATABASE_URL && process.env.DATABASE_URL!==process.env.NEON_DATABASE_URL);
  const slug='2013-rittenhouse-legends-of-marvel';
  class Rollback extends Error {}
  await assert.rejects(db.transaction(async tx=>{
    const earlier = async () => (await tx.execute(sql`SELECT to_jsonb(c) row FROM cards c JOIN card_sets s ON s.id=c.set_id
      WHERE s.slug LIKE '2010-2010-rittenhouse-legends-of-marvel-%' OR s.slug LIKE '2011-2011-rittenhouse-legends-of-marvel-%'
      OR s.slug LIKE '2012-2012-rittenhouse-legends-of-marvel-%' ORDER BY c.id`)).rows;
    const holdings = async () => (await tx.execute(sql`SELECT user_id,sum(quantity)::text qty FROM user_collections GROUP BY user_id ORDER BY user_id`)).rows;
    const previous=await earlier(), owned=await holdings(), ids:number[]=[];
    for(const list of legends2013Lists){
      const [set]=await tx.select().from(cardSets).where(eq(cardSets.slug,`2013-${slug}-${list.key}-base`));
      ids.push(set.id);
    }
    console.log(await completeLegends2013Tx(tx));
    const [main]=await tx.select().from(mainSets).where(eq(mainSets.slug,slug));
    assert.equal(main.name,'2013 Rittenhouse Legends of Marvel');
    const sets=await tx.select().from(cardSets).where(eq(cardSets.mainSetId,main.id));
    assert.equal(sets.length,6);
    assert.deepEqual(sets.map(s=>s.id).sort((a,b)=>a-b),ids.sort((a,b)=>a-b));
    for(const list of legends2013Lists){
      const set=sets.find(s=>s.name===list.name)!;
      assert.equal(set.totalCards,9);
      const rows=await tx.select().from(cards).where(eq(cards.setId,set.id)).orderBy(cards.cardNumber);
      assert.deepEqual(rows.map(c=>({cardNumber:c.cardNumber,name:c.name,description:c.description})),list.cards);
      assert.deepEqual(rows.map(c=>c.cardNumber),['L1','L2','L3','L4','L5','L6','L7','L8','L9']);
      assert.ok(rows.every(c=>!c.frontImageUrl && !c.backImageUrl));
      if(['she-hulk','spider-man','war-machine'].includes(list.key)) assert.ok(set.description?.includes(legends2013ReleaseNote));
      const [legacy]=await tx.select().from(mainSets).where(eq(mainSets.slug,`${slug}-${list.key}`));
      assert.equal(legacy.isActive,false);assert.ok(legacy.archivedAt);
    }
    const snapshot=async()=>(await tx.execute(sql`SELECT to_jsonb(c) row FROM cards c WHERE c.set_id IN (${sql.join(ids.map(id=>sql`${id}`),sql`,`)}) ORDER BY c.id`)).rows;
    const before=await snapshot();
    assert.deepEqual(await completeLegends2013Tx(tx),{added:0,reparented:0,notesAdded:0});
    assert.deepEqual(await snapshot(),before);
    for(const set of sets){
      const [after]=await tx.select().from(cardSets).where(eq(cardSets.id,set.id));
      assert.equal(after.description,set.description);
    }
    assert.deepEqual(await earlier(),previous);
    assert.deepEqual(await holdings(),owned);
    throw new Rollback();
  }),e=>e instanceof Rollback);
});
test.after(()=>pool.end());
