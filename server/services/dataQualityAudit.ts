/**
 * Data Quality Audit & Remediation for duplicate card numbers.
 *
 * READ-ONLY analysis by default. All remediation endpoints default to dry-run
 * and require explicit confirm=true to write. Duplicate merges soft-archive
 * (cards.archived_at) — never hard delete. Every applied change writes an
 * admin_audit_logs row with old/new values for rollback reference.
 */
import { db } from "../db";
import { sql, eq, and, inArray } from "drizzle-orm";
import {
  cards,
  cardSets,
  userCollections,
  userWishlists,
  pcBinderCards,
  pendingCardImages,
  listings,
  xpEvents,
  cardPriceCache,
  adminAuditLogs,
} from "../../shared/schema";

// ---------- Types ----------

export type DupClassification =
  | "OK_PARALLEL"
  | "NEEDS_CARD_NUMBER_FIX"
  | "NEEDS_SUBSET_SPLIT"
  | "TRUE_DUPLICATE_RECORD"
  | "NEEDS_MANUAL_REVIEW"
  | "KNOWN_EXCEPTION";

export interface DupCard {
  cardId: number;
  cardName: string;
  cardNumber: string;
  variation: string | null;
  frontImageUrl: string | null;
  proposedCardNumber?: string;
  normalizedName: string;
}

export interface ProposedFix {
  cardId: number;
  mainSet: string;
  subset: string;
  currentCardNumber: string;
  currentCardName: string;
  proposedCardNumber?: string;
  proposedAction: "update_card_number" | "merge_into_survivor" | "manual_review";
  survivorCardId?: number;
  confidence: "high" | "medium" | "low";
  reason: string;
  riskLevel: "low" | "medium" | "high";
}

export interface DupGroup {
  groupKey: string; // setId::cardNumber
  mainSet: string;
  subset: string;
  setId: number;
  mainSetId: number | null;
  cardNumber: string;
  copies: number;
  classification: DupClassification;
  confidence: "high" | "medium" | "low";
  reason: string;
  riskLevel: "low" | "medium" | "high";
  cards: DupCard[];
  proposedFixes: ProposedFix[];
}

export interface DupSummary {
  totalGroups: number;
  totalCards: number;
  byClassification: Record<DupClassification, number>;
}

// ---------- Normalization helpers ----------

