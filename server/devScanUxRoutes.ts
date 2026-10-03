import type { Express, RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { cards, cardSets, mainSets, userCollections, SIDE_KICK_CARD_LIMIT } from "../shared/schema";
import { assertDevScanTelemetryDatabase } from "./services/devScanTelemetry";

export interface DevScanUndoCapability { userId: number; rowId: number; snapshot: string; expires: number }
export function devScanUndoMatches(entry: DevScanUndoCapability, row: unknown, userId: number, rowId: number, now = Date.now()): boolean {
  return entry.userId === userId && entry.rowId === rowId && entry.expires >= now
    && row != null && JSON.stringify(row) === entry.snapshot;
}

/** These routes are registered behind the visual DEV gate only. Never increment
 * an existing row. Undo is capability-scoped to a new row and its exact snapshot. */
export function registerDevScanUxRoutes(app: Express, auth: RequestHandler, enabled: () => boolean) {
  const gate: RequestHandler = (_req, res, next) => { if (!enabled()) { res.sendStatus(404); return; } next(); };
  const undos = new Map<string, DevScanUndoCapability>();
  app.post("/api/cards/scan/collection", gate, auth, async (req: any, res) => {
    try {
      assertDevScanTelemetryDatabase();
      const cardId = Number(req.body.cardId);
      if (!Number.isInteger(cardId) || cardId < 1) { res.status(400).json({ message: "Invalid card" }); return; }
      const { db } = await import("./db");
      const saved = await db.transaction(async tx => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(42813, ${req.user.id})`);
        const [card] = await tx.select({ id: cards.id }).from(cards).innerJoin(cardSets, eq(cards.setId, cardSets.id))
          .leftJoin(mainSets, eq(cardSets.mainSetId, mainSets.id))
          .where(and(eq(cards.id, cardId), isNull(cards.archivedAt), isNull(cardSets.archivedAt), eq(cardSets.isActive, true),
            or(isNull(cardSets.mainSetId), and(eq(mainSets.isActive, true), isNull(mainSets.archivedAt)))));
        if (!card) throw new Error("Card is unavailable");
        const [existing] = await tx.select().from(userCollections).where(and(eq(userCollections.userId, req.user.id), eq(userCollections.cardId, cardId)));
        if (existing) return { created: false, ownedRow: existing };
        if (req.user.plan !== "SUPER_HERO") {
          const count = await tx.execute(sql`SELECT count(*)::int AS n FROM user_collections WHERE user_id=${req.user.id}`);
          if (Number(count.rows[0]?.n) >= SIDE_KICK_CARD_LIMIT) throw new Error("Collection limit reached");
        }
        const [row] = await tx.insert(userCollections).values({ userId: req.user.id, cardId, condition: "Near Mint", acquiredVia: "scan" }).onConflictDoNothing().returning();
        if (row) return { created: true, ownedRow: row };
        const [concurrent] = await tx.select().from(userCollections).where(and(eq(userCollections.userId, req.user.id), eq(userCollections.cardId, cardId)));
        if (!concurrent) throw new Error("Please retry adding this card");
        return { created: false, ownedRow: concurrent };
      });
      let undoToken: string | null = null;
      for (const [token, entry] of undos) if (entry.expires < Date.now()) undos.delete(token);
      if (saved.created) {
        undoToken = randomUUID();
        undos.set(undoToken, { userId: req.user.id, rowId: saved.ownedRow.id, snapshot: JSON.stringify(saved.ownedRow), expires: Date.now() + 120_000 });
      }
      const { optimizedStorage } = await import("./optimized-storage");
      // Preserve the normal add path's farm-proof ledger and feed semantics.
      // Undo intentionally does not remove XP, just like normal collection delete.
      const { awardCardAddedXp } = await import("./services/xpService");
      await awardCardAddedXp(req.user.id, saved.ownedRow.cardId);
      void import("./services/feedService").then(async feed => {
        await feed.checkCollectionMilestones(req.user.id);
        const { computeUserXp } = await import("./services/xpService");
        const { totalXp } = await computeUserXp(req.user.id);
        await feed.checkLevelMilestone(req.user.id, totalXp);
      }).catch(() => {});
      optimizedStorage.invalidateUserStatsCache(req.user.id);
      void import("./badge-service").then(({ badgeService }) => badgeService.checkBadgesOnCollectionChange(req.user.id)).catch(() => {});
      res.status(saved.created ? 201 : 200).json({ ...saved, undoToken });
    } catch (error) { res.status(400).json({ message: error instanceof Error ? error.message : "Could not save card" }); }
  });
  app.delete("/api/cards/scan/collection/:id", gate, auth, async (req: any, res) => {
    try {
      assertDevScanTelemetryDatabase();
      const token = req.body.undoToken;
      const entry = undos.get(token);
      if (!entry || entry.userId !== req.user.id || entry.rowId !== Number(req.params.id) || entry.expires < Date.now()) { res.status(409).json({ message: "Undo expired. Your collection was not changed." }); return; }
      const { db } = await import("./db");
      const removed = await db.transaction(async tx => {
        const [current] = await tx.select().from(userCollections).where(and(eq(userCollections.id, entry.rowId), eq(userCollections.userId, req.user.id))).for("update");
        if (!devScanUndoMatches(entry, current, req.user.id, Number(req.params.id))) return false;
        await tx.delete(userCollections).where(and(eq(userCollections.id, entry.rowId), eq(userCollections.userId, req.user.id)));
        return true;
      });
      undos.delete(token);
      if (!removed) { res.status(409).json({ message: "This row has changed since scanning. Undo left it untouched." }); return; }
      const { optimizedStorage } = await import("./optimized-storage");
      optimizedStorage.invalidateUserStatsCache(req.user.id);
      void import("./badge-service").then(({ badgeService }) => badgeService.checkBadgesOnCollectionChange(req.user.id)).catch(() => {});
      res.json({ undone: true, ownedRowId: entry.rowId });
    } catch { res.status(500).json({ message: "Undo could not finish. Try again." }); }
  });
  app.get("/api/cards/scan/search", gate, auth, async (req, res) => {
    try {
      const q = String(req.query.q ?? "").trim().slice(0, 100);
      if (!q) { res.json([]); return; }
      const { db } = await import("./db");
      // Card-number tokens are exact-first, including a single digit and # prefix.
      const number = q.replace(/^#/, "").toLowerCase();
      const pattern = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
      const result = await db.execute(sql`
        WITH eligible AS (
          SELECT c.*, cs.name AS set_name, cs.year AS set_year, cs.main_set_id,
            coalesce(ms.name, cs.name) AS parent_name,
            coalesce(cs.main_set_id, -cs.id) AS family_parent,
            ((c.variation IS NULL OR lower(c.variation) IN ('','base'))
              AND (cs.main_set_id IS NULL OR lower(cs.name)=lower(ms.name)
                OR lower(cs.name)=lower(ms.name)||' - '||lower(ms.name)
                OR lower(cs.name) IN (lower(ms.name)||' - base', lower(ms.name)||' - base set'))) AS is_base
          FROM cards c JOIN card_sets cs ON cs.id=c.set_id
          LEFT JOIN main_sets ms ON ms.id=cs.main_set_id
          WHERE c.archived_at IS NULL AND cs.archived_at IS NULL AND cs.is_active=true
            AND (cs.main_set_id IS NULL OR (ms.is_active=true AND ms.archived_at IS NULL))
        ), matching_families AS (
          SELECT family_parent, set_year, lower(name) AS family_name, card_number,
            bool_or(lower(card_number)=${number}) AS exact_number, min(parent_name) AS parent_name
          FROM eligible
          WHERE lower(card_number)=${number} OR name ILIKE ${pattern} OR set_name ILIKE ${pattern}
            OR parent_name ILIKE ${pattern} OR card_number ILIKE ${pattern}
          GROUP BY family_parent, set_year, lower(name), card_number
          ORDER BY bool_or(lower(card_number)=${number}) DESC, set_year DESC, min(parent_name), card_number
          LIMIT 50
        ), expanded AS (
          SELECT e.*, f.exact_number,
            dense_rank() OVER (ORDER BY f.exact_number DESC, f.set_year DESC, f.parent_name, f.family_parent, f.card_number, f.family_name) AS family_rank,
            row_number() OVER (PARTITION BY f.family_parent,f.set_year,f.family_name,f.card_number
              ORDER BY e.is_base DESC, e.is_insert ASC, e.set_name, e.id) AS version_rank
          FROM matching_families f JOIN eligible e ON e.family_parent=f.family_parent
            AND e.set_year=f.set_year AND lower(e.name)=f.family_name AND e.card_number=f.card_number
        )
        SELECT id AS "cardId", name, card_number AS "cardNumber", front_image_url AS "imageUrl",
          set_name AS "setName", set_year AS year, set_id AS "setId", main_set_id AS "mainSetId",
          parent_name AS "mainSetName", is_base AS "isBase",
          CASE WHEN is_base THEN coalesce(variation,'Base') ELSE coalesce(variation,
            CASE WHEN set_name LIKE parent_name||' - %' THEN substring(set_name FROM length(parent_name)+4) ELSE set_name END) END AS "subsetName",
          is_insert AS "isInsert", exact_number AS "exactNumber"
        FROM expanded WHERE version_rank <= 30
        ORDER BY family_rank, version_rank LIMIT 150
      `);
      res.json(result.rows);
    } catch { res.status(500).json({ message: "Search could not load. Try again." }); }
  });
}