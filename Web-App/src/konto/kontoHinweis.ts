/** Der Inhaber erfährt per Mail, wenn sich an seinen Zugängen etwas ändert:
 * Ein Eindringling, der Passwort oder Passkey setzt, bliebe sonst unbemerkt. */
import { mailEingerichtet, sendKontoHinweisMail } from '../mail/mailer';
import type { KontoHinweis } from '../mail/mailer';
import { logAndContinue } from '../infra/fehler';
import { householdStatus } from '../haushalt/haushalt';
import { getSetting } from '../einstellungen/settings';
import { kontoBereich } from './prozess';

type Angaben = { name?: string | undefined; konto?: string | undefined; durch?: string | undefined };

export async function meldeKontoaenderung(uid: number, art: KontoHinweis, angaben: Angaben = {}): Promise<boolean> {
  if (!await mailEingerichtet()) return false;
  const k = await kontoBereich().konten.profilZeile(uid);
  if (!k?.email) return false;
  const lang = String(await getSetting(uid, 'language', 'de'));
  const haushalt = (await householdStatus(uid)).parents.map(p => p.username);
  const r = await sendKontoHinweisMail(k.email, k.username, art, { lang, haushalt,
    ...(angaben.name ? { passkey: angaben.name } : {}), konto: angaben.konto, durch: angaben.durch });
  return r.success;
}

/** Nebenher: Die Antwort wartet nicht auf den Mailserver, und ein Fehler macht die Änderung nicht rückgängig. */
export function hinweisNebenher(uid: number, art: KontoHinweis, name?: string, angaben: Angaben = {}): void {
  // Auch ohne Mailadresse eine Spur im Protokoll; ohne Namen und Label, die frei getippt sind.
  console.info(`[konto] ${art}`, { ereignis: art, konto: uid });
  meldeKontoaenderung(uid, art, { ...angaben, name }).catch(logAndContinue(`konto:hinweismail ${art}`));
}

/** An alle Verwalter: Keiner soll unbemerkt einen Verwalter ernennen oder Schutz abbauen. */
export function verwalterHinweisNebenher(art: KontoHinweis, angaben: Angaben): void {
  kontoBereich().konten.aktiveVerwalter()
    .then(ids => Promise.all(ids.map(id => meldeKontoaenderung(id, art, angaben))))
    .catch(logAndContinue(`konto:verwalterhinweis ${art}`));
}
