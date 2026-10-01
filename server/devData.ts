import path from 'node:path';

// Root for development-only experiment data (photos, labels, indexes, caches).
// MCV_DEV_DATA overrides the default project-local `.local` (gitignored).
// Paths only: callers keep their own file layout beneath this root.
export function devDataPath(...parts: string[]): string {
  return path.resolve(process.env.MCV_DEV_DATA || path.resolve(process.cwd(), '.local'), ...parts);
}
