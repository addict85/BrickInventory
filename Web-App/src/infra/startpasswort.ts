/** Das zufällige Startpasswort des ersten Verwalters steht in einer Datei, die nur der
 * Dienst lesen kann, nicht im Container-Log: Das Log sammeln und behalten oft andere. */
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './appPaths';

export function startpasswortDatei(): string {
  return path.join(DATA_DIR, 'admin-startpasswort.txt');
}

/** O_EXCL: Ein vorbereiteter Symlink an dieser Stelle leitet das Passwort nicht um. */
export function schreibeStartpasswort(name: string, passwort: string): string {
  const datei = startpasswortDatei();
  fs.mkdirSync(path.dirname(datei), { recursive: true });
  fs.rmSync(datei, { force: true });
  fs.writeFileSync(datei, `${name}\n${passwort}\n`, { mode: 0o600, flag: 'wx' });
  return datei;
}

export function entferneStartpasswort(): void {
  const datei = startpasswortDatei();
  if (!fs.existsSync(datei)) return;
  fs.rmSync(datei, { force: true });
  console.log(`[start] Startpasswort-Datei ${datei} gelöscht: Das Passwort wurde geändert.`);
}
