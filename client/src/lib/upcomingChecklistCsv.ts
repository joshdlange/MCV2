import Papa from 'papaparse';
import { validateChecklist } from '../../../shared/upcomingRelease';

export function parseUpcomingChecklist(text: string) {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true, skipEmptyLines: 'greedy',
    transformHeader: header => header.replace(/^\uFEFF/, '').trim().toLowerCase(),
  });
  if (parsed.errors.length) throw new Error(`Invalid CSV: ${parsed.errors[0].message}`);
  const groups = new Map<string, { name: string; isInsert: boolean; cards: { name: string; number: string }[] }>();
  for (const row of parsed.data) {
    const name = row.subset?.trim();
    const flag = row['is insert']?.trim().toUpperCase();
    if (!name || !['TRUE', 'FALSE'].includes(flag)) throw new Error('CSV requires Subset, Card Number, Card Name, Is Insert columns');
    const group = groups.get(name) ?? { name, isInsert: flag === 'TRUE', cards: [] };
    if (group.isInsert !== (flag === 'TRUE')) throw new Error(`Inconsistent insert flag in ${name}`);
    group.cards.push({ number: row['card number']?.trim() ?? '', name: row['card name']?.trim() ?? '' });
    groups.set(name, group);
  }
  return validateChecklist([...groups.values()]);
}