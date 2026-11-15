/** Das erste Konto einer neuen Installation. Es gilt dieselbe Passwortregel wie
 * für jedes andere Konto; ein schwaches ADMIN_PASSWORD wird durch ein zufälliges
 * ersetzt, das beim ersten Login zu ändern ist. */
import crypto from 'node:crypto';
import { passwortMangel } from '../infra/passwortRegel';
import { entferneStartpasswort, schreibeStartpasswort } from '../infra/startpasswort';
import { hashePasswortSofort } from './passwortHash';
import type { KontoKontext } from './kontext';

export async function legeStartVerwalterAn(k: KontoKontext): Promise<void> {
  if (await k.startVerwalter.kontenVorhanden()) {
    if (!(await k.startVerwalter.startpasswortOffen())) entferneStartpasswort();
    return;
  }
  const envPasswort = k.konfig.adminPasswort;
  const mangel = envPasswort !== '' ? passwortMangel(envPasswort, 'admin') : null;
  if (mangel)
    console.warn(`⚠️  [start] ADMIN_PASSWORD wird nicht verwendet (${mangel}); es gilt ein zufälliges Startpasswort.`);
  const ausUmgebung = envPasswort !== '' && !mangel;
  const passwort = ausUmgebung ? envPasswort : crypto.randomBytes(15).toString('base64url'); // 20 Zeichen, URL-sicher
  // Vor dem Anlegen: Ist die Datei nicht schreibbar, bricht der Start ab, statt
  // ein Konto mit einem Passwort zu hinterlassen, das niemand kennt.
  const datei = ausUmgebung ? null : schreibeStartpasswort('admin', passwort);
  // Dieselben Kosten wie jedes Konto: Mit weniger antwortete ein Fehlversuch gegen „admin“ messbar schneller.
  const hash = hashePasswortSofort(passwort);
  await k.startVerwalter.legeVerwalterAn(hash, !ausUmgebung);
  if (!datei) console.log('✅ Standard-Admin erstellt (Passwort aus ADMIN_PASSWORD).');
  else
    console.log(
      `✅ Standard-Admin erstellt. Das Startpasswort steht in ${datei} (nur für den Dienst lesbar); ` +
        'die Datei verschwindet mit dem ersten Passwortwechsel.',
    );
}