export function normalizeCardNumber(n: string): string {
  return (n || "").trim().toUpperCase().replace(/^#/, "").replace(/\s+/g, "");
}

/** Strip bracketed/parenthesized variant suffixes + trailing #code, lowercase. */
export function normalizeCardName(name: string): string {
  return (name || "")
    .toLowerCase()
    .replace(/\s*[\[(][^\])]*[\])]\s*/g, " ") // [Gold], (Refractor), etc.
    .replace(/\s*#\s*[a-z0-9][a-z0-9._\/-]*\s*$/i, " ") // trailing #CODE
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Extract a trailing card code like "Aaron Stanford as Pyro #AA-AST" -> "AA-AST". */
export function extractTrailingCode(name: string): string | null {
  const m = (name || "").match(/#\s*([A-Za-z0-9][A-Za-z0-9._\/-]{1,19})\s*$/);
  if (!m) return null;
  const code = m[1].trim();
  // Reject pure short numbers equal-ish to nothing useful (e.g. "#1" is often print run "1/1" noise)
  if (/^\d{1,2}$/.test(code)) return null;
  return code;
}

const KNOWN_EXCEPTION_SUBSET = /sketch|printing plate|printing-plate|printing_plate/i;

// ---------- Analysis (READ ONLY) ----------

interface RawRow {
  card_id: number;
  set_id: number;
  card_number: string;
  card_name: string;
  variation: string | null;
  front_image_url: string | null;
  subset: string;
  main_set: string | null;
  main_set_id: number | null;
}

export async function analyzeDuplicateGroups(): Promise<{ summary: DupSummary; groups: DupGroup[] }> {
  const result = await db.execute(sql`
    SELECT c.id AS card_id, c.set_id, c.card_number, c.name AS card_name,
           c.variation, c.front_image_url,
           cs.name AS subset, ms.name AS main_set, ms.id AS main_set_id
    FROM cards c
    JOIN card_sets cs ON cs.id = c.set_id
    LEFT JOIN main_sets ms ON ms.id = cs.main_set_id
    WHERE c.archived_at IS NULL
      AND (c.set_id, c.card_number) IN (
        SELECT set_id, card_number FROM cards
        WHERE archived_at IS NULL
        GROUP BY set_id, card_number
        HAVING COUNT(*) > 1
      )
    ORDER BY ms.name NULLS LAST, cs.name, c.card_number, c.id
  `);
  const rows = (result.rows as unknown as RawRow[]) || [];

  // Group by setId::cardNumber
  const map = new Map<string, RawRow[]>();
  for (const r of rows) {
    const key = `${r.set_id}::${r.card_number}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }

  const groups: DupGroup[] = [];
  for (const [key, groupRows] of map) {
    groups.push(classifyGroup(key, groupRows));
  }

  // Sort: highest risk & biggest groups first
  const riskOrder = { high: 0, medium: 1, low: 2 } as const;
  groups.sort((a, b) => riskOrder[a.riskLevel] - riskOrder[b.riskLevel] || b.copies - a.copies);

  const byClassification = {
    OK_PARALLEL: 0,
    NEEDS_CARD_NUMBER_FIX: 0,
    NEEDS_SUBSET_SPLIT: 0,
    TRUE_DUPLICATE_RECORD: 0,
    NEEDS_MANUAL_REVIEW: 0,
    KNOWN_EXCEPTION: 0,
  } as Record<DupClassification, number>;
  let totalCards = 0;
  for (const g of groups) {
    byClassification[g.classification]++;
    totalCards += g.copies;
  }

  return {
    summary: { totalGroups: groups.length, totalCards, byClassification },
    groups,
  };
}

function classifyGroup(key: string, rows: RawRow[]): DupGroup {
  const first = rows[0];
  const cardsOut: DupCard[] = rows.map((r) => ({
    cardId: r.card_id,
    cardName: r.card_name,
    cardNumber: r.card_number,
    variation: r.variation,
    frontImageUrl: r.front_image_url,
    normalizedName: normalizeCardName(r.card_name),
  }));

  const base = {
    groupKey: key,
    mainSet: first.main_set || "(unassigned)",
    subset: first.subset,
    setId: first.set_id,
    mainSetId: first.main_set_id ?? null,
    cardNumber: first.card_number,
    copies: rows.length,
    cards: cardsOut,
  };

  const mkFix = (
    c: DupCard,
    fix: Partial<ProposedFix> & Pick<ProposedFix, "proposedAction" | "confidence" | "reason" | "riskLevel">
  ): ProposedFix => ({
    cardId: c.cardId,
    mainSet: base.mainSet,
    subset: base.subset,
    currentCardNumber: c.cardNumber,
    currentCardName: c.cardName,
    ...fix,
  });

  // 1) Known exceptions (sketches / printing plates legitimately share numbers)
  if (KNOWN_EXCEPTION_SUBSET.test(first.subset)) {
    return {
      ...base,
      classification: "KNOWN_EXCEPTION",
      confidence: "high",
      reason: "Sketch/printing-plate subset — shared card numbers are expected.",
      riskLevel: "low",
      proposedFixes: [],
    };
  }

  const distinctNormNames = new Set(cardsOut.map((c) => c.normalizedName));

  // 2) True duplicates: identical normalized names AND identical raw variant text
  if (distinctNormNames.size === 1) {
    const rawVariants = new Set(cardsOut.map((c) => `${c.cardName.trim().toLowerCase()}||${(c.variation || "").trim().toLowerCase()}`));
    if (rawVariants.size === 1) {
      // Prefer survivor with an image, then lowest id
      const survivor = [...cardsOut].sort((a, b) => (b.frontImageUrl ? 1 : 0) - (a.frontImageUrl ? 1 : 0) || a.cardId - b.cardId)[0];
      const fixes = cardsOut
        .filter((c) => c.cardId !== survivor.cardId)
        .map((c) =>
          mkFix(c, {
            proposedAction: "merge_into_survivor",
            survivorCardId: survivor.cardId,
            confidence: "high",
            reason: `Identical name, number, and variant — true duplicate of card ${survivor.cardId}.`,
            riskLevel: "medium",
          })
        );
      return {
        ...base,
        classification: "TRUE_DUPLICATE_RECORD",
        confidence: "high",
        reason: "Same subset, number, and identical card name/variant across all copies.",
        riskLevel: "medium",
        proposedFixes: fixes,
      };
    }
    // Same base name but different bracket/variant text → parallels
    return {
      ...base,
      classification: "OK_PARALLEL",
      confidence: "high",
      reason: "Same base card name; copies differ only by bracketed/variant text (parallels).",
      riskLevel: "low",
      proposedFixes: [],
    };
  }

  // 3) Trailing #code fixes: most cards carry a more specific code in the name
  const codes = cardsOut.map((c) => ({ c, code: extractTrailingCode(c.cardName) }));
  const withCode = codes.filter((x) => x.code && normalizeCardNumber(x.code) !== normalizeCardNumber(x.c.cardNumber));
  if (withCode.length >= Math.max(2, Math.ceil(cardsOut.length * 0.8))) {
    const proposed = withCode.map((x) => normalizeCardNumber(x.code!));
    const unique = new Set(proposed).size === proposed.length;
    for (const x of withCode) x.c.proposedCardNumber = x.code!;
    const fixes = withCode.map((x) =>
      mkFix(x.c, {
        proposedCardNumber: x.code!,
        proposedAction: "update_card_number",
        confidence: unique ? "high" : "medium",
        reason: `Card name ends in #${x.code} — real card number embedded in name while card_number is "${x.c.cardNumber}".`,
        riskLevel: unique ? "low" : "medium",
      })
    );
    return {
      ...base,
      classification: "NEEDS_CARD_NUMBER_FIX",
      confidence: unique ? "high" : "medium",
      reason: `${withCode.length}/${cardsOut.length} cards have a trailing #code in the name that differs from card_number "${first.card_number}".${unique ? "" : " Some proposed codes collide — review before applying."}`,
      riskLevel: unique ? "low" : "medium",
      proposedFixes: fixes,
    };
  }

  // 4) Suspicious placeholder numbers across many unrelated cards
  const placeholder = ["0", "1", ""].includes(normalizeCardNumber(first.card_number));
  if (placeholder && rows.length >= 5 && distinctNormNames.size >= Math.ceil(rows.length * 0.8)) {
    return {
      ...base,
      classification: "NEEDS_SUBSET_SPLIT",
      confidence: "medium",
      reason: `${rows.length} unrelated cards share placeholder number "${first.card_number}" — likely a lumped subset needing split or per-card renumbering (no trailing codes found to auto-fix).`,
      riskLevel: "high",
      proposedFixes: cardsOut.map((c) =>
        mkFix(c, {
          proposedAction: "manual_review",
          confidence: "low",
          reason: "No reliable card code available; needs manual renumbering or subset split.",
          riskLevel: "high",
        })
      ),
    };
  }

  // 5) Everything else
  return {
    ...base,
    classification: "NEEDS_MANUAL_REVIEW",
    confidence: "low",
    reason: "Different card names share the same number without a clear parallel or embedded-code pattern.",
    riskLevel: rows.length >= 5 ? "high" : "medium",
    proposedFixes: [],
  };
}

// ---------- Impact counts (READ ONLY) ----------

export interface ImpactCounts {
  cardIds: number[];
  collectionRecords: number;
  collectionUsers: number;
  wishlistRecords: number;
  pcBinderRecords: number;
  pendingImageRecords: number;
  marketplaceListings: number;
  priceCacheRecords: number;
  xpEventRecords: number;
}

