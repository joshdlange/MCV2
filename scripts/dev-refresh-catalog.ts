/**
 * DEV ONLY. Back up + rehearse restore, export production catalog read-only,
 * then atomically replace the dev catalog and clear its old-ID test references.
 * Never imports server startup code. Never deletes files.
 *
 * NODE_ENV=development SCAN_VISUAL_RETRIEVAL=on npx tsx scripts/dev-refresh-catalog.ts --apply
 * NODE_ENV=development SCAN_VISUAL_RETRIEVAL=on npx tsx scripts/dev-refresh-catalog.ts --verify <manifest>
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import pg from 'pg';

const CATALOG = ['main_sets', 'card_sets', 'cards'];
const PROD_HOST = 'ep-lingering-waterfall-a6jtu4k4.us-west-2.aws.neon.tech';
// Explicit FK closure, checked against the live schema before touching data.
const CLEAR = [
  ...CATALOG, 'user_collections', 'user_wishlists', 'pending_card_images',
  'card_price_cache', 'pc_binder_cards', 'share_links', 'card_set_migrations',
  'migration_logs', 'migration_log_cards', 'listings', 'offers', 'orders',
  'shipments', 'reviews', 'reports', 'payout_batch_items', 'scan_uploads',
  'scan_feedback', 'upcoming_sets', 'upcoming_set_interests', 'user_scan_logs',
  'card_image_backup', 'processed_sets', 'merge_image_repairs',
  'image_migration_failures', 'drive_image_imports',
];
const qi = (s: string) => {
  assert(/^[a-z_][a-z0-9_]*$/.test(s), `Unsafe identifier: ${s}`);
  return `"${s}"`;
};
function target(key: string, host: string, database: string) {
  const url = new URL(process.env[key] ?? '');
  assert.equal(url.hostname, host, `${key}: unapproved host`);
  assert.equal(url.pathname, `/${database}`, `${key}: unapproved database`);
  return url;
}
function toolEnv(url: URL, readonly = false) {
  return {
    ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: url.pathname.slice(1), PGSSLMODE: url.searchParams.get('sslmode') || 'prefer',
    PGOPTIONS: readonly ? '-c default_transaction_read_only=on' : '',
  };
}
async function tool(name: string, args: string[], env: NodeJS.ProcessEnv) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(name, args, { env, stdio: ['ignore', 'ignore', 'pipe'] });
    let error = '';
    child.stderr.on('data', b => { error += b.toString(); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`${name} failed (${code}): ${error.slice(-3000)}`)));
  });
}
function client(url: URL, readonly = false) {
  return new pg.Client({ connectionString: url.toString(),
    options: readonly ? '-c default_transaction_read_only=on' : undefined });
}
async function columns(c: pg.Client, table: string) {
  return (await c.query(`SELECT column_name,udt_name,is_nullable,column_default
    FROM information_schema.columns WHERE table_schema='public' AND table_name=$1
    ORDER BY ordinal_position`, [table])).rows;
}
function digestSql(table: string, expression = 'to_jsonb(t)') {
  return `SELECT count(*)::int AS count, coalesce(max(id),0)::int AS max_id,
    md5(coalesce(string_agg(md5((${expression})::text),'' ORDER BY id),'')) AS row_hash,
    md5(coalesce(string_agg(id::text,',' ORDER BY id),'')) AS id_hash FROM public.${qi(table)} t`;
}
async function fingerprints(c: pg.Client) {
  const result: Record<string, any> = {};
  for (const t of CATALOG) result[t] = (await c.query(digestSql(t))).rows[0];
  return result;
}
async function counts(c: pg.Client) {
  const tables = (await c.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`)).rows;
  const result: Record<string, number> = {};
  for (const { tablename } of tables) result[tablename] = +(await c.query(`SELECT count(*) FROM public.${qi(tablename)}`)).rows[0].count;
  return result;
}
async function sha256(file: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function applyPrepared(dev: pg.Client, devUrl: URL, manifestFile: string) {
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  assert.equal(manifest.status, 'ready-to-load');
  assert(manifest.restoreRehearsal?.startsWith('passed:'));
  const out = manifest.directory;
  assert.equal(path.resolve(manifestFile), path.join(out, 'manifest.json'));
  assert(out.startsWith(path.resolve('.local/scan-v1/catalog-refresh') + path.sep));
  assert.equal(await sha256(path.join(out, 'dev-before.dump')), manifest.backupSha256);
  assert.equal(await sha256(path.join(out, 'production-catalog.dump')), manifest.catalogDumpSha256);
  assert.deepEqual(await counts(dev), manifest.before, 'Dev changed since backup; do not reuse this export');
  const active = (await dev.query(`SELECT count(*)::int AS n FROM pg_stat_activity
    WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'`)).rows[0].n;
  assert.equal(active, 0, 'Stop all dev app/database clients before refreshing');
  console.log('Applying one atomic dev transaction from the verified backup/export.');
  await tool('psql', ['-X', '--set=ON_ERROR_STOP=1', '--single-transaction',
    '--file', path.join(out, 'cleanup.sql'), '--file', path.join(out, 'production-catalog.sql'),
    '--file', path.join(out, 'verify.sql')], toolEnv(devUrl));
  manifest.after = await counts(dev);
  manifest.actual = await fingerprints(dev);
  assert.deepEqual(manifest.actual, manifest.production);
  manifest.status = 'verified';
  await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ status: manifest.status, manifest: manifestFile, catalog: manifest.actual,
    cleared: Object.fromEntries(Object.keys(manifest.before).filter(t => manifest.before[t] !== manifest.after[t])
      .map(t => [t, { before: manifest.before[t], after: manifest.after[t] }])) }, null, 2));
}

async function main() {
  process.umask(0o077);
  assert.equal(process.env.NODE_ENV, 'development', 'development only');
  assert(!process.env.REPLIT_DEPLOYMENT, 'never run inside a deployment');
  assert.equal(process.env.SCAN_VISUAL_RETRIEVAL, 'on', 'requires explicit scan flag');
  const devUrl = target('DATABASE_URL', 'helium', 'heliumdb');
  const dev = client(devUrl);
  await dev.connect();
  try {
    if (process.argv[2] === '--resume') {
      await applyPrepared(dev, devUrl, path.resolve(process.argv[3]));
      return;
    }
    if (process.argv[2] === '--verify') {
      const manifest = JSON.parse(await fs.readFile(process.argv[3], 'utf8'));
      await dev.query('BEGIN READ ONLY ISOLATION LEVEL REPEATABLE READ');
      const actual = await fingerprints(dev);
      assert.deepEqual(actual, manifest.production, 'Dev catalog differs from the production snapshot');
      await dev.query('ROLLBACK');
      console.log(JSON.stringify({ verified: true, catalog: actual }, null, 2));
      return;
    }
    assert.equal(process.argv[2], '--apply', 'Use --apply or --verify <manifest>');
    const prodUrl = target('NEON_DATABASE_URL', PROD_HOST, 'neondb');
    // Fail if an app server is still connected. An administrator must stop it first.
    const active = (await dev.query(`SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'`)).rows[0].n;
    assert.equal(active, 0, 'Stop all dev app/database clients before refreshing');
    const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 17);
    const out = path.resolve('.local/scan-v1/catalog-refresh', stamp);
    await fs.mkdir(out, { recursive: true, mode: 0o700 });
    const manifestFile = path.join(out, 'manifest.json');
    const manifest: any = { createdAt: new Date().toISOString(), status: 'preflight', directory: out,
      productionReadOnly: true, before: await counts(dev), production: null };
    const save = () => fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2), { mode: 0o600 });
    await save();
    console.log(`Backup/checkpoint directory: ${out}`);
    const backup = path.join(out, 'dev-before.dump');
    const originalCatalog = await fingerprints(dev);
    const originalAccounts = (await dev.query(digestSql('users', "to_jsonb(t)-'favorite_sets'"))).rows[0];
    await tool('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--file', backup], toolEnv(devUrl));
    manifest.backupSha256 = await sha256(backup);
    // Actually restore the entire backup to an isolated database on the DEV host.
    const rehearsalName = `scan_restore_${stamp}`;
    await dev.query(`CREATE DATABASE ${qi(rehearsalName)}`);
    const rehearsalUrl = new URL(devUrl); rehearsalUrl.pathname = `/${rehearsalName}`;
    try {
      await tool('pg_restore', ['--exit-on-error', '--single-transaction', '--no-owner', '--no-privileges',
        '--dbname', rehearsalName, backup], toolEnv(rehearsalUrl));
      const restored = client(rehearsalUrl, true); await restored.connect();
      try {
        assert.deepEqual(await counts(restored), manifest.before, 'Backup restore row counts differ');
        assert.deepEqual(await fingerprints(restored), originalCatalog, 'Backup catalog content differs');
        assert.deepEqual((await restored.query(digestSql('users', "to_jsonb(t)-'favorite_sets'"))).rows[0], originalAccounts);
      } finally { await restored.end(); }
      manifest.restoreRehearsal = 'passed: full database restore, all table counts, catalog and accounts hashes';
    } finally {
      await dev.query(`DROP DATABASE ${qi(rehearsalName)}`);
    }
    manifest.status = 'backup-tested'; await save();
    console.log('Full dev backup restored successfully in an isolated dev database.');

    const prod = client(prodUrl, true); await prod.connect();
    const catalogDump = path.join(out, 'production-catalog.dump');
    try {
      await prod.query('BEGIN READ ONLY ISOLATION LEVEL REPEATABLE READ');
      assert.equal((await prod.query('SHOW transaction_read_only')).rows[0].transaction_read_only, 'on');
      manifest.sourceSnapshotAt = (await prod.query('SELECT now() AS t')).rows[0].t;
      for (const t of CATALOG) {
        const source = await columns(prod, t), dest = await columns(dev, t);
        // Defaults may differ; copied columns and their types must not.
        const shape = (rows: any[]) => rows.map(({ column_name, udt_name, is_nullable }) => ({ column_name, udt_name, is_nullable }));
        assert.deepEqual(shape(dest), shape(source), `${t}: schema mismatch; refusing a lossy copy`);
      }
      manifest.production = await fingerprints(prod);
      const snapshot = (await prod.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
      // pg_dump imports the SAME read-only snapshot; it never sees users or collector tables.
      await tool('pg_dump', ['--format=custom', '--data-only', '--no-owner', '--no-privileges',
        '--snapshot', snapshot, ...CATALOG.flatMap(t => ['--table', `public.${t}`]),
        '--file', catalogDump], toolEnv(prodUrl, true));
      await prod.query('ROLLBACK');
    } finally { await prod.end(); }
    manifest.catalogDumpSha256 = await sha256(catalogDump);
    const catalogSql = path.join(out, 'production-catalog.sql');
    await tool('pg_restore', ['--no-owner', '--no-privileges', '--file', catalogSql, catalogDump], toolEnv(devUrl));

    const fks = (await dev.query(`SELECT conrelid::regclass::text AS child, confrelid::regclass::text AS parent
      FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace`)).rows;
    for (const fk of fks) {
      assert(!CLEAR.includes(fk.parent) || CLEAR.includes(fk.child),
        `Unreviewed dependent table ${fk.child} -> ${fk.parent}; refusing CASCADE`);
    }
    for (const t of CLEAR) assert(t in manifest.before, `Missing expected table ${t}`);
    const upcomingColumns = (await columns(dev, 'upcoming_sets')).map(r => r.column_name);
    const cleanup = [
      `SET LOCAL lock_timeout='10s';`,
      // Preserve unrelated upcoming-release data and user-only moderation reports.
      `CREATE TEMP TABLE keep_upcoming AS SELECT * FROM upcoming_sets;`,
      `CREATE TEMP TABLE keep_interests AS SELECT * FROM upcoming_set_interests;`,
      `CREATE TEMP TABLE keep_reports AS SELECT * FROM reports WHERE listing_id IS NULL AND order_id IS NULL;`,
      `CREATE TEMP TABLE old_upcoming_links AS SELECT u.id, m.slug FROM upcoming_sets u JOIN main_sets m ON m.id=u.published_main_set_id;`,
      `TRUNCATE TABLE ${CLEAR.map(qi).join(', ')} RESTRICT;`,
      `INSERT INTO upcoming_sets (${upcomingColumns.map(qi).join(',')}) SELECT ${upcomingColumns.map(c => c === 'published_main_set_id' ? 'NULL' : qi(c)).join(',')} FROM keep_upcoming;`,
      `INSERT INTO upcoming_set_interests SELECT * FROM keep_interests;`,
      `INSERT INTO reports SELECT * FROM keep_reports;`,
      `DELETE FROM xp_events WHERE card_id IS NOT NULL OR card_set_id IS NOT NULL OR image_submission_id IS NOT NULL
        OR feed_event_id IN (SELECT id FROM feed_events WHERE related_type IN ('card','card_set','main_set','set') OR event_type IN ('first_card','collection_milestone','set_completed','image_approved'));`,
      `DELETE FROM feed_events WHERE related_type IN ('card','card_set','main_set','set') OR event_type IN ('first_card','collection_milestone','set_completed','image_approved');`,
      `DELETE FROM admin_audit_logs WHERE entity_type IN ('card','card_set','main_set');`,
      `UPDATE users SET favorite_sets='{}' WHERE cardinality(favorite_sets)>0;`,
    ].join('\n');
    const verify: string[] = [
      // pg_dump deliberately clears search_path. Restore it before local checks.
      `SET LOCAL search_path=public,pg_catalog;`,
      // Slug remap retains upcoming publication links without retaining old dev IDs.
      `UPDATE upcoming_sets u SET published_main_set_id=m.id FROM old_upcoming_links l JOIN main_sets m ON m.slug=l.slug WHERE u.id=l.id;`,
    ];
    for (const t of CATALOG) {
      const expected = manifest.production[t];
      assert(/^[0-9a-f]{32}$/.test(expected.row_hash));
      verify.push(`DO $$ BEGIN IF (SELECT row_hash FROM (${digestSql(t)}) h) <> '${expected.row_hash}'
        OR (SELECT count(*) FROM ${qi(t)}) <> ${expected.count} THEN RAISE EXCEPTION 'Catalog verification failed: ${t}'; END IF; END $$;`);
      const seq = (await dev.query(`SELECT pg_get_serial_sequence($1,'id') AS s`, [t])).rows[0].s;
      assert(seq); const parts = seq.split('.').map(qi).join('.');
      assert(Number.isSafeInteger(expected.max_id));
      verify.push(`ALTER SEQUENCE ${parts} RESTART WITH ${expected.max_id + 1};`);
    }
    assert(/^[0-9a-f]{32}$/.test(originalAccounts.row_hash));
    verify.push(`DO $$ BEGIN IF (SELECT row_hash FROM (${digestSql('users', "to_jsonb(t)-'favorite_sets'")}) h)
      <> '${originalAccounts.row_hash}' THEN RAISE EXCEPTION 'Unrelated account data changed'; END IF; END $$;`);
    const cleanupFile = path.join(out, 'cleanup.sql'), verifyFile = path.join(out, 'verify.sql');
    await fs.writeFile(cleanupFile, cleanup);
    await fs.writeFile(verifyFile, verify.join('\n'));
    manifest.status = 'ready-to-load'; await save();
    await applyPrepared(dev, devUrl, manifestFile);
  } finally { await dev.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });