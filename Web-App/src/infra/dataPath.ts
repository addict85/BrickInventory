/** Express decodes `%2F` only AFTER splitting; segments with / \ or NUL
 * therefore count as an attack. */
import path from 'node:path';

import { DATA_DIR } from './appPaths';

/** @returns the path if it stays inside the folder — otherwise null */
export function safeDataPath(subDir: string, segments: string[]): string | null {
  if (segments.some(s => typeof s !== 'string' || s === '..' || s === '.' || /[\\/\0]/.test(s))) return null;
  const baseDir = path.resolve(DATA_DIR, subDir);
  const filePath = path.resolve(baseDir, ...segments);
  if (filePath !== baseDir && !filePath.startsWith(baseDir + path.sep)) return null;
  return filePath;
}