export async function getImpactCounts(cardIds: number[], ex: { execute: typeof db.execute } = db): Promise<ImpactCounts> {
  if (cardIds.length === 0) {
    return {
      cardIds,
      collectionRecords: 0,
      collectionUsers: 0,
      wishlistRecords: 0,
      pcBinderRecords: 0,
      pendingImageRecords: 0,
      marketplaceListings: 0,
      priceCacheRecords: 0,
      xpEventRecords: 0,
    };
  }
  const ids = sql.join(cardIds.map((id) => sql`${id}`), sql`, `);
  const q = async (query: any) => Number(((await ex.execute(query)).rows[0] as any)?.n || 0);
  const [collectionRecords, collectionUsers, wishlistRecords, pcBinderRecords, pendingImageRecords, marketplaceListings, priceCacheRecords, xpEventRecords] =
    await Promise.all([
      q(sql`SELECT COUNT(*) n FROM user_collections WHERE card_id IN (${ids})`),
      q(sql`SELECT COUNT(DISTINCT user_id) n FROM user_collections WHERE card_id IN (${ids})`),
      q(sql`SELECT COUNT(*) n FROM user_wishlists WHERE card_id IN (${ids})`),
      q(sql`SELECT COUNT(*) n FROM pc_binder_cards WHERE card_id IN (${ids})`),
      q(sql`SELECT COUNT(*) n FROM pending_card_images WHERE card_id IN (${ids})`),
      q(sql`SELECT COUNT(*) n FROM listings WHERE card_id IN (${ids})`),
      q(sql`SELECT COUNT(*) n FROM card_price_cache WHERE card_id IN (${ids})`),
      q(sql`SELECT COUNT(*) n FROM xp_events WHERE card_id IN (${ids})`),
    ]);
  return { cardIds, collectionRecords, collectionUsers, wishlistRecords, pcBinderRecords, pendingImageRecords, marketplaceListings, priceCacheRecords, xpEventRecords };
}

// ---------- Remediation: card number fixes ----------

export interface CardNumberFixRequest {
  cardId: number;
  expectedCurrentNumber: string;
  newCardNumber: string;
}

export async function applyCardNumberFixes(
  adminUserId: number,
  fixes: CardNumberFixRequest[],
  confirm: boolean
): Promise<{ dryRun: boolean; applied: number; skipped: { cardId: number; reason: string }[]; preview: any[] }> {
  const skipped: { cardId: number; reason: string }[] = [];
  const valid: { card: typeof cards.$inferSelect; newNumber: string }[] = [];

  const targets = await db.select().from(cards).where(inArray(cards.id, fixes.map((f) => f.cardId)));
  const byId = new Map(targets.map((c) => [c.id, c]));
  // Intra-batch collision guard: two fixes in the same request must not target the same setId + new number
  const claimedTargets = new Set<string>();

  for (const f of fixes) {
    const card = byId.get(f.cardId);
    const newNumber = (f.newCardNumber || "").trim();
    if (!card) { skipped.push({ cardId: f.cardId, reason: "Card not found" }); continue; }
    if (card.archivedAt) { skipped.push({ cardId: f.cardId, reason: "Card is archived" }); continue; }
    if (card.cardNumber !== f.expectedCurrentNumber) {
      skipped.push({ cardId: f.cardId, reason: `Card number changed since analysis (now "${card.cardNumber}")` });
      continue;
    }
    if (!newNumber) { skipped.push({ cardId: f.cardId, reason: "Empty new card number" }); continue; }
    if (newNumber === card.cardNumber) { skipped.push({ cardId: f.cardId, reason: "New number equals current number" }); continue; }
    // Guard: don't create a NEW duplicate in the same set
    const clash = await db
      .select({ id: cards.id })
      .from(cards)
      .where(and(eq(cards.setId, card.setId), eq(cards.cardNumber, newNumber), sql`${cards.archivedAt} IS NULL`, sql`${cards.id} != ${card.id}`))
      .limit(1);
    if (clash.length > 0) {
      skipped.push({ cardId: f.cardId, reason: `Would collide with existing card ${clash[0].id} (#${newNumber}) in same subset` });
      continue;
    }
    const targetKey = `${card.setId}::${newNumber.toLowerCase()}`;
    if (claimedTargets.has(targetKey)) {
      skipped.push({ cardId: f.cardId, reason: `Another fix in this batch already targets #${newNumber} in the same subset` });
      continue;
    }
    claimedTargets.add(targetKey);
    valid.push({ card, newNumber });
  }

  const preview = valid.map((v) => ({
    cardId: v.card.id,
    cardName: v.card.name,
    oldCardNumber: v.card.cardNumber,
    newCardNumber: v.newNumber,
  }));

  if (!confirm) {
    return { dryRun: true, applied: 0, skipped, preview };
  }

  let applied = 0;
  await db.transaction(async (tx) => {
    for (const v of valid) {
      await tx.update(cards).set({ cardNumber: v.newNumber }).where(eq(cards.id, v.card.id));
      await tx.insert(adminAuditLogs).values({
        adminUserId,
        actionType: "data_quality_card_number_fix",
        entityType: "card",
        entityId: v.card.id,
        entityName: v.card.name,
        notes: JSON.stringify({ old: { cardNumber: v.card.cardNumber }, new: { cardNumber: v.newNumber }, setId: v.card.setId, reason: "Duplicate card number remediation" }),
      });
      applied++;
    }
  });
  return { dryRun: false, applied, skipped, preview };
}

// ---------- Remediation: merge true duplicates (soft-archive) ----------

type TxExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Transfer every user-facing reference from `dup` onto `survivor`, then
 * soft-archive `dup`. Collections/wishlists/binders dedupe against rows the
 * user already has for the survivor (quantities merge for collections).
 */
