import fs from 'node:fs';
import path from 'node:path';
import { konfig } from './konfig';

let _gebaut: string | null = null;

export function appVersion(): string {
  const gesetzt = konfig().appVersion;
  if (gesetzt) return gesetzt;
  if (_gebaut) return _gebaut;
  try {
    const v = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'version.json'), 'utf8')).version;
    if (v) _gebaut = String(v);
  } catch (_) {
    /* ohne Bau (tsx) gibt es die Datei nicht */
  }
  _gebaut ||= 'unbekannt';
  return _gebaut;
}
