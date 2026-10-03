/** Destructive catalog repair is an explicit maintenance operation, never a boot default. */
export function allowSuperfractorDuplicateRepair(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.RUN_SUPERFRACTOR_DUPLICATE_REPAIR === 'true';
}