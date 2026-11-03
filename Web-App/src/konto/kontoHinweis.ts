/** Der Inhaber erfährt per Mail, wenn sich an seinen Zugängen etwas ändert:
 * Ein Eindringling, der Passwort oder Passkey setzt, bliebe sonst unbemerkt. */
import { mailEingerichtet, sendKontoHinweisMail } from '../infra/mailer';
import type { KontoHinweis } from '../infra/mailer';
import { logAndContinue } from '../infra/httpError';
import { householdStatus } from '../haushalt/haushalt';
import { profil } from './konten';
import { getSetting } from './settings';
import { aktiveVerwalter } from './repository/konten';

type Angaben = { name?: string | undefined; konto?: string | undefined; durch?: string | undefined };

export async function meldeKontoaenderung(uid: number, art: KontoHinweis, angaben: Angaben = {}): Promise<boolean> {
  if (!await mailEingerichtet()) return false;
  const k = await profil(uid);
  if (!k?.email) return false;
  const lang = String(await getSetting(uid, 'language', 'de'));
  const haushalt = (await householdStatus(uid)).parents.map(p => p.username);
  const r = await sendKontoHinweisMail(k.email, k.username, art, { lang, haushalt,
    ...(angaben.name ? { passkey: angaben.name } : {}), konto: angaben.konto, durch: angaben.durch });
  return r.success;
}

/** Nebenher: Die Antwort wartet nicht auf den Mailserver, und ein Fehler macht die Änderung nicht rückgängig. */
export function hinweisNebenher(uid: number, art: KontoHinweis, name?: string, angaben: Angaben = {}): void {
  meldeKontoaenderung(uid, art, { ...angaben, name }).catch(logAndContinue(`konto:hinweismail ${art}`));
}

/** An alle Verwalter: Keiner soll unbemerkt einen Verwalter ernennen oder Schutz abbauen. */
export function verwalterHinweisNebenher(art: KontoHinweis, angaben: Angaben): void {
  aktiveVerwalter()
    .then(ids => Promise.all(ids.map(id => meldeKontoaenderung(id, art, angaben))))
    .catch(logAndContinue(`konto:verwalterhinweis ${art}`));
}
