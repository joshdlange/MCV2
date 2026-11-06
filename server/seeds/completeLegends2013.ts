import { eq } from 'drizzle-orm';
import { db } from '../db';
import { cardSets } from '../../shared/schema';
import { completeLegendsYearTx } from './completeLegends2010';
import lists from './data/legends-2013.json';

export const legends2013Lists = lists;
export const legends2013ReleaseNote = 'Source checklist: Series 6: January 2014. Grouped under 2013 Rittenhouse Legends of Marvel per owner.';
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function completeLegends2013Tx(tx: Tx) {
  const result = await completeLegendsYearTx(tx, 2013, legends2013Lists);
  for (const key of ['she-hulk', 'spider-man', 'war-machine']) {
    const [set] = await tx.select().from(cardSets).where(eq(cardSets.slug, `2013-2013-rittenhouse-legends-of-marvel-${key}-base`));
    // Keep source release information without reclassifying the owner's requested grouping.
    if (!set.description?.includes(legends2013ReleaseNote)) {
      await tx.update(cardSets).set({
        description: [set.description, legends2013ReleaseNote].filter(Boolean).join('\n'),
      }).where(eq(cardSets.id, set.id));
    }
  }
  return result;
}
export const completeLegends2013 = () => db.transaction(completeLegends2013Tx);