export async function transferReferencesAndArchive(
  tx: TxExecutor,
  survivor: typeof cards.$inferSelect,
  dup: typeof cards.$inferSelect,
  archiveReason: string
): Promise<void> {
  // user_collections: unique (user_id, card_id) — merge quantities when user already owns survivor
  await tx.execute(sql`
    UPDATE user_collections uc SET quantity = uc.quantity + d.quantity
    FROM user_collections d
    WHERE uc.card_id = ${survivor.id} AND d.card_id = ${dup.id} AND uc.user_id = d.user_id
  `);
  await tx.execute(sql`
    DELETE FROM user_collections d
    WHERE d.card_id = ${dup.id}
      AND EXISTS (SELECT 1 FROM user_collections uc WHERE uc.card_id = ${survivor.id} AND uc.user_id = d.user_id)
  `);
  await tx.update(userCollections).set({ cardId: survivor.id }).where(eq(userCollections.cardId, dup.id));

  // user_wishlists: unique (user_id, card_id) — drop dup row when survivor already wishlisted
  await tx.execute(sql`
    DELETE FROM user_wishlists d
    WHERE d.card_id = ${dup.id}
      AND EXISTS (SELECT 1 FROM user_wishlists w WHERE w.card_id = ${survivor.id} AND w.user_id = d.user_id)
  `);
  await tx.update(userWishlists).set({ cardId: survivor.id }).where(eq(userWishlists.cardId, dup.id));

  // pc_binder_cards: unique (binder_id, card_id)
  await tx.execute(sql`
    DELETE FROM pc_binder_cards d
    WHERE d.card_id = ${dup.id}
      AND EXISTS (SELECT 1 FROM pc_binder_cards b WHERE b.card_id = ${survivor.id} AND b.binder_id = d.binder_id)
  `);
  await tx.update(pcBinderCards).set({ cardId: survivor.id }).where(eq(pcBinderCards.cardId, dup.id));

  // Other references
  await tx.update(pendingCardImages).set({ cardId: survivor.id }).where(eq(pendingCardImages.cardId, dup.id));
  await tx.update(listings).set({ cardId: survivor.id }).where(eq(listings.cardId, dup.id));
  await tx.update(xpEvents).set({ cardId: survivor.id }).where(eq(xpEvents.cardId, dup.id));
  await tx.execute(sql`UPDATE scan_uploads SET top_match_card_id = ${survivor.id} WHERE top_match_card_id = ${dup.id}`);
  await tx.execute(sql`UPDATE scan_feedback SET selected_card_id = ${survivor.id} WHERE selected_card_id = ${dup.id}`);
  // price cache: survivor keeps its own row; drop dup's
  await tx.delete(cardPriceCache).where(eq(cardPriceCache.cardId, dup.id));

  // Carry over images if survivor is missing them
  if (!survivor.frontImageUrl && dup.frontImageUrl) {
    await tx.update(cards).set({ frontImageUrl: dup.frontImageUrl }).where(eq(cards.id, survivor.id));
  }
  if (!survivor.backImageUrl && dup.backImageUrl) {
    await tx.update(cards).set({ backImageUrl: dup.backImageUrl }).where(eq(cards.id, survivor.id));
  }

  // Soft-archive the duplicate (NO hard delete)
  await tx
    .update(cards)
    .set({ archivedAt: new Date(), archiveReason })
    .where(eq(cards.id, dup.id));
}

export async function mergeDuplicateCards(
  adminUserId: number,
  survivorCardId: number,
  duplicateCardIds: number[],
  confirm: boolean
): Promise<{ dryRun: boolean; impact: ImpactCounts; merged: number; details: any }> {
  const dupIds = duplicateCardIds.filter((id) => id !== survivorCardId);
  if (dupIds.length === 0) throw new Error("No duplicate card ids provided");

  const all = await db.select().from(cards).where(inArray(cards.id, [survivorCardId, ...dupIds]));
  const survivor = all.find((c) => c.id === survivorCardId);
  if (!survivor) throw new Error(`Survivor card ${survivorCardId} not found`);
  if (survivor.archivedAt) throw new Error(`Survivor card ${survivorCardId} is archived`);
  const dups = all.filter((c) => dupIds.includes(c.id) && !c.archivedAt);
  if (dups.length !== dupIds.length) throw new Error("One or more duplicate cards not found or already archived");
  for (const d of dups) {
    if (d.setId !== survivor.setId) throw new Error(`Card ${d.id} is in a different subset than the survivor — refusing to merge across subsets`);
  }

  const impact = await getImpactCounts(dupIds);

  if (!confirm) {
    return { dryRun: true, impact, merged: 0, details: { survivor: { id: survivor.id, name: survivor.name }, duplicates: dups.map((d) => ({ id: d.id, name: d.name })) } };
  }

  await db.transaction(async (tx) => {
    for (const dup of dups) {
      await transferReferencesAndArchive(tx, survivor, dup, `Merged into card ${survivor.id} (duplicate card number cleanup)`);

      await tx.insert(adminAuditLogs).values({
        adminUserId,
        actionType: "data_quality_duplicate_merge",
        entityType: "card",
        entityId: dup.id,
        entityName: dup.name,
        notes: JSON.stringify({
          old: { cardId: dup.id, cardNumber: dup.cardNumber, name: dup.name, setId: dup.setId, archived: false },
          new: { mergedInto: survivor.id, archived: true },
          rollback: "Un-archive card (clear archived_at/archive_reason); reassigned references cannot be auto-split back — see impact counts",
          impact,
        }),
      });
    }
  });

  return { dryRun: false, impact, merged: dups.length, details: { survivor: { id: survivor.id, name: survivor.name }, duplicates: dups.map((d) => ({ id: d.id, name: d.name })) } };
}

// ---------- Parallel subset cross-reference (READ ONLY) ----------

/** Extract variant text from a card name, e.g. "Wolverine (Gold)" -> "Gold". */
export function extractVariantText(name: string): string | null {
  const matches = [...(name || "").matchAll(/[\[(]([^\])]+)[\])]/g)].map((m) => m[1].trim()).filter(Boolean);
  if (matches.length === 0) return null;
  return matches.join(" ");
}

