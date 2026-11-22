/** The first admin's random start password is in a file only the
 * service can read, not in the container log: the log is often collected and kept by others. */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './appPaths';

export function startpasswortFile(): string {
  return path.join(DATA_DIR, 'admin-startpasswort.txt');
}

/** Created new (O_EXCL) and then renamed: rename replaces a prepared symlink
 * instead of following it, and two concurrent first starts do not collide. */
export function writeStartpasswort(name: string, passwort: string): string {
  const datei = startpasswortFile();
  fs.mkdirSync(path.dirname(datei), { recursive: true });
  const neu = `${datei}.${process.pid}.${randomBytes(6).toString('hex')}`;
  fs.writeFileSync(neu, `${name}\n${passwort}\n`, { mode: 0o600, flag: 'wx' });
  fs.renameSync(neu, datei);
  return datei;
}

export function removeStartpasswort(): void {
  const datei = startpasswortFile();
  if (!fs.existsSync(datei)) return;
  fs.rmSync(datei, { force: true });
  console.log(`[start] Startpasswort-Datei ${datei} gelöscht: Das Passwort wurde geändert.`);
}
