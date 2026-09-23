import { db } from '../db';
import { upcomingSets } from '../../shared/schema';
import { eq, sql } from 'drizzle-orm';
import { validateUpcomingAdminWrite } from '../../shared/upcomingAdmin';

export async function saveUpcomingSet(input: unknown, id?: number) {
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('upcoming-candidate-approval'))`);
    const [existing] = id === undefined ? [] : await tx.select().from(upcomingSets).where(eq(upcomingSets.id, id)).for('update');
    if (id !== undefined && !existing) return undefined;
    if (existing?.publishedMainSetId) throw new Error('Already published; edit the catalog instead');
    const data = validateUpcomingAdminWrite(input, existing);
    const duplicate = await tx.select({ id: upcomingSets.id }).from(upcomingSets).where(sql`
      (${upcomingSets.id} != ${id ?? -1}) AND (
        lower(trim(${upcomingSets.setName})) = lower(trim(${data.setName}))
        OR ${upcomingSets.sourceUrl} = ${data.sourceUrl}
      )`);
    if (duplicate.length) throw new Error('This product already has an upcoming entry (name or source URL)');
    if (id !== undefined) {
      const [updated] = await tx.update(upcomingSets).set({ ...data, releaseError: null, updatedAt: new Date() })
        .where(eq(upcomingSets.id, id)).returning();
      return updated;
    }
    const [created] = await tx.insert(upcomingSets).values(data).returning();
    return created;
  });
}