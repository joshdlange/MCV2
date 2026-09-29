import { pool } from '../db';
import { ReviewError } from './scanReview';

const statusSql = `(c.archived_at IS NOT NULL OR s.archived_at IS NOT NULL OR NOT s.is_active
  OR (m.id IS NOT NULL AND (m.archived_at IS NOT NULL OR NOT m.is_active)))`;
const fromSql = `FROM cards c JOIN card_sets s ON s.id=c.set_id
  LEFT JOIN main_sets m ON m.id=s.main_set_id`;
export async function auditReviewEquivalence(ids: number[]) {
  const collected = new Map<number, { activeIds: number[]; equivalentIds: number[] }>();
  if (!ids.length) return new Map<number, { canonicalActiveId: number | null; equivalentIds: number[] }>();
  const { rows } = await pool.query(`SELECT src.id AS source_id, peer.id AS peer_id,
    (peer.archived_at IS NOT NULL OR ps.archived_at IS NOT NULL OR NOT ps.is_active OR
      (pm.id IS NOT NULL AND (pm.archived_at IS NOT NULL OR NOT pm.is_active))) AS peer_archived
    FROM cards src JOIN card_sets s ON s.id=src.set_id LEFT JOIN main_sets m ON m.id=s.main_set_id
    JOIN cards peer ON peer.id<>src.id AND lower(trim(peer.name))=lower(trim(src.name))
      AND lower(trim(peer.card_number))=lower(trim(src.card_number))
      AND COALESCE(lower(trim(peer.variation)),'')=COALESCE(lower(trim(src.variation)),'')
    JOIN card_sets ps ON ps.id=peer.set_id AND ps.year=s.year
      AND lower(trim(ps.name))=lower(trim(s.name))
    LEFT JOIN main_sets pm ON pm.id=ps.main_set_id
    WHERE src.id=ANY($1::int[]) AND
      lower(trim(COALESCE(m.name,s.name)))=lower(trim(COALESCE(pm.name,ps.name)))
    ORDER BY src.id,peer.id`, [ids]);
  for (const row of rows) {
    const entry = collected.get(row.source_id) ?? { activeIds: [], equivalentIds: [] };
    entry.equivalentIds.push(row.peer_id);
    if (!row.peer_archived) entry.activeIds.push(row.peer_id);
    collected.set(row.source_id, entry);
  }
  return new Map([...collected].map(([id, entry]) => [id, {
    canonicalActiveId: entry.activeIds.length === 1 ? entry.activeIds[0] : null,
    equivalentIds: entry.equivalentIds,
  }]));
}
export type CatalogSearch = {
  q?: unknown; year?: unknown; mainSet?: unknown; subset?: unknown; cardNumber?: unknown;
  status?: unknown; page?: unknown; limit?: unknown;
};
function short(value: unknown, name: string) {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || value.length > 100) throw new ReviewError(`${name} must be at most 100 characters`, 400);
  return value.trim();
}
export async function searchReviewCatalog(query: CatalogSearch) {
  const q = short(query.q, 'q');
  const mainSet = short(query.mainSet, 'mainSet');
  const subset = short(query.subset, 'subset');
  const cardNumber = short(query.cardNumber, 'cardNumber').replace(/^#/, '');
  const yearString = short(query.year, 'year');
  if (yearString && !/^\d{4}$/.test(yearString)) throw new ReviewError('year must be four digits', 400);
  const status = query.status ?? 'active';
  if (!['active', 'archived', 'all'].includes(status as string)) throw new ReviewError('Invalid catalog status', 400);
  const page = Number(query.page ?? 1), limit = Number(query.limit ?? 30);
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new ReviewError('page must be 1–10000 and limit must be 1–100', 400);
  const tokens = q.replace(/#/g, ' ').split(/\s+/).filter(Boolean);
  if (tokens.length > 15) throw new ReviewError('Too many search terms', 400);
  const years = tokens.filter(token => /^(19|20)\d{2}$/.test(token)).map(Number);
  const numbers = tokens.filter(token => /^\d{1,3}$/.test(token));
  const terms = tokens.filter(token => !/^(19|20)\d{2}$/.test(token) && !/^\d{1,3}$/.test(token));
  const params = [terms, years, numbers, yearString ? Number(yearString) : null,
    mainSet, subset, cardNumber, status] as unknown[];
  const where = `WHERE
    NOT EXISTS (SELECT 1 FROM unnest($1::text[]) token WHERE
      strpos(lower(concat_ws(' ', c.name, s.name, m.name, c.card_number)),lower(token))=0)
    AND NOT EXISTS (SELECT 1 FROM unnest($2::int[]) y WHERE s.year<>y)
    AND NOT EXISTS (SELECT 1 FROM unnest($3::text[]) n WHERE
      lower(regexp_replace(c.card_number,'[^a-zA-Z0-9]','','g')) <> lower(n)
      AND c.id::text<>n)
    AND ($4::int IS NULL OR s.year=$4)
    AND ($5::text='' OR strpos(lower(COALESCE(m.name,s.name)),lower($5))>0)
    AND ($6::text='' OR strpos(lower(s.name),lower($6))>0)
    AND ($7::text='' OR lower(regexp_replace(c.card_number,'[^a-zA-Z0-9]','','g'))=
      lower(regexp_replace($7::text,'[^a-zA-Z0-9]','','g')))
    AND ($8::text='all' OR (${statusSql})=($8::text='archived'))`;
  const countQuery = await pool.query(`SELECT count(*)::int AS total ${fromSql} ${where}`, params);
  const total = countQuery.rows[0].total as number;
  const { rows } = await pool.query(`SELECT c.id AS "cardId", c.name, c.card_number AS "cardNumber",
    s.year, s.id AS "subsetId", s.name AS "subsetName", m.id AS "mainSetId",
    COALESCE(m.name,s.name) AS "mainSetName", c.front_image_url AS "frontImageUrl",
    ${statusSql} AS "isArchived",
    (CASE WHEN lower(c.name)=lower($9::text) THEN 120 ELSE 0 END
      + CASE WHEN strpos(lower(c.name),lower($9::text))>0 AND $9::text<>'' THEN 35 ELSE 0 END
      + (SELECT count(*)::int * 20 FROM unnest($1::text[]) t WHERE strpos(lower(c.name),lower(t))>0)
      + (SELECT count(*)::int * 8 FROM unnest($1::text[]) t WHERE strpos(lower(COALESCE(m.name,s.name)),lower(t))>0)
      + (SELECT count(*)::int * 5 FROM unnest($1::text[]) t WHERE strpos(lower(s.name),lower(t))>0)
      + CASE WHEN array_length($3::text[],1)>0 THEN 25 ELSE 0 END
      + CASE WHEN array_length($2::int[],1)>0 THEN 15 ELSE 0 END) AS relevance
    ${fromSql} ${where}
    ORDER BY relevance DESC, "isArchived" ASC, s.year DESC, lower(c.name), c.id
    LIMIT $10 OFFSET $11`, [...params, q, limit, (page - 1) * limit]);
  const ids = rows.map(row => row.cardId);
  const peers = ids.length ? (await pool.query(`SELECT src.id AS source_id, peer.id AS peer_id,
      (peer.archived_at IS NOT NULL OR ps.archived_at IS NOT NULL OR NOT ps.is_active
        OR (pm.id IS NOT NULL AND (pm.archived_at IS NOT NULL OR NOT pm.is_active))) AS peer_archived,
      (lower(trim(COALESCE(m.name,s.name)))=lower(trim(COALESCE(pm.name,ps.name)))
        AND lower(trim(s.name))=lower(trim(ps.name))
        AND COALESCE(lower(trim(peer.variation)),'')=COALESCE(lower(trim(src.variation)),'')) AS exact_set
    FROM cards src JOIN card_sets s ON s.id=src.set_id LEFT JOIN main_sets m ON m.id=s.main_set_id
    JOIN cards peer ON peer.id<>src.id AND lower(trim(peer.name))=lower(trim(src.name))
      AND lower(trim(peer.card_number))=lower(trim(src.card_number))
    JOIN card_sets ps ON ps.id=peer.set_id AND ps.year=s.year
    LEFT JOIN main_sets pm ON pm.id=ps.main_set_id
    WHERE src.id=ANY($1::int[])
      AND ((lower(trim(COALESCE(m.name,s.name)))=lower(trim(COALESCE(pm.name,ps.name)))
        AND lower(trim(s.name))=lower(trim(ps.name)))
        OR (src.front_image_url IS NOT NULL AND src.front_image_url=peer.front_image_url))
    ORDER BY src.id,peer.id LIMIT 1000`, [ids])).rows : [];
  const byId = new Map<number, typeof peers>();
  for (const peer of peers) {
    const group = byId.get(peer.source_id) ?? [];
    group.push(peer);
    byId.set(peer.source_id, group);
  }
  const cards = rows.map(row => {
    const candidates = byId.get(row.cardId) ?? [];
    const verified = candidates.filter(other => other.exact_set);
    const active = verified.filter(other => !other.peer_archived).map(other => other.peer_id);
    return {
      cardId: row.cardId, name: row.name, cardNumber: row.cardNumber, year: row.year,
      subsetId: row.subsetId, subsetName: row.subsetName, mainSetId: row.mainSetId,
      mainSetName: row.mainSetName, imageUrl: row.frontImageUrl
        ? `/api/admin/scan-review/image/card/${row.cardId}` : null,
      isArchived: row.isArchived, status: row.isArchived ? 'archived' : 'active',
      relevance: row.relevance,
      canonicalActiveId: row.isArchived ? (active.length === 1 ? active[0] : null) : row.cardId,
      equivalentIds: verified.map(peer => peer.peer_id),
      possibleMatches: candidates.filter(other => !other.exact_set).map(other => other.peer_id),
      equivalenceBasis: verified.length ? 'exact-name-year-main-set-subset-card-number-variation' : null,
    };
  });
  return { cards, total, page, limit, from: rows.length ? (page - 1) * limit + 1 : 0,
    to: rows.length ? Math.min(page * limit, total) : 0, hasMore: page * limit < total };
}