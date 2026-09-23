import { z } from 'zod';
import { centralReleaseDate, validateChecklist } from './upcomingRelease';

const sourceUrl = z.string().trim().min(1).url().refine(value =>
  /^(https?:\/\/|internal:\/\/)/.test(value), 'Source URL must use http, https, or internal');
const optionalText = z.string().trim().nullable().optional();
const fields = z.object({
  setName: z.string().trim().min(1).refine(value => /\b(19|20)\d{2}\b/.test(value), 'Set name must include its year'),
  sourceUrl,
  manufacturer: optionalText, productLine: optionalText, format: optionalText,
  configuration: optionalText, keyHighlights: optionalText,
  thumbnailUrl: z.string().url().regex(/^https?:\/\//).nullable().optional(),
  checklistUrl: z.string().url().regex(/^https?:\/\//).nullable().optional(),
  msrp: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional(),
  releaseDateEstimated: z.date().nullable(),
  dateConfidence: z.enum(['estimated', 'confirmed']).nullable(),
  status: z.enum(['upcoming', 'delayed']),
  isActive: z.boolean(),
  stagedChecklist: z.unknown().nullable().optional(),
});

/** Validate API scalars first, then the complete merged database state. */
export function validateUpcomingAdminWrite(input: unknown, existing?: Record<string, unknown>) {
  const raw = z.record(z.unknown()).parse(input);
  const prepared = { ...raw };
  if (prepared.setName === undefined && prepared.name !== undefined) prepared.setName = prepared.name;
  if (prepared.releaseDateEstimated !== undefined && prepared.releaseDateEstimated !== null) {
    prepared.releaseDateEstimated = centralReleaseDate(z.string().parse(prepared.releaseDateEstimated));
  }
  const patch = fields.partial().parse(prepared);
  if ('stagedChecklist' in patch && patch.stagedChecklist !== null) patch.stagedChecklist = validateChecklist(patch.stagedChecklist);
  const merged = fields.parse({
    status: 'upcoming', isActive: true, releaseDateEstimated: null, dateConfidence: 'estimated',
    ...existing, ...patch,
  });
  if (merged.stagedChecklist != null) merged.stagedChecklist = validateChecklist(merged.stagedChecklist);
  if (merged.dateConfidence === 'confirmed' && !merged.releaseDateEstimated) throw new Error('A confirmed release requires a date');
  return merged;
}

/** Public payloads never contain staged cards or internal failure/source details. */
export function publicUpcomingSet<T extends { stagedChecklist?: unknown; releaseError?: unknown; sourceUrl?: unknown }>(set: T) {
  const { stagedChecklist, releaseError, sourceUrl, ...rest } = set;
  return { ...rest, checklistReady: !!stagedChecklist };
}