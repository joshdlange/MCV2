import path from 'node:path';

/** Independent of development catalog-maintenance suppression. */
export function isVisualScanEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SCAN_VISUAL_RETRIEVAL === 'on';
}

export function visualScanIndexPath(): string {
  return path.resolve('runtime/scanner/index');
}