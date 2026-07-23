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
}

export async function analyzeDuplicateGroups(): Promise<{ summary: DupSummary; groups: DupGroup[] }> {
  const result = await db.execute(sql`
    SELECT c.id AS card_id, c.set_id, c.card_number, c.name AS card_name,
           c.variation, c.front_image_url,
           cs.name AS subset, ms.name AS main_set
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

export async function getImpactCounts(cardIds: number[]): Promise<ImpactCounts> {
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
  const q = async (query: any) => Number(((await db.execute(query)).rows[0] as any)?.n || 0);
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
        .set({ archivedAt: new Date(), archiveReason: `Merged into card ${survivor.id} (duplicate card number cleanup)` })
        .where(eq(cards.id, dup.id));

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
