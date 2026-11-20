import assert from "node:assert/strict";
import { test, after } from "node:test";
import { countRecordedImages, getImageAdminActivity } from "../services/imageAdminActivity";
import { pool, healthPool, db } from "../db";
import { sql } from "drizzle-orm";

after(async () => { await pool.end(); await healthPool.end(); });

test("counts each changed side, not operations; unknown legacy notes stay unknown", () => {
  assert.deepEqual(countRecordedImages([
    '{"sides":["front"]}', '{"sides":["front","back"]}',
    '{"sides":["back","back"]}', null, "legacy text", "{}", '{"sides":[]}',
    '{"sides":["other"]}',
  ]), { images: 4, unknownUpdates: 5 });
});

test("daily and weekly series zero-fill absent activity and use Monday weeks", async () => {
  for (const interval of ["day", "week"] as const) {
    const result = await getImageAdminActivity(2147483647, interval);
    assert.equal(result.periods.length, interval === "day" ? 30 : 12);
    assert.equal(result.firstRecordedAt, null);
    for (const row of result.periods) {
      assert.deepEqual({ ...row, period: undefined },
        { period: undefined, updates: 0, cards: 0, images: 0, unknownUpdates: 0 });
      if (interval === "week") assert.equal(new Date(row.period + "T12:00:00Z").getUTCDay(), 1);
    }
    const stepDays = interval === "day" ? 1 : 7;
    for (let i = 1; i < result.periods.length; i++) {
      assert.equal((Date.parse(result.periods[i].period) - Date.parse(result.periods[i - 1].period)) / 86400000, stepDays);
    }
  }
});

test("real editor bucket totals match independent raw audit reads", async () => {
  const editor = await pool.query(`SELECT admin_user_id FROM admin_audit_logs
    WHERE action_type='card_image_update' AND entity_type='card'
    ORDER BY created_at DESC LIMIT 1`);
  if (!editor.rows.length) return;
  const id = editor.rows[0].admin_user_id;
  const result = await getImageAdminActivity(id, "week");
  const raw = await db.execute(sql`
    SELECT entity_id, notes FROM admin_audit_logs
    WHERE admin_user_id=${id} AND action_type='card_image_update' AND entity_type='card'
      AND created_at >= (${result.periods[0].period}::timestamp
        AT TIME ZONE 'America/Chicago' AT TIME ZONE 'UTC')
      AND created_at <= (now() AT TIME ZONE 'UTC')
  `);
  assert.equal(result.periods.reduce((sum, row) => sum + row.updates, 0), raw.rows.length);
  const expected = countRecordedImages(raw.rows.map(row => row.notes));
  assert.equal(result.periods.reduce((sum, row) => sum + row.images, 0), expected.images);
  assert.equal(result.periods.reduce((sum, row) => sum + row.unknownUpdates, 0), expected.unknownUpdates);
});
