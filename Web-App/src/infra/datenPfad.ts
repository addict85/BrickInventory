/**
 * Pfad unter data/<subDir>/ aus den Segmenten einer Anfrage. Express dekodiert
 * `%2F` erst NACH dem Aufteilen — ein Segment kann also selbst einen
 * Schrägstrich tragen. Darum gelten Segmente mit / \ oder NUL als Angriff.
 */
import path from 'path';

const { DATA_DIR } = require('./appPaths') as typeof import('./appPaths');

/** @returns den Pfad, wenn er im Ordner bleibt — sonst null */
export function safeDataPath(subDir: string, segments: string[]): string | null {
  if (segments.some(s => typeof s !== 'string' || s === '..' || s === '.' || /[\\/\0]/.test(s))) return null;
  const baseDir  = path.resolve(DATA_DIR, subDir);
  const filePath = path.resolve(baseDir, ...segments);
  if (filePath !== baseDir && !filePath.startsWith(baseDir + path.sep)) return null;
  return filePath;
}
