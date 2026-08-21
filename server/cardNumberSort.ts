import { sql } from "drizzle-orm";

export function cardNumberNaturalSortKey(column: any) {
  return sql<string>`COALESCE((
    SELECT string_agg(
      CASE
        WHEN token[1] ~ '^[0-9]+$'
          THEN chr(1) || lpad(COALESCE(NULLIF(ltrim(token[1], '0'), ''), '0'), 24, '0')
        ELSE chr(2) || lower(token[1])
      END,
      '' ORDER BY token_index
    )
    FROM regexp_matches(
      COALESCE(${column}, ''),
      '([0-9]+|[^0-9]+)',
      'g'
    ) WITH ORDINALITY AS card_number_parts(token, token_index)
  ), '')`;
}