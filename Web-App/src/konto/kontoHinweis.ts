/** Der Inhaber erfährt per Mail, wenn sich an seinen Zugängen etwas ändert:
 * Ein Eindringling, der Passwort oder Passkey setzt, bliebe sonst unbemerkt. */
import { mailEingerichtet, sendKontoHinweisMail } from '../infra/mailer';
import type { KontoHinweis } from '../infra/mailer';
import { logAndContinue } from '../infra/httpError';
import { householdStatus } from '../haushalt/haushalt';
import { profil } from './konten';
import { getSetting } from './settings';

export async function meldeKontoaenderung(uid: number, art: KontoHinweis, passkey?: string): Promise<boolean> {
  if (!await mailEingerichtet()) return false;
  const k = await profil(uid);
  if (!k?.email) return false;
  const lang = String(await getSetting(uid, 'language', 'de'));
  const haushalt = (await householdStatus(uid)).parents.map(p => p.username);
  const r = await sendKontoHinweisMail(k.email, k.username, art, { lang, haushalt, ...(passkey ? { passkey } : {}) });
  return r.success;
}

/** Nebenher: Die Antwort wartet nicht auf den Mailserver, und ein Fehler macht die Änderung nicht rückgängig. */
export function hinweisNebenher(uid: number, art: KontoHinweis, passkey?: string): void {
  meldeKontoaenderung(uid, art, passkey).catch(logAndContinue(`konto:hinweismail ${art}`));
}
