/** Profil des eigenen Kontos: Name, Benutzername und Adresse. Die Zeile in users gehört dem
 * Konto; geschrieben wird über dessen Dienste, die Mails gehen über den Mailbereich. */
import crypto from 'node:crypto';
import { mailBasisUrl } from '../infra/basisUrl';
import { fachfehler } from '../infra/fehlerTexte';
import { versuche, wertOder } from '../infra/ergebnis';
import { imSystemkontext } from '../infra/kontoKontext';
import { tokenAbdruck, type KontoZeile } from '../konto';
import type { ProfilKontext } from './kontext';

type Konto = KontoZeile;
export interface ProfilEingabe {
  username?: string | undefined;
  email?: string | null | undefined;
  first_name?: string | null | undefined;
  last_name?: string | null | undefined;
}

export function emailWirdGeaendert(user: Konto, email: string | null | undefined): email is string {
  return !!email && email.toLowerCase() !== String(user.email || '').toLowerCase();
}

/** Nach bestätigtem Passwort. Eine neue Adresse gilt erst nach dem Link; bis
 * dahin gilt die alte, und die neue belegt nichts. */
export async function profilAendern(
  k: ProfilKontext,
  user: Konto,
  e: ProfilEingabe,
): Promise<{ emailChanged: boolean; emailSent?: boolean }> {
  const nameNeu = !!e.username && e.username.toLowerCase() !== String(user.username || '').toLowerCase();
  const emailNeu = emailWirdGeaendert(user, e.email);
  if (nameNeu || emailNeu) {
    // Jede Vergabeprüfung verrät, ob es ein Konto gibt; die Registrierung verbirgt das.
    const zuOft = await k.konto.kontoGedrosselt('profil-vergabe', user.id, 10, 60 * 60 * 1000);
    if (zuOft) fachfehler('zu_viele', 'zu_viele_anfragen', { minuten: zuOft.waitMin });
    if (nameNeu && e.username && (await k.konto.nameVergeben(e.username, user.id)))
      fachfehler('ungueltig', 'benutzername_vergeben');
  }
  const felder: Record<string, unknown> = {};
  if (e.first_name !== undefined) felder.first_name = e.first_name || null;
  if (e.last_name !== undefined) felder.last_name = e.last_name || null;
  const speichern = async () => {
    if (e.username) await k.konto.aendereBenutzernamen(user.id, e.username);
    await k.konto.aendereNamen(user.id, felder);
  };
  if (!emailNeu) {
    await speichern();
    return { emailChanged: false };
  }
  const email = String(e.email);
  const token = crypto.randomBytes(32).toString('hex');
  await k.konto.merkeEmailNeu(user.id, email, tokenAbdruck(token), new Date(Date.now() + 24 * 60 * 60 * 1000));
  await speichern();
  return { emailChanged: true, emailSent: await adressMails(k, user, email, token) };
}

/** Sprache des Kontos, nicht die Vorgabe. Belegt antwortet wie frei, sonst
 * liessen sich Adressen abfragen; der Inhaber bekommt einen Hinweis statt des Links. */
async function adressMails(k: ProfilKontext, user: Konto, email: string, token: string): Promise<boolean> {
  // Auch die des Inhabers einer Adresse, eines anderen Kontos: im Systemrahmen.
  const sprache = async (uid: number) =>
    String(
      wertOder(
        await versuche(
          'anmeldung:sprache',
          imSystemkontext('adressmail', () => k.einstellungen.getSetting(uid, 'language', 'de')),
        ),
        'de',
      ),
    );
  const lang = await sprache(user.id);
  const basis = mailBasisUrl();
  let gesendet = false;
  const inhaber = await k.konto.kontoMitEmail(email);
  if (inhaber && inhaber.id !== user.id) {
    if (basis)
      gesendet = wertOder(
        await versuche(
          'anmeldung:versuchsmail',
          k.mail.sendRegistrierungsVersuchMail(inhaber.email, await sprache(inhaber.id), 'adresse'),
        ),
        { success: false },
      ).success;
  } else if (basis) {
    gesendet = wertOder(
      await versuche('anmeldung:bestaetigungsmail', k.mail.sendVerificationMail(email, token, basis, lang, 'adresse')),
      { success: false },
    ).success;
  }
  // Die alte Adresse erfährt davon — war es nicht der Inhaber, merkt er es so.
  if (user.email)
    await versuche(
      'anmeldung:hinweis-alte-adresse',
      k.mail.sendEmailGeaendertMail(user.email, user.username, email, lang),
    );
  return gesendet;
}
