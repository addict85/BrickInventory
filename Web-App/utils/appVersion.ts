/**
 * Die Version dieser Installation — von überall aus auffindbar.
 * Ausführlich: docs/begruendungen/utils/appVersion.ts.md#abschnitt
 */
import path from 'path';

let _version: string | null = null;

export function appVersion(): string {
  if (_version) return _version;
  for (const rel of ['../package.json', '../../package.json']) {
    try {
      const v = require(path.join(__dirname, rel)).version;
      if (v) { _version = String(v); return _version; }
    } catch (_) { /* nächster Ort */ }
  }
  _version = 'unbekannt';
  return _version;
}
