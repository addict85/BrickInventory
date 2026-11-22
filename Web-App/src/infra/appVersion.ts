import fs from 'node:fs';
import path from 'node:path';
import { konfig } from './config';
import { processWide } from './processWide';

const G = processWide('appVersion', () => ({ v: null as string | null }));

export function appVersion(): string {
  const assigned = konfig().appVersion;
  if (assigned) return assigned;
  if (G.v) return G.v;
  try {
    const v = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'version.json'), 'utf8')).version;
    if (v) G.v = String(v);
  } catch (_) {
    /* without a build (tsx) the file does not exist */
  }
  G.v ||= 'unbekannt';
  return G.v;
}
