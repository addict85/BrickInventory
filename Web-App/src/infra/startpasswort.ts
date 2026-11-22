/** The first admin's random start password is in a file only the
 * service can read, not in the container log: the log is often collected and kept by others. */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './appPaths';

export function startPasswordFile(): string {
  return path.join(DATA_DIR, 'admin-startpasswort.txt');
}

/** Created new (O_EXCL) and then renamed: rename replaces a prepared symlink
 * instead of following it, and two concurrent first starts do not collide. */
export function writeStartPassword(name: string, password: string): string {
  const file = startPasswordFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fresh = `${file}.${process.pid}.${randomBytes(6).toString('hex')}`;
  fs.writeFileSync(fresh, `${name}\n${password}\n`, { mode: 0o600, flag: 'wx' });
  fs.renameSync(fresh, file);
  return file;
}

export function removeStartPassword(): void {
  const file = startPasswordFile();
  if (!fs.existsSync(file)) return;
  fs.rmSync(file, { force: true });
  console.log(`[start] Startpasswort-Datei ${file} gelöscht: Das Passwort wurde geändert.`);
}
