import { sql, type SQL } from 'drizzle-orm';
import { db } from '../db';
import { soldgraphEnabled } from '../pricing/soldgraph-cache';
import { soldgraphDisplayMaxAgeDays } from '../pricing/display-policy';

type Executor = Pick<typeof db, 'execute'>;
export type CollectionValueOptions = {
  order: 'asc' | 'desc'; hideUnder5: boolean; limit: number; offset: number;
  search?: string; setId?: number; favorite?: boolean; isInsert?: boolean;
};

export function parseCollectionValueOptions(query: Record<string, unknown>): CollectionValueOptions {
  const integer = (key: string, fallback: number, min: number, max: number) => {
    if (query[key] === undefined) return fallback;
    if (typeof query[key] !== 'string' || !/^\d+$/.test(query[key] as string)) throw new Error(`Invalid ${key}`);
    const value = Number(query[key]);
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${key}`);
    return value;
  };
  const boolean = (key: string, fallback?: boolean) => {
    if (query[key] === undefined) return fallback;
    if (query[key] !== 'true' && query[key] !== 'false') throw new Error(`Invalid ${key}`);
    return query[key] === 'true';
  };
  if (query.order !== undefined && query.order !== 'asc' && query.order !== 'desc') throw new Error('Invalid order');
  if (query.search !== undefined && (typeof query.search !== 'string' || query.search.length > 200)) throw new Error('Invalid search');
  return {
    order: query.order === 'asc' ? 'asc' : 'desc',
    hideUnder5: boolean('hideUnder5', true)!,
    limit: integer('limit', 25, 1, 25),
    offset: integer('offset', 0, 0, 10_000_000),
    search: (query.search as string | undefined)?.trim(),
    setId: query.setId === undefined ? undefined : integer('setId', 0, 1, 2147483647),
    favorite: boolean('favorite'), isInsert: boolean('isInsert'),
  };
}

// Value visibility is deliberately stricter than friends-only profile access.
export function canViewTopCards(target: { showCollection: boolean; profileVisibility: string | null }, isOwner: boolean) {
  return isOwner || (target.showCollection && (target.profileVisibility || 'public').toLowerCase() === 'public');
}

// Latest cache row wins, even if it has no usable price. Never revive an older
// positive price after a failed/unpriced newer result, or multiply duplicate caches.
function valuedCollection(userId: number) {
  // Match card-detail migrationPrice: eligible sold comps first, otherwise the
  // latest baseline. A failed refresh never erases a usable baseline. This is
  // cache-only SQL, not one provider lookup per owned card.
  const useSold = soldgraphEnabled();
  const soldJoin = useSold ? sql`
      LEFT JOIN soldgraph_price_cache sg ON sg.card_id = c.id
      LEFT JOIN LATERAL (
        SELECT CASE WHEN jsonb_typeof(sg.result->'median') = 'number'
          THEN (sg.result->>'median')::numeric END AS median,
          CASE WHEN jsonb_typeof(sg.result->'usableCount') = 'number'
          THEN (sg.result->>'usableCount')::numeric END AS usable_count
      ) sold ON true` : sql``;
  const preferSold = useSold ? sql`(
    sg.refreshed_at >= now() - ${soldgraphDisplayMaxAgeDays()} * interval '1 day'
    AND sold.median > 0 AND sold.usable_count > 0
  )` : sql`false`;
  const effectivePrice = useSold
    ? sql`CASE WHEN ${preferSold} THEN sold.median ELSE p.avg_price END`
    : sql`p.avg_price`;
  const effectiveDate = useSold
    ? sql`CASE WHEN ${preferSold} THEN sg.refreshed_at ELSE p.last_fetched END`
    : sql`p.last_fetched`;
  return sql`
    valued AS MATERIALIZED (
      SELECT c.id, uc.id AS collection_item_id, uc.quantity, uc.is_favorite,
        c.name, c.card_number, c.set_id, c.is_insert, c.front_image_url,
        c.back_image_url, c.rarity, c.estimated_value,
        cs.name AS set_name, cs.year AS set_year, cs.main_set_id,
        CASE WHEN (${effectivePrice}) > 0 AND (${effectivePrice})::text NOT IN ('NaN', 'Infinity', '-Infinity')
          THEN ${effectivePrice} ELSE NULL END AS market_value,
        ${effectiveDate} AS price_updated_at
      FROM user_collections uc
      JOIN cards c ON c.id = uc.card_id
      JOIN card_sets cs ON cs.id = c.set_id
      LEFT JOIN LATERAL (
        SELECT avg_price, last_fetched FROM card_price_cache
        WHERE card_id = c.id ORDER BY last_fetched DESC, id DESC LIMIT 1
      ) p ON true
      ${soldJoin}
      WHERE uc.user_id = ${userId} AND uc.quantity > 0
        AND c.archived_at IS NULL AND cs.archived_at IS NULL AND cs.is_active = true
    )`;
}

const summarySelect = sql`
  SELECT COALESCE(sum(market_value * quantity), 0)::text AS "totalValue",
    count(*) FILTER (WHERE market_value IS NOT NULL)::int AS "pricedCards",
    count(*) FILTER (WHERE market_value IS NULL)::int AS "unpricedCards",
    COALESCE(sum(quantity) FILTER (WHERE market_value IS NOT NULL), 0)::int AS "pricedCopies",
    max(price_updated_at) FILTER (WHERE market_value IS NOT NULL) AS "pricesUpdatedAt",
    min(price_updated_at) FILTER (WHERE market_value IS NOT NULL) AS "oldestPriceUpdatedAt"
  FROM valued`;

function normalizeSummary(row: any) {
  return {
    totalValue: Number(row.totalValue), pricedCards: Number(row.pricedCards),
    unpricedCards: Number(row.unpricedCards), pricedCopies: Number(row.pricedCopies),
    pricesUpdatedAt: row.pricesUpdatedAt ? new Date(row.pricesUpdatedAt).toISOString() : null,
    oldestPriceUpdatedAt: row.oldestPriceUpdatedAt ? new Date(row.oldestPriceUpdatedAt).toISOString() : null,
  };
}

export async function getCollectionValueSummary(userId: number, executor: Executor = db) {
  const result = await executor.execute(sql`WITH ${valuedCollection(userId)} ${summarySelect}`);
  return normalizeSummary(result.rows[0]);
}

export async function getCollectionValue(userId: number, options: CollectionValueOptions, executor: Executor = db) {
  const filters: SQL[] = [sql`market_value IS NOT NULL`];
  if (options.hideUnder5) filters.push(sql`market_value >= 5`);
  if (options.setId) filters.push(sql`set_id = ${options.setId}`);
  if (options.favorite) filters.push(sql`is_favorite = true`);
  if (options.isInsert !== undefined) filters.push(sql`is_insert = ${options.isInsert}`);
  if (options.search) {
    const search = `%${options.search.replace(/[\\%_]/g, '\\$&')}%`;
    filters.push(sql`(name ILIKE ${search} OR card_number ILIKE ${search} OR set_name ILIKE ${search})`);
  }
  const direction = options.order === 'asc' ? sql`ASC` : sql`DESC`;
  // Summary, count and paginated rows share one statement/snapshot. The limit
  // and sort happen in PostgreSQL, not after loading a user's whole collection.
  const result = await executor.execute(sql`
    WITH ${valuedCollection(userId)},
    summary AS (${summarySelect}),
    filtered AS (SELECT * FROM valued WHERE ${sql.join(filters, sql` AND `)}),
    page AS (
      SELECT * FROM filtered ORDER BY market_value ${direction}, id ASC
      LIMIT ${options.limit} OFFSET ${options.offset}
    )
    SELECT (SELECT row_to_json(summary) FROM summary) AS summary,
      (SELECT count(*)::int FROM filtered) AS total,
      COALESCE((SELECT json_agg(page ORDER BY market_value ${direction}, id ASC) FROM page), '[]'::json) AS cards
  `);
  const row = result.rows[0] as any;
  return {
    cards: row.cards.map((card: any) => ({
      id: card.id, collectionItemId: card.collection_item_id, quantity: card.quantity,
      marketValue: Number(card.market_value),
      lineTotal: Math.round(Number(card.market_value) * card.quantity * 100) / 100,
      priceUpdatedAt: card.price_updated_at, name: card.name, cardNumber: card.card_number,
      setId: card.set_id, isInsert: card.is_insert, frontImageUrl: card.front_image_url,
      backImageUrl: card.back_image_url, rarity: card.rarity, estimatedValue: card.estimated_value,
      set: { id: card.set_id, name: card.set_name, year: card.set_year, mainSetId: card.main_set_id },
    })),
    total: Number(row.total),
    hasMore: options.offset + row.cards.length < Number(row.total),
    summary: normalizeSummary(row.summary),
  };
}
