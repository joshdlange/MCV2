import { z } from 'zod';

export const stagedChecklistSchema = z.array(z.object({
  name: z.string().trim().min(1),
  isInsert: z.boolean(),
  cards: z.array(z.object({
    number: z.string().trim().min(1),
    name: z.string().trim().min(1),
  })).min(1),
})).min(1);
export const catalogSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function validateChecklist(input: unknown) {
  const data = stagedChecklistSchema.parse(input);
  const slugs = data.map(s => catalogSlug(s.name));
  if (slugs.some(s => !s) || new Set(slugs).size !== slugs.length) throw new Error('Subset names produce duplicate or empty slugs');
  for (const s of data) {
    if (new Set(s.cards.map(c => c.number)).size !== s.cards.length) throw new Error(`Duplicate card number in ${s.name}`);
  }
  return data;
}

/** Date-only admin inputs mean midnight America/Chicago, including DST. */
export function centralReleaseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Release date must be YYYY-MM-DD');
  const utc = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(utc.getTime()) || utc.toISOString().slice(0, 10) !== value) throw new Error('Invalid release date');
  const probe = new Date(`${value}T06:00:00Z`);
  const offset = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', timeZoneName: 'shortOffset' })
    .formatToParts(probe).find(p => p.type === 'timeZoneName')!.value;
  return new Date(utc.getTime() + (offset === 'GMT-5' ? 5 : 6) * 3600000);
}

export function isDueForPublication(set: {
  status: string; isActive: boolean; dateConfidence: string | null;
  releaseDateEstimated: Date | null; stagedChecklist: unknown; publishedMainSetId: number | null;
}, now = new Date()) {
  return set.isActive && set.status === 'upcoming' && set.dateConfidence === 'confirmed'
    && !!set.stagedChecklist && !set.publishedMainSetId
    && !!set.releaseDateEstimated && set.releaseDateEstimated.getTime() <= now.getTime();
}