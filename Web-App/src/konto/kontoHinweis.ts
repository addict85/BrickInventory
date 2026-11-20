/** Der Inhaber erfährt per Mail, wenn sich an seinen Zugängen etwas ändert:
 * Ein Eindringling, der Passwort oder Passkey setzt, bliebe sonst unbemerkt. */
import type { ResetSideEffects, AccountNotice } from '../mail';
import { logAndContinue, reportAndDeliver } from '../infra/fehler';
import { inSystemContext } from '../infra/kontoKontext';
import type { AccountContext } from './kontext';

type Angaben = {
  name?: string | undefined;
  konto?: string | undefined;
  durch?: string | undefined;
  was?: string | undefined;
  bis?: string | undefined;
  resolved?: ResetSideEffects | undefined;
  abbruch?: string | undefined;
  freigabe?: string | undefined;
  adresse?: string | undefined;
};

// Läuft auch vor der Anmeldung und für andere Konten (alle Verwalter): Sprache
// und Haushalt des Empfängers liest es daher im Systemrahmen.
export function reportAccountChange(
  k: AccountContext,
  uid: number,
  art: AccountNotice,
  angaben: Angaben = {},
): Promise<boolean> {
  return inSystemContext('kontohinweis', () => reportAccountChangeFor(k, uid, art, angaben));
}

async function reportAccountChangeFor(
  kx: AccountContext,
  uid: number,
  art: AccountNotice,
  angaben: Angaben,
): Promise<boolean> {
  if (!(await kx.mail.mailConfigured())) return false;
  const k = await kx.konten.profileRow(uid);
  if (!k?.email) return false;
  const lang = String(await kx.einstellungen.userValue(uid, 'language', 'de'));
  const haushalt = (await kx.haushalt.householdStatus(uid)).parents.map(p => p.username);
  const r = await kx.mail.mailAccountNotice(k.email, k.username, art, {
    lang,
    haushalt,
    ...(angaben.name ? { passkey: angaben.name } : {}),
    konto: angaben.konto,
    durch: angaben.durch,
    was: angaben.was,
    bis: angaben.bis,
    resolved: angaben.resolved,
    abbruch: angaben.abbruch,
    freigabe: angaben.freigabe,
    adresse: angaben.adresse,
  });
  return r.success;
}

/** Nebenher: Die Antwort wartet nicht auf den Mailserver, und ein Fehler macht die Änderung nicht rückgängig. */
export function hintInBackground(
  k: AccountContext,
  uid: number,
  art: AccountNotice,
  name?: string,
  angaben: Angaben = {},
): void {
  // Auch ohne Mailadresse eine Spur im Protokoll; ohne Namen und Label, die frei getippt sind.
  console.info(`[konto] ${art}`, { ereignis: art, konto: uid });
  reportAccountChange(k, uid, art, { ...angaben, name }).catch(logAndContinue(`konto:hinweismail ${art}`));
}

/** An alle Verwalter: Keiner soll unbemerkt einen Verwalter ernennen oder Schutz abbauen. */
export function adminHintInBackground(k: AccountContext, art: AccountNotice, angaben: Angaben): void {
  k.konten
    .activeAdmin()
    .then(ids => Promise.all(ids.map(id => reportAccountChange(k, id, art, angaben))))
    .catch(logAndContinue(`konto:verwalterhinweis ${art}`));
}

/** Nach dem Beitritt erfährt der Inhaber per Mail, wem er sich angeschlossen hat; nebenher,
 * damit die Antwort nicht auf den Mailserver wartet. */
export async function joinHousehold(k: AccountContext, uid: number, code: string) {
  const r = await k.haushalt.redeemInvitation(uid, code);
  const ich = await k.konten.profileRow(uid);
  if (ich?.email) {
    const sprache = await k.einstellungen
      .userValue(uid, 'language', 'de')
      .catch(reportAndDeliver('einstellungen:sprache', 'de'));
    void k.mail
      .mailHouseholdLinked(ich.email, ich.username, r.linked_to.username, String(sprache ?? 'de'))
      .catch(logAndContinue('haushalt:hinweismail'));
  }
  return r;
}
