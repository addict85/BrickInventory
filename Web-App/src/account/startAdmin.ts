/** Das erste Konto einer neuen Installation. Es gilt dieselbe Passwortregel wie
 * für jedes andere Konto; ein schwaches ADMIN_PASSWORD wird durch ein zufälliges
 * ersetzt, das beim ersten Login zu ändern ist. */
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
  const passwort = fromEnvironment ? envPassword : crypto.randomBytes(15).toString('base64url'); // 20 Zeichen, URL-sicher
  // Vor dem Anlegen: Ist die Datei nicht schreibbar, bricht der Start ab, statt
  // ein Konto mit einem Passwort zu hinterlassen, das niemand kennt.
  const datei = fromEnvironment ? null : writeStartpasswort('admin', passwort);
  // Dieselben Kosten wie jedes Konto: Mit weniger antwortete ein Fehlversuch gegen „admin“ messbar schneller.
  const hash = hashePasswordImmediately(passwort);
  await k.startVerwalter.putAdminAn(hash, !fromEnvironment);
  if (!datei) console.log('✅ Erstes Administratorkonto erstellt (Passwort aus ADMIN_PASSWORD).');
  else
    console.log(
      `✅ Erstes Administratorkonto erstellt. Das Startpasswort steht in ${datei} (nur für den Dienst lesbar); ` +
        'die Datei verschwindet mit dem ersten Passwortwechsel.',
    );
}
