/** The first account of a new installation. The same password rule applies as
 * for every other account; a weak ADMIN_PASSWORD is replaced by a random one
 * that must be changed at first login. */
import crypto from 'node:crypto';
import { passwordLack } from '../infra/passwordRule';
import { removeStartPassword, writeStartPassword } from '../infra/startPassword';
import { hashPasswordImmediately } from './passwordHash';
import type { AccountContext } from './context';

export async function createStartAdmin(k: AccountContext): Promise<void> {
  if (await k.startAdmin.accountsPresent()) {
    if (!(await k.startAdmin.openStartPassword())) removeStartPassword();
    return;
  }
  const envPassword = k.config.adminPassword;
  const lack = envPassword !== '' ? passwordLack(envPassword, 'admin') : null;
  if (lack)
    console.warn(`⚠️  [start] ADMIN_PASSWORD wird nicht verwendet (${lack}); es gilt ein zufälliges Startpasswort.`);
  const fromEnvironment = envPassword !== '' && !lack;
  const password = fromEnvironment ? envPassword : crypto.randomBytes(15).toString('base64url'); // 20 characters, URL-safe
  // Before creating: if the file is not writable, startup aborts instead of
  // leaving behind an account with a password nobody knows.
  const file = fromEnvironment ? null : writeStartPassword('admin', password);
  // Same cost as every account: with less, a failed attempt against "admin" would answer measurably faster.
  const hash = hashPasswordImmediately(password);
  await k.startAdmin.createAdmin(hash, !fromEnvironment);
  if (!file) console.log('✅ Erstes Administratorkonto erstellt (Passwort aus ADMIN_PASSWORD).');
  else
    console.log(
      `✅ Erstes Administratorkonto erstellt. Das Startpasswort steht in ${file} (nur für den Dienst lesbar); ` +
        'die Datei verschwindet mit dem ersten Passwortwechsel.',
    );
}
