import fs from 'node:fs';
import path from 'node:path';
import { konfig } from './konfig';
import { prozessweit } from './prozessweit';

const G = prozessweit('appVersion', () => ({ v: null as string | null }));

export function appVersion(): string {
  const gesetzt = konfig().appVersion;
  if (gesetzt) return gesetzt;
  if (G.v) return G.v;
  try {
    const v = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'version.json'), 'utf8')).version;
    if (v) G.v = String(v);
  } catch (_) {
    /* ohne Bau (tsx) gibt es die Datei nicht */
  }
  G.v ||= 'unbekannt';
  return G.v;
}
