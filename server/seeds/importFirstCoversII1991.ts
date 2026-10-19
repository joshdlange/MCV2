import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { mainSets, cardSets, cards, adminAuditLogs } from '../../shared/schema';
import checklist from './data/first-covers-ii-1991.json';

const slug = '1991-comic-images-marvel-comics-first-covers-ii';
const name = '1991 Comic Images Marvel Comics First Covers II';
const marker = 'import_first_covers_ii_1991';
const pack = 'https://res.cloudinary.com/dgu7hjfvn/image/upload/v1792430753/image-admin/catalog-imports/1991-first-covers-ii/pack.png';
const beware = 'https://res.cloudinary.com/dgu7hjfvn/image/upload/v1792430754/image-admin/catalog-imports/1991-first-covers-ii/beware.png';

/** Complete the existing empty legacy set; never create a duplicate or overwrite images. */
export async function importFirstCoversII1991(database: Pick<typeof db, 'transaction'> = db) {
  if (checklist.length !== 100 || checklist.some((c,i)=>c.number!==String(i+1)) ||
      checklist[0].name !== 'Beware') throw new Error('First Covers II checklist mismatch');
  return database.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${marker}))`);
    const done = await tx.execute(sql`SELECT name FROM startup_migrations WHERE name=${marker}`);
    if (done.rows.length) return { imported: false };
    const [main] = await tx.select().from(mainSets).where(eq(mainSets.slug,slug));
    if (!main || main.name !== name || !main.isActive || main.archivedAt ||
        (main.thumbnailImageUrl && main.thumbnailImageUrl !== pack))
      throw new Error('First Covers II main-set identity/image conflict');
    const children = await tx.select().from(cardSets).where(eq(cardSets.mainSetId,main.id));
    const set = children[0];
    if (children.length !== 1 || !set.isActive || set.archivedAt || set.year !== 1991 ||
        set.isInsertSubset || !['Base',`${name} - ${name}`].includes(set.name) ||
        (set.imageUrl && set.imageUrl !== beware))
      throw new Error('First Covers II base subset identity/image conflict');
    const existing = await tx.select().from(cards).where(eq(cards.setId,set.id));
    const seen = new Set<string>();
    for (const c of existing) {
      const expected = checklist.find(r=>r.number===c.cardNumber);
      if (!expected || seen.has(c.cardNumber) || c.name!==expected.name || c.isInsert || c.archivedAt ||
          (c.description && c.description!==expected.details))
        throw new Error(`First Covers II card conflict: ${c.cardNumber}`);
      seen.add(c.cardNumber);
    }
    const missing = checklist.filter(c=>!seen.has(c.number));
    if (missing.length) await tx.insert(cards).values(missing.map(c=>({
      setId:set.id,cardNumber:c.number,name:c.name,description:c.details || null,
      rarity:'Common',isInsert:false,
    })));
    const [first] = await tx.select().from(cards).where(sql`${cards.setId}=${set.id} AND ${cards.cardNumber}='1'`);
    if (!first || (first.frontImageUrl && first.frontImageUrl!==beware))
      throw new Error('First Covers II Beware image conflict');
    if (!first.frontImageUrl) {
      const updated = await tx.update(cards).set({frontImageUrl:beware})
        .where(sql`${cards.id}=${first.id} AND ${cards.frontImageUrl} IS NULL`).returning();
      if (updated.length !== 1) throw new Error('First Covers II image changed during import');
      await tx.insert(adminAuditLogs).values({
        actionType:'card_image_update',entityType:'card',entityId:first.id,entityName:'Beware #1',
        notes:JSON.stringify({source:marker,attachment:'image_1792430352208.png',
          sides:['front'],oldFrontImageUrl:null,newFrontImageUrl:beware}),
      });
    }
    await tx.update(mainSets).set({thumbnailImageUrl:pack}).where(eq(mainSets.id,main.id));
    await tx.update(cardSets).set({name:'Base',imageUrl:beware,totalCards:100,isInsertSubset:false})
      .where(eq(cardSets.id,set.id));
    const final = await tx.select().from(cards).where(eq(cards.setId,set.id));
    if (final.length!==100 || final.some(c=>c.isInsert || c.archivedAt))
      throw new Error('First Covers II final validation failed');
    await tx.insert(adminAuditLogs).values({
      actionType:marker,entityType:'main_set',entityId:main.id,entityName:name,
      notes:JSON.stringify({source:'1st_Covers_Trading_Cards_II_Comic_Images___Marvel_Comics_-_199_1792430599604.csv',
        subsets:1,cards:100,inserted:missing.length}),
    });
    await tx.execute(sql`INSERT INTO startup_migrations(name) VALUES(${marker})`);
    return {imported:true,inserted:missing.length,mainSetId:main.id,setId:set.id};
  });
}
