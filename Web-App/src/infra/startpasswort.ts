/** Das zufällige Startpasswort des ersten Verwalters steht in einer Datei, die nur der
 * Dienst lesen kann, nicht im Container-Log: Das Log sammeln und behalten oft andere. */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './appPaths';

export function startpasswortDatei(): string {
  return path.join(DATA_DIR, 'admin-startpasswort.txt');
}

/** Neu angelegt (O_EXCL) und dann umbenannt: rename ersetzt einen vorbereiteten Symlink,
 * statt ihm zu folgen, und zwei gleichzeitige Erststarts stossen nicht zusammen. */
export function schreibeStartpasswort(name: string, passwort: string): string {
  const datei = startpasswortDatei();
  fs.mkdirSync(path.dirname(datei), { recursive: true });
  const neu = `${datei}.${process.pid}.${randomBytes(6).toString('hex')}`;
  fs.writeFileSync(neu, `${name}\n${passwort}\n`, { mode: 0o600, flag: 'wx' });
  fs.renameSync(neu, datei);
  return datei;
}

export function entferneStartpasswort(): void {
  const datei = startpasswortDatei();
  if (!fs.existsSync(datei)) return;
  fs.rmSync(datei, { force: true });
  console.log(`[start] Startpasswort-Datei ${datei} gelöscht: Das Passwort wurde geändert.`);
}
