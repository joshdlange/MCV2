import { sql } from "drizzle-orm";
import { assertDevScanTelemetryDatabase } from "./devScanTelemetry";

// Shared eligibility for every DEV picker step and global search. Counts come
// from actual live cards, never the (occasionally stale) total_cards metadata.
export const scanEligible = sql`
 SELECT c.*, cs.name AS set_name, cs.year AS set_year, cs.main_set_id,
 coalesce(ms.name,cs.name) AS parent_name, cs.is_insert_subset,
 ((c.variation IS NULL OR lower(c.variation) IN ('','base'))
 AND (cs.main_set_id IS NULL OR lower(cs.name) IN
 (lower(ms.name),lower(ms.name)||' - base',lower(ms.name)||' - base set',
 lower(ms.name)||' - '||lower(ms.name)))) AS is_base
 FROM cards c JOIN card_sets cs ON cs.id=c.set_id
 LEFT JOIN main_sets ms ON ms.id=cs.main_set_id
 WHERE c.archived_at IS NULL AND cs.archived_at IS NULL AND cs.is_active
 AND (cs.main_set_id IS NULL OR (ms.is_active AND ms.archived_at IS NULL))
 AND cs.year <= extract(year from timezone('America/Chicago',now()))
 AND NOT EXISTS (SELECT 1 FROM upcoming_sets u
   WHERE (u.published_main_set_id=cs.main_set_id OR lower(u.set_name)=lower(coalesce(ms.name,cs.name)))
   AND u.status <> 'released')
`;

export function scanTokens(query: string) {
  return query.toLowerCase().replace(/#/g, "").match(/[\p{L}\p{N}]+/gu)?.slice(0, 16) ?? [];
}
export function scanTokenPredicate(query: string, cardOnly = false) {
  const fields = cardOnly ? sql`concat(name,' ',card_number)` : sql`concat(name,' ',card_number,' ',set_name,' ',parent_name,' ',set_year)`;
  const tokens = scanTokens(query);
  return tokens.length ? sql.join(tokens.map(token => /^\d+$/.test(token)
    ? (cardOnly ? sql`lower(card_number)=${token}` : sql`(lower(card_number)=${token} OR set_year::text=${token})`)
    : sql`regexp_replace(lower(${fields}),'[^a-z0-9]','','g') LIKE ${`%${token}%`}`), sql` AND `) : sql`true`;
}

export async function searchDevScanCatalog(query: string) {
  assertDevScanTelemetryDatabase();
  const { db } = await import("../db");
  if (!scanTokens(query).length) return [];
  const result = await db.execute(sql`
    WITH eligible AS (${scanEligible})
    SELECT id AS "cardId",name,card_number AS "cardNumber",front_image_url AS "imageUrl",
    set_name AS "setName",set_year AS year,set_id AS "setId",main_set_id AS "mainSetId",
    parent_name AS "mainSetName",is_base AS "isBase",
    CASE WHEN is_base THEN 'Base' ELSE coalesce(variation,
      CASE WHEN set_name LIKE parent_name||' - %' THEN substring(set_name FROM length(parent_name)+4)
      ELSE set_name END) END AS "subsetName"
    FROM eligible WHERE ${scanTokenPredicate(query)}
    ORDER BY is_base DESC, set_year DESC,parent_name,card_number,id LIMIT 150`);
  return result.rows;
}

export async function browseDevScanCatalog(step: string, args: {year?: number; mainSetId?: number; setId?: number; search?: string}) {
  assertDevScanTelemetryDatabase();
  const { db } = await import("../db");
  const base = sql`WITH eligible AS (${scanEligible})`;
  if (step === "years") return (await db.execute(sql`${base} SELECT DISTINCT set_year AS year FROM eligible ORDER BY year DESC`)).rows.map(row => row.year);
  if (step === "sets") return (await db.execute(sql`${base}
    SELECT coalesce(main_set_id,set_id) AS id,parent_name AS name,
    CASE WHEN main_set_id IS NULL THEN 'card_set' ELSE 'main_set' END AS type,
    count(distinct set_id)::int AS subset_count,count(*)::int AS "totalCards",count(*)::int AS card_count
    FROM eligible WHERE set_year=${args.year}
    GROUP BY main_set_id,coalesce(main_set_id,set_id),parent_name ORDER BY name,id`)).rows;
  if (step === "subsets") return (await db.execute(sql`${base}
    SELECT set_id AS id,set_name AS name,count(*)::int AS "totalCards",is_insert_subset AS "isInsertSubset"
    FROM eligible WHERE main_set_id=${args.mainSetId} AND set_year=${args.year}
    GROUP BY set_id,set_name,is_insert_subset ORDER BY name,id`)).rows;
  if (step === "cards") return (await db.execute(sql`${base}
    SELECT id,name,card_number AS "cardNumber",front_image_url AS "frontImageUrl",variation
    FROM eligible WHERE set_id=${args.setId} AND ${scanTokenPredicate(args.search ?? "",true)}
    ORDER BY length(card_number),card_number,id`)).rows;
  throw new Error("Unknown browse step");
}