export interface ParallelSubsetRow {
  mainSet: string;
  subset: string;
  currentSetId: number;
  cardNumber: string;
  variant: string; // "" = base card (no bracket text)
  cardCount: number;
  cardIds: number[];
  matchedSubsetId: number | null;
  matchedSubsetName: string | null;
  matchTier: "exact" | "partial" | null; // exact = variant == subset trailing name; partial = variant words ⊆ trailing name
  /**
   * ready            = target number free, move will succeed
   * already_in_target = same card already exists in target (redundant copy — needs merge, not move)
   * target_occupied  = a DIFFERENT card holds that number in target (needs manual review)
   */
  moveStatus: "ready" | "already_in_target" | "target_occupied" | null;
  suggestion: string;
}

/**
 * For every OK_PARALLEL group: which variant texts appear, and does a sibling
 * subset in the same main set already exist whose name matches the variant
 * (e.g. "(Gold)" cards while a "... - Gold" subset exists)? Read-only report —
 * proposes, never moves.
 */
export async function buildParallelSubsetReport(groups?: DupGroup[]): Promise<ParallelSubsetRow[]> {
  const all = groups ?? (await analyzeDuplicateGroups()).groups;
  const parallels = all.filter((g) => g.classification === "OK_PARALLEL");

  // Load all active subsets for the involved main sets
  const mainSetIds = [...new Set(parallels.map((g) => g.mainSetId).filter((x): x is number => x != null))];
  const siblingSets: Array<{ id: number; main_set_id: number; name: string }> = mainSetIds.length
    ? ((await db.execute(sql`
        SELECT id, main_set_id, name FROM card_sets
        WHERE main_set_id IN (${sql.join(mainSetIds.map((id) => sql`${id}`), sql`, `)})
          AND is_active = true
      `)).rows as any[])
    : [];
  const tokens = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  // Trailing descriptor of a subset name, split on " - " BEFORE punctuation
  // stripping (e.g. "2021 Metal Universe - Precious Metal Gems Red" -> "precious metal gems red").
  const trailingSegment = (name: string) => {
    const parts = name.split(" - ");
    return parts.length > 1 ? parts[parts.length - 1].toLowerCase().trim() : "";
  };
  const tokenSubset = (needle: string[], hay: string[]) => needle.length > 0 && needle.every((t) => hay.includes(t));

  const rows: ParallelSubsetRow[] = [];
  const rowBaseNames = new Map<ParallelSubsetRow, string>();
  for (const g of parallels) {
    // Bucket the group's cards by variant text
    const byVariant = new Map<string, DupCard[]>();
    for (const c of g.cards) {
      const v = extractVariantText(c.cardName) ?? "";
      if (!byVariant.has(v)) byVariant.set(v, []);
      byVariant.get(v)!.push(c);
    }
    const siblings = siblingSets.filter((s) => s.main_set_id === g.mainSetId && s.id !== g.setId);

    for (const [variant, vc] of byVariant) {
      if (variant === "") continue; // base cards stay put
      // Deterministic match tiers (whole-token comparisons only — no raw
      // substring matching, so "Red" can't match inside "Sacred"):
      //   1. variant tokens == subset trailing-segment tokens (exact phrase)
      //   2. variant tokens ⊆ trailing-segment tokens
      //   3. variant tokens ⊆ full subset-name tokens
      const vTok = tokens(variant);
      const exactMatch = siblings.find((s) => {
        const seg = tokens(trailingSegment(s.name));
        return seg.length > 0 && seg.length === vTok.length && tokenSubset(vTok, seg);
      });
      const partialMatch = exactMatch ? undefined
        : (siblings.find((s) => tokenSubset(vTok, tokens(trailingSegment(s.name))))
          ?? siblings.find((s) => tokenSubset(vTok, tokens(s.name))));
      const match = exactMatch ?? partialMatch ?? null;
      const matchTier: "exact" | "partial" | null = exactMatch ? "exact" : partialMatch ? "partial" : null;
      rows.push({
        mainSet: g.mainSet,
        subset: g.subset,
        currentSetId: g.setId,
        cardNumber: g.cardNumber,
        variant,
        cardCount: vc.length,
        cardIds: vc.map((c) => c.cardId),
        matchedSubsetId: match?.id ?? null,
        matchedSubsetName: match?.name ?? null,
        matchTier,
        moveStatus: null, // annotated below
        suggestion: match
          ? `Move to existing subset "${match.name}" (id ${match.id})`
          : `No matching subset — create one or confirm these belong in "${g.subset}"`,
      });
      rowBaseNames.set(rows[rows.length - 1], vc[0]?.normalizedName ?? "");
    }
  }

  // Annotate moveStatus: check whether the target subset already has an active
  // card with this number (and whether it's the same card).
  const matchedIds = [...new Set(rows.filter((r) => r.matchedSubsetId != null).map((r) => r.matchedSubsetId!))];
  if (matchedIds.length > 0) {
    const occ = (await db.execute(sql`
      SELECT set_id, card_number, name FROM cards
      WHERE archived_at IS NULL AND set_id IN (${sql.join(matchedIds.map((id) => sql`${id}`), sql`, `)})
    `)).rows as any[];
    const occByKey = new Map<string, string[]>();
    for (const o of occ) {
      const k = `${o.set_id}::${normalizeCardNumber(o.card_number)}`;
      if (!occByKey.has(k)) occByKey.set(k, []);
      occByKey.get(k)!.push(normalizeCardName(o.name));
    }
    for (const r of rows) {
      if (r.matchedSubsetId == null) continue;
      const occupants = occByKey.get(`${r.matchedSubsetId}::${normalizeCardNumber(r.cardNumber)}`);
      if (!occupants) {
        r.moveStatus = "ready";
      } else if (occupants.includes(rowBaseNames.get(r) ?? "")) {
        r.moveStatus = "already_in_target";
        r.suggestion = `Same card already exists in "${r.matchedSubsetName}" — this copy is redundant and needs a merge, not a move`;
      } else {
        r.moveStatus = "target_occupied";
        r.suggestion = `#${r.cardNumber} in "${r.matchedSubsetName}" is held by a different card — needs manual review`;
      }
    }
  }

  // Matched first (actionable), then by main set
  rows.sort((a, b) => Number(b.matchedSubsetId != null) - Number(a.matchedSubsetId != null) || a.mainSet.localeCompare(b.mainSet) || a.subset.localeCompare(b.subset));
  return rows;
}

