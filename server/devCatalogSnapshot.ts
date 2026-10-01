/**
 * Preserve the refreshed catalog during local visual-retrieval scan testing.
 * Deployment and all default/off paths must retain normal catalog maintenance.
 */
export function suppressAutomaticCatalogMutations(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'development'
    && !env.REPLIT_DEPLOYMENT
    && env.SCAN_VISUAL_RETRIEVAL === 'on';
}