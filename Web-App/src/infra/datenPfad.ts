/** Express dekodiert `%2F` erst NACH dem Aufteilen; Segmente mit / \ oder NUL
 * gelten deshalb als Angriff. */
import path from 'node:path';

import { DATA_DIR } from './appPaths';

/** @returns den Pfad, wenn er im Ordner bleibt — sonst null */
export function safeDataPath(subDir: string, segments: string[]): string | null {
  if (segments.some(s => typeof s !== 'string' || s === '..' || s === '.' || /[\\/\0]/.test(s))) return null;
  const baseDir = path.resolve(DATA_DIR, subDir);
  const filePath = path.resolve(baseDir, ...segments);
  if (filePath !== baseDir && !filePath.startsWith(baseDir + path.sep)) return null;
  return filePath;
}
