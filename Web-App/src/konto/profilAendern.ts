/** Profil des eigenen Kontos: Name, Benutzername und Adresse. Eine neue Adresse gilt erst
 * nach dem Link; die Mails gehen über den Mailbereich. */
import crypto from 'node:crypto';
import { mailBasisUrl } from '../infra/basisUrl';
import { fachfehler } from '../infra/fehlerTexte';
import { versuche, valueOr } from '../infra/ergebnis';
import { inSystemContext } from '../infra/kontoKontext';
import { tokenDigest } from './geraeteToken';
import { accountThrottled } from './zielDrossel';
import type { Konto as AccountRow } from './repository/konten';
import type { AccountContext } from './kontext';

type Konto = AccountRow;
export interface ProfileInput {
  username?: string | undefined;
  email?: string | null | undefined;
  first_name?: string | null | undefined;
  last_name?: string | null | undefined;
}

export function emailBecomesChanged(user: Konto, email: string | null | undefined): email is string {
  return !!email && email.toLowerCase() !== String(user.email || '').toLowerCase();
}

/** Nach bestätigtem Passwort. Eine neue Adresse gilt erst nach dem Link; bis
 * dahin gilt die alte, und die neue belegt nichts. */
export async function profilAendern(
  k: AccountContext,
  user: Konto,
  e: ProfileInput,
): Promise<{ emailChanged: boolean; emailSent?: boolean }> {
  const nameNew = !!e.username && e.username.toLowerCase() !== String(user.username || '').toLowerCase();
  const emailNeu = emailBecomesChanged(user, e.email);
  if (nameNew || emailNeu) {
    // Jede Vergabeprüfung verrät, ob es ein Konto gibt; die Registrierung verbirgt das.
    const zuOft = await accountThrottled(k, 'profil-vergabe', user.id, 10, 60 * 60 * 1000);
    if (zuOft) fachfehler('zu_viele', 'zu_viele_anfragen', { minuten: zuOft.waitMin });
    if (nameNew && e.username && (await k.konten.nameTaken(e.username, user.id)))
      fachfehler('ungueltig', 'benutzername_vergeben');
  }
  const felder: Record<string, unknown> = {};
  if (e.first_name !== undefined) felder.first_name = e.first_name || null;
  if (e.last_name !== undefined) felder.last_name = e.last_name || null;
  const speichern = async () => {
    if (e.username) await k.konten.changeUsernames(user.id, e.username);
    await k.konten.changeNames(user.id, felder);
  };
  if (!emailNeu) {
    await speichern();
    return { emailChanged: false };
  }
  const email = String(e.email);
  const token = crypto.randomBytes(32).toString('hex');
  await k.konten.rememberEmailNew(user.id, email, tokenDigest(token), new Date(k.uhr.jetzt() + 24 * 60 * 60 * 1000));
  await speichern();
  return { emailChanged: true, emailSent: await adressMails(k, user, email, token) };
}

/** Sprache des Kontos, nicht die Vorgabe. Belegt antwortet wie frei, sonst
 * liessen sich Adressen abfragen; der Inhaber bekommt einen Hinweis statt des Links. */
async function adressMails(k: AccountContext, user: Konto, email: string, token: string): Promise<boolean> {
  // Auch die des Inhabers einer Adresse, eines anderen Kontos: im Systemrahmen.
  const sprache = async (uid: number) =>
    String(
      valueOr(
        await versuche(
          'anmeldung:sprache',
          inSystemContext('adressmail', () => k.einstellungen.userValue(uid, 'language', 'de')),
        ),
        'de',
      ),
    );
  const lang = await sprache(user.id);
  const basis = mailBasisUrl();
  let gesendet = false;
  const inhaber = await k.konten.accountWithEmail(email);
  if (inhaber && inhaber.id !== user.id) {
    if (basis)
      gesendet = valueOr(
        await versuche(
          'anmeldung:versuchsmail',
          k.mail.mailRegistrationAttempt(inhaber.email, await sprache(inhaber.id), 'adresse'),
        ),
        { success: false },
      ).success;
  } else if (basis) {
    gesendet = valueOr(
      await versuche('anmeldung:bestaetigungsmail', k.mail.mailVerification(email, token, basis, lang, 'adresse')),
      { success: false },
    ).success;
  }
  // Die alte Adresse erfährt davon — war es nicht der Inhaber, merkt er es so.
  if (user.email)
    await versuche('anmeldung:hinweis-alte-adresse', k.mail.mailEmailChanged(user.email, user.username, email, lang));
  return gesendet;
}
