import { CronJob } from 'cron';
import { pool } from '../db';
import { runSetIntelScan } from './setIntelligence';
import { upcomingPublicCatchup } from './upcomingSetRelease';
import { stageToppsNeon2026 } from '../seeds/stageToppsNeon2026';
import { initializeUpcomingLifecycle, runUpcomingCycle } from './upcomingLifecycle';

/** Discovery is private until admin approval. Never invent dates or publish RSS guesses. */
export async function syncRSSFeed() {
  return runSetIntelScan({ dryRun: false, trigger: 'upcoming-sync' });
}

export const expireReleasedSets = upcomingPublicCatchup;

let discoveryInFlight: Promise<void> | undefined;
export function ensureDiscoveryFresh() {
  if (discoveryInFlight) return discoveryInFlight;
  discoveryInFlight = (async () => {
    const client = await pool.connect();
    let locked = false;
    try {
      const lock = await client.query("SELECT pg_try_advisory_lock(hashtext('upcoming-discovery')) AS acquired");
      locked = lock.rows[0].acquired;
      if (!locked) return;
      const recent = await client.query("SELECT 1 FROM set_intel_scan_logs WHERE started_at > now() - interval '6 hours' LIMIT 1");
      if (!recent.rows.length) await syncRSSFeed();
    } finally {
      if (locked) await client.query("SELECT pg_advisory_unlock(hashtext('upcoming-discovery'))");
      client.release();
    }
  })().finally(() => { discoveryInFlight = undefined; });
  return discoveryInFlight;
}

let started = false;
const lifecycle = {
  stage: stageToppsNeon2026,
  publish: upcomingPublicCatchup,
  discover: ensureDiscoveryFresh,
  report: (phase: string, error: unknown) => console.error(`[Upcoming ${phase}]`, error),
};
export function startUpcomingSetsCronJobs(run = () => runUpcomingCycle(lifecycle)) {
  if (started) return;
  started = true;
  new CronJob('0 */5 * * * *', () => {
    void run().catch(error => console.error('[Upcoming cycle]', error));
  }, null, true, 'America/Chicago');
}

export async function initializeUpcomingSets() {
  await initializeUpcomingLifecycle(lifecycle, startUpcomingSetsCronJobs);
}