export function parallelReportToCsv(rows: ParallelSubsetRow[]): string {
  const esc = (v: any) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = ["main_set,current_subset,card_number,variant,card_count,card_ids,matched_subset,match_tier,move_status,suggestion"];
  for (const r of rows) {
    lines.push([r.mainSet, r.subset, r.cardNumber, r.variant, r.cardCount, r.cardIds.join(" "), r.matchedSubsetName ?? "NONE", r.matchTier ?? "none", r.moveStatus ?? "none", r.suggestion].map(esc).join(","));
  }
  return lines.join("\n");
}

// ---------- Remediation: move parallel cards into their matching subset ----------

export interface ParallelMoveRequest {
  cardId: number;
  targetSetId: number;
  expectedCurrentSetId: number; // guard against stale analysis
}

export async function moveParallelCards(
  adminUserId: number,
  moves: ParallelMoveRequest[],
  confirm: boolean
): Promise<{
  dryRun: boolean;
  applied: number;
  skipped: Array<{ cardId: number; reason: string }>;
  preview: Array<{ cardId: number; cardName: string; cardNumber: string; fromSetId: number; fromSet: string; toSetId: number; toSet: string }>;
}> {
  // Validation runs against a snapshot; for confirmed applies it re-runs INSIDE
  // the transaction (under an advisory lock) so concurrent applies can't defeat
  // the collision guard or move stale rows.
  type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
  const validate = async (ex: Executor) => {
    const skipped: Array<{ cardId: number; reason: string }> = [];
    const valid: Array<{ card: typeof cards.$inferSelect; targetSetId: number }> = [];

    const cardRows = await ex.select().from(cards).where(inArray(cards.id, moves.map((m) => m.cardId)));
    const byId = new Map(cardRows.map((c) => [c.id, c]));

    const setIds = [...new Set([...moves.map((m) => m.targetSetId), ...cardRows.map((c) => c.setId)])];
    const setRows = setIds.length ? await ex.select().from(cardSets).where(inArray(cardSets.id, setIds)) : [];
    const setById = new Map(setRows.map((s) => [s.id, s]));

    // Active card numbers in each target set for collision checks
    const targetIds = [...new Set(moves.map((m) => m.targetSetId))];
    const existing = targetIds.length
      ? ((await ex.execute(sql`
          SELECT set_id, card_number FROM cards
          WHERE set_id IN (${sql.join(targetIds.map((id) => sql`${id}`), sql`, `)}) AND archived_at IS NULL
        `)).rows as any[])
      : [];
    const takenNumbers = new Set(existing.map((r) => `${r.set_id}::${normalizeCardNumber(r.card_number)}`));

    for (const m of moves) {
      const card = byId.get(m.cardId);
      if (!card) { skipped.push({ cardId: m.cardId, reason: "Card not found" }); continue; }
      if (card.archivedAt) { skipped.push({ cardId: m.cardId, reason: "Card is archived" }); continue; }
      if (card.setId !== m.expectedCurrentSetId) {
        skipped.push({ cardId: m.cardId, reason: `Card moved since analysis (now in set ${card.setId})` });
        continue;
      }
      const target = setById.get(m.targetSetId);
      const source = setById.get(card.setId);
      if (!target) { skipped.push({ cardId: m.cardId, reason: `Target subset ${m.targetSetId} not found` }); continue; }
      if (!target.isActive) { skipped.push({ cardId: m.cardId, reason: `Target subset "${target.name}" is not active` }); continue; }
      if (target.id === card.setId) { skipped.push({ cardId: m.cardId, reason: "Card is already in the target subset" }); continue; }
      if (!source || source.mainSetId == null || target.mainSetId !== source.mainSetId) {
        skipped.push({ cardId: m.cardId, reason: "Target subset belongs to a different master set — refusing cross-set move" });
        continue;
      }
      // Collision guard: target already has an active card with this number
      const key = `${target.id}::${normalizeCardNumber(card.cardNumber)}`;
      if (takenNumbers.has(key)) {
        skipped.push({ cardId: m.cardId, reason: `Target subset already has an active card #${card.cardNumber} — would create a new duplicate` });
        continue;
      }
      takenNumbers.add(key); // intra-batch guard
      valid.push({ card, targetSetId: target.id });
    }
    return { skipped, valid, setById };
  };

  const toPreview = (valid: Array<{ card: typeof cards.$inferSelect; targetSetId: number }>, setById: Map<number, typeof cardSets.$inferSelect>) =>
    valid.map((v) => ({
      cardId: v.card.id,
      cardName: v.card.name,
      cardNumber: v.card.cardNumber,
      fromSetId: v.card.setId,
      fromSet: setById.get(v.card.setId)?.name ?? String(v.card.setId),
      toSetId: v.targetSetId,
      toSet: setById.get(v.targetSetId)?.name ?? String(v.targetSetId),
    }));

  if (!confirm) {
    const { skipped, valid, setById } = await validate(db);
    return { dryRun: true, applied: 0, skipped, preview: toPreview(valid, setById) };
  }

  let applied = 0;
  let finalSkipped: Array<{ cardId: number; reason: string }> = [];
  let finalPreview: ReturnType<typeof toPreview> = [];
  await db.transaction(async (tx) => {
    // Serialize concurrent parallel-move applies; validation below then sees committed state.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('data_quality_parallel_moves'))`);
    const { skipped, valid, setById } = await validate(tx);
    finalSkipped = skipped;
    finalPreview = toPreview(valid, setById);
    for (const v of valid) {
      // Conditional update: if the row changed after validation, skip instead of moving a stale row.
      const upd = await tx.execute(sql`
        UPDATE cards SET set_id = ${v.targetSetId}
        WHERE id = ${v.card.id} AND set_id = ${v.card.setId} AND archived_at IS NULL
      `);
      if ((upd as any).rowCount === 0) {
        finalSkipped.push({ cardId: v.card.id, reason: "Card changed during apply — skipped" });
        finalPreview = finalPreview.filter((p) => p.cardId !== v.card.id);
        continue;
      }
      await tx.insert(adminAuditLogs).values({
        adminUserId,
        actionType: "data_quality_parallel_move",
        entityType: "card",
        entityId: v.card.id,
        entityName: v.card.name,
        notes: JSON.stringify({
          old: { setId: v.card.setId },
          new: { setId: v.targetSetId },
          cardNumber: v.card.cardNumber,
          reason: "Parallel card moved to its matching parallel subset",
        }),
      });
      applied++;
    }
    // Keep card_sets.total_cards in sync for every affected subset
    const touched = [...new Set(valid.flatMap((v) => [v.card.setId, v.targetSetId]))];
    for (const sid of touched) {
      await tx.execute(sql`
        UPDATE card_sets SET total_cards = (SELECT COUNT(*) FROM cards WHERE set_id = ${sid} AND archived_at IS NULL)
        WHERE id = ${sid}
      `);
    }
  });
  return { dryRun: false, applied, skipped: finalSkipped, preview: finalPreview };
}

// ---------- Remediation: merge redundant parallel copies (cross-subset) ----------

export interface RedundantMergeRequest {
  dupCardId: number; // the stray copy in the wrong subset
  targetSetId: number; // the parallel subset where the real card already lives
  expectedCurrentSetId: number; // guard against stale analysis
}

/**
 * For "already_in_target" parallel groups: the same card exists both in a base
 * subset (as e.g. "Wolverine (Gold)") and in its parallel subset. Merge the
 * stray copy into the existing target card: transfer collections/wishlists/
 * binders/etc., then soft-archive the stray. Survivor is located by matching
 * card number + normalized name in the target subset — refuses anything else.
 */
export async function mergeRedundantParallels(
  adminUserId: number,
  merges: RedundantMergeRequest[],
  confirm: boolean
): Promise<{
  dryRun: boolean;
  applied: number;
  skipped: Array<{ cardId: number; reason: string }>;
  preview: Array<{ cardId: number; cardName: string; cardNumber: string; fromSet: string; survivorCardId: number; survivorName: string; targetSet: string }>;
  impact: ImpactCounts | null;
}> {
  type Executor = typeof db | TxExecutor;
  const validate = async (ex: Executor) => {
    const skipped: Array<{ cardId: number; reason: string }> = [];
    const valid: Array<{ dup: typeof cards.$inferSelect; survivor: typeof cards.$inferSelect }> = [];

    const dupRows = merges.length ? await ex.select().from(cards).where(inArray(cards.id, merges.map((m) => m.dupCardId))) : [];
    const byId = new Map(dupRows.map((c) => [c.id, c]));

    const setIds = [...new Set([...merges.map((m) => m.targetSetId), ...dupRows.map((c) => c.setId)])];
    const setRows = setIds.length ? await ex.select().from(cardSets).where(inArray(cardSets.id, setIds)) : [];
    const setById = new Map(setRows.map((s) => [s.id, s]));

    // Active cards in target subsets (survivor candidates)
    const targetIds = [...new Set(merges.map((m) => m.targetSetId))];
    const candidates = targetIds.length
      ? await ex.select().from(cards).where(and(inArray(cards.setId, targetIds), sql`${cards.archivedAt} IS NULL`))
      : [];
    const candByKey = new Map<string, Array<typeof cards.$inferSelect>>();
    for (const c of candidates) {
      const k = `${c.setId}::${normalizeCardNumber(c.cardNumber)}`;
      if (!candByKey.has(k)) candByKey.set(k, []);
      candByKey.get(k)!.push(c);
    }

    const claimedSurvivors = new Set<number>();
    for (const m of merges) {
      const dup = byId.get(m.dupCardId);
      if (!dup) { skipped.push({ cardId: m.dupCardId, reason: "Card not found" }); continue; }
      if (dup.archivedAt) { skipped.push({ cardId: m.dupCardId, reason: "Card is already archived" }); continue; }
      if (dup.setId !== m.expectedCurrentSetId) { skipped.push({ cardId: m.dupCardId, reason: `Card moved since analysis (now in set ${dup.setId})` }); continue; }
      const target = setById.get(m.targetSetId);
      const source = setById.get(dup.setId);
      if (!target) { skipped.push({ cardId: m.dupCardId, reason: `Target subset ${m.targetSetId} not found` }); continue; }
      if (!target.isActive) { skipped.push({ cardId: m.dupCardId, reason: `Target subset "${target.name}" is not active` }); continue; }
      if (target.id === dup.setId) { skipped.push({ cardId: m.dupCardId, reason: "Card is already in the target subset" }); continue; }
      if (!source || source.mainSetId == null || target.mainSetId !== source.mainSetId) {
        skipped.push({ cardId: m.dupCardId, reason: "Target subset belongs to a different master set — refusing cross-set merge" });
        continue;
      }
      // Locate the survivor: same number AND same normalized name in the target subset
      const occupants = candByKey.get(`${target.id}::${normalizeCardNumber(dup.cardNumber)}`) ?? [];
      const dupBase = normalizeCardName(dup.name);
      const survivor = occupants.find((o) => normalizeCardName(o.name) === dupBase && o.id !== dup.id);
      if (!survivor) {
        skipped.push({ cardId: m.dupCardId, reason: occupants.length ? `#${dup.cardNumber} in "${target.name}" is a different card — needs manual review` : `No card #${dup.cardNumber} exists in "${target.name}" — use Move instead of Merge` });
        continue;
      }
      if (claimedSurvivors.has(survivor.id)) { skipped.push({ cardId: m.dupCardId, reason: `Another merge in this batch already targets survivor card ${survivor.id}` }); continue; }
      claimedSurvivors.add(survivor.id);
      valid.push({ dup, survivor });
    }
    return { skipped, valid, setById };
  };

  const toPreview = (valid: Array<{ dup: typeof cards.$inferSelect; survivor: typeof cards.$inferSelect }>, setById: Map<number, typeof cardSets.$inferSelect>) =>
    valid.map((v) => ({
      cardId: v.dup.id,
      cardName: v.dup.name,
      cardNumber: v.dup.cardNumber,
      fromSet: setById.get(v.dup.setId)?.name ?? String(v.dup.setId),
      survivorCardId: v.survivor.id,
      survivorName: v.survivor.name,
      targetSet: setById.get(v.survivor.setId)?.name ?? String(v.survivor.setId),
    }));

  if (!confirm) {
    const { skipped, valid, setById } = await validate(db);
    const impact = valid.length ? await getImpactCounts(valid.map((v) => v.dup.id)) : null;
    return { dryRun: true, applied: 0, skipped, preview: toPreview(valid, setById), impact };
  }

  let applied = 0;
  let finalSkipped: Array<{ cardId: number; reason: string }> = [];
  let finalPreview: ReturnType<typeof toPreview> = [];
  let impact: ImpactCounts | null = null;
  await db.transaction(async (tx) => {
    // Same lock as parallel moves — the two tools touch the same rows
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('data_quality_parallel_moves'))`);
    const { skipped, valid, setById } = await validate(tx);
    finalSkipped = skipped;
    finalPreview = toPreview(valid, setById);
    impact = valid.length ? await getImpactCounts(valid.map((v) => v.dup.id), tx) : null;
    for (const v of valid) {
      await transferReferencesAndArchive(tx, v.survivor, v.dup, `Merged into card ${v.survivor.id} (redundant parallel copy cleanup)`);
      await tx.insert(adminAuditLogs).values({
        adminUserId,
        actionType: "data_quality_redundant_parallel_merge",
        entityType: "card",
        entityId: v.dup.id,
        entityName: v.dup.name,
        notes: JSON.stringify({
          old: { cardId: v.dup.id, cardNumber: v.dup.cardNumber, name: v.dup.name, setId: v.dup.setId, archived: false },
          new: { mergedInto: v.survivor.id, survivorSetId: v.survivor.setId, archived: true },
          rollback: "Un-archive card (clear archived_at/archive_reason); reassigned references cannot be auto-split back",
          reason: "Redundant parallel copy — same card already existed in the parallel subset",
        }),
      });
      applied++;
    }
    // Archiving strays changes source-subset counts
    const touched = [...new Set(valid.map((v) => v.dup.setId))];
    for (const sid of touched) {
      await tx.execute(sql`
        UPDATE card_sets SET total_cards = (SELECT COUNT(*) FROM cards WHERE set_id = ${sid} AND archived_at IS NULL)
        WHERE id = ${sid}
      `);
    }
  });
  return { dryRun: false, applied, skipped: finalSkipped, preview: finalPreview, impact };
}

// ---------- Manual-review worklist (READ ONLY) ----------

export interface ManualReviewWorklistRow {
  mainSet: string;
  subset: string;
  setId: number;
  groups: number;
  cards: number;
  sampleCardNumbers: string;
}

/** NEEDS_MANUAL_REVIEW groups aggregated per subset, worst offenders first. */
export function buildManualReviewWorklist(groups: DupGroup[]): ManualReviewWorklistRow[] {
  const bySet = new Map<number, { mainSet: string; subset: string; setId: number; groups: DupGroup[] }>();
  for (const g of groups.filter((x) => x.classification === "NEEDS_MANUAL_REVIEW")) {
    if (!bySet.has(g.setId)) bySet.set(g.setId, { mainSet: g.mainSet, subset: g.subset, setId: g.setId, groups: [] });
    bySet.get(g.setId)!.groups.push(g);
  }
  const rows = [...bySet.values()].map((e) => ({
    mainSet: e.mainSet,
    subset: e.subset,
    setId: e.setId,
    groups: e.groups.length,
    cards: e.groups.reduce((s, g) => s + g.copies, 0),
    sampleCardNumbers: e.groups.slice(0, 10).map((g) => g.cardNumber).join(" "),
  }));
  rows.sort((a, b) => b.groups - a.groups || b.cards - a.cards);
  return rows;
}

export function manualReviewWorklistToCsv(rows: ManualReviewWorklistRow[]): string {
  const esc = (v: any) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = ["rank,main_set,subset,set_id,duplicate_groups,cards_involved,sample_card_numbers"];
  rows.forEach((r, i) => {
    lines.push([i + 1, r.mainSet, r.subset, r.setId, r.groups, r.cards, r.sampleCardNumbers].map(esc).join(","));
  });
  return lines.join("\n");
}

// ---------- CSV export ----------

export function groupsToCsv(groups: DupGroup[]): string {
  const esc = (v: any) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = ["main_set,subset,card_number,copies,classification,confidence,risk,reason,card_id,card_name,proposed_card_number,proposed_action"];
  for (const g of groups) {
    for (const c of g.cards) {
      const fix = g.proposedFixes.find((f) => f.cardId === c.cardId);
      lines.push(
        [g.mainSet, g.subset, g.cardNumber, g.copies, g.classification, g.confidence, g.riskLevel, g.reason, c.cardId, c.cardName, fix?.proposedCardNumber || "", fix?.proposedAction || ""]
          .map(esc)
          .join(",")
      );
    }
  }
  return lines.join("\n");
}
