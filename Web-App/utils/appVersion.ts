/**
 * Die Version dieser Installation: APP_VERSION zur Laufzeit, sonst die beim
 * Bau geschriebene dist/version.json (scripts/version.js, aus Git oder dem
 * Build-Argument), sonst „unbekannt“.
 */
import path from 'path';
import { konfig } from './konfig';

let _gebaut: string | null = null;

export function appVersion(): string {
  const gesetzt = konfig().appVersion;
  if (gesetzt) return gesetzt;
  if (_gebaut) return _gebaut;
  try {
    const v = require(path.join(__dirname, '..', 'version.json')).version;
    if (v) return (_gebaut = String(v));
  } catch (_) { /* ohne Bau (tsx) gibt es die Datei nicht */ }
  return (_gebaut = 'unbekannt');
}
