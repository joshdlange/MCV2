type Lifecycle = {
  stage: () => Promise<unknown>;
  publish: () => Promise<unknown>;
  discover: () => Promise<unknown>;
  report: (phase: string, error: unknown) => void;
};

export async function runUpcomingCycle(deps: Lifecycle) {
  for (const phase of ['stage', 'publish', 'discover'] as const) {
    try { await deps[phase](); } catch (error) { deps.report(phase, error); }
  }
}

export async function initializeUpcomingLifecycle(deps: Lifecycle, schedule: (run: () => Promise<void>) => void) {
  const run = () => runUpcomingCycle(deps);
  schedule(run); // Timers must survive failures in the initial attempt.
  await run();
}