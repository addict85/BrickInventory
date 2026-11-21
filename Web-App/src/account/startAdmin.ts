/** The first account of a new installation. The same password rule applies as
 * for every other account; a weak ADMIN_PASSWORD is replaced by a random one
 * that must be changed at first login. */
import crypto from 'node:crypto';
import { passwordLack } from '../infra/passwordRule';
import { removeStartpasswort, writeStartpasswort } from '../infra/startpasswort';
import { hashePasswordImmediately } from './passwordHash';
import type { AccountContext } from './context';

export async function putStartAdminAn(k: AccountContext): Promise<void> {
  if (await k.startVerwalter.accountsPresent()) {
    if (!(await k.startVerwalter.openStartpasswort())) removeStartpasswort();
    return;
  }
  const envPassword = k.konfig.adminPassword;
  const mangel = envPassword !== '' ? passwordLack(envPassword, 'admin') : null;
  if (mangel)
    console.warn(`⚠️  [start] ADMIN_PASSWORD wird nicht verwendet (${mangel}); es gilt ein zufälliges Startpasswort.`);
  const fromEnvironment = envPassword !== '' && !mangel;
  const passwort = fromEnvironment ? envPassword : crypto.randomBytes(15).toString('base64url'); // 20 characters, URL-safe
  // Before creating: if the file is not writable, startup aborts instead of
  // leaving behind an account with a password nobody knows.
  const datei = fromEnvironment ? null : writeStartpasswort('admin', passwort);
  // Same cost as every account: with less, a failed attempt against "admin" would answer measurably faster.
  const hash = hashePasswordImmediately(passwort);
  await k.startVerwalter.putAdminAn(hash, !fromEnvironment);
  if (!datei) console.log('✅ Erstes Administratorkonto erstellt (Passwort aus ADMIN_PASSWORD).');
  else
    console.log(
      `✅ Erstes Administratorkonto erstellt. Das Startpasswort steht in ${datei} (nur für den Dienst lesbar); ` +
        'die Datei verschwindet mit dem ersten Passwortwechsel.',
    );
}
