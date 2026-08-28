/**
 * Die Version dieser Installation — von überall aus auffindbar.
 *
 * ── Warum eine eigene Datei (Nachtrag 114) ──────────────────────────────────
 * Marcos Frage „Was wird neu als user_agent gesendet?" hat einen Fehler
 * aufgedeckt, den ich sonst ausgeliefert hätte: Der User-Agent trug die Version
 * „3.0" statt der echten.
 *
 * Der Grund ist die Auflösung von `require('../package.json')`. Sie geht vom
 * Ordner des MODULS aus, nicht vom Projekt. Übersetzt liegt das Modul unter
 * `dist/routes/`, also sucht es `dist/package.json` — und die gibt es nicht,
 * weder hier noch im Container. Der Fehler landete im `catch`, und übrig blieb
 * ein Vorgabewert, der seit Jahren nicht stimmt.
 *
 * Dieselbe Zeile steht in db/database.ts für die Schemaversion. Sie hat
 * dasselbe Problem — nur fällt es dort nicht auf, weil „unknown" als Wert
 * genügt, um Migrationen auszulösen.
 *
 * Deshalb hier EINE Stelle, die mehrere Orte durchprobiert: den Projektordner
 * neben dist/ (der Normalfall im Container) und den Ordner darüber.
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
