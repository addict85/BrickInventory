/** Der Inhaber erfährt per Mail, wenn sich an seinen Zugängen etwas ändert:
 * Ein Eindringling, der Passwort oder Passkey setzt, bliebe sonst unbemerkt. */
import type { KontoHinweis } from '../mail';
import { logAndContinue, meldeUndLiefere } from '../infra/fehler';
import { imSystemkontext } from '../infra/kontoKontext';
import type { KontoKontext } from './kontext';

type Angaben = { name?: string | undefined; konto?: string | undefined; durch?: string | undefined };

// Läuft auch vor der Anmeldung und für andere Konten (alle Verwalter): Sprache
// und Haushalt des Empfängers liest es daher im Systemrahmen.
export function meldeKontoaenderung(
  k: KontoKontext,
  uid: number,
  art: KontoHinweis,
  angaben: Angaben = {},
): Promise<boolean> {
  return imSystemkontext('kontohinweis', () => meldeKontoaenderungFuer(k, uid, art, angaben));
}

async function meldeKontoaenderungFuer(
  kx: KontoKontext,
  uid: number,
  art: KontoHinweis,
  angaben: Angaben,
): Promise<boolean> {
  if (!(await kx.mail.mailEingerichtet())) return false;
  const k = await kx.konten.profilZeile(uid);
  if (!k?.email) return false;
  const lang = String(await kx.einstellungen.getSetting(uid, 'language', 'de'));
  const haushalt = (await kx.haushalt.haushaltsStand(uid)).parents.map(p => p.username);
  const r = await kx.mail.sendKontoHinweisMail(k.email, k.username, art, {
    lang,
    haushalt,
    ...(angaben.name ? { passkey: angaben.name } : {}),
    konto: angaben.konto,
    durch: angaben.durch,
  });
  return r.success;
}

/** Nebenher: Die Antwort wartet nicht auf den Mailserver, und ein Fehler macht die Änderung nicht rückgängig. */
export function hinweisNebenher(
  k: KontoKontext,
  uid: number,
  art: KontoHinweis,
  name?: string,
  angaben: Angaben = {},
): void {
  // Auch ohne Mailadresse eine Spur im Protokoll; ohne Namen und Label, die frei getippt sind.
  console.info(`[konto] ${art}`, { ereignis: art, konto: uid });
  meldeKontoaenderung(k, uid, art, { ...angaben, name }).catch(logAndContinue(`konto:hinweismail ${art}`));
}

/** An alle Verwalter: Keiner soll unbemerkt einen Verwalter ernennen oder Schutz abbauen. */
export function verwalterHinweisNebenher(k: KontoKontext, art: KontoHinweis, angaben: Angaben): void {
  k.konten
    .aktiveVerwalter()
    .then(ids => Promise.all(ids.map(id => meldeKontoaenderung(k, id, art, angaben))))
    .catch(logAndContinue(`konto:verwalterhinweis ${art}`));
}

/** Nach dem Beitritt erfährt der Inhaber per Mail, wem er sich angeschlossen hat; nebenher,
 * damit die Antwort nicht auf den Mailserver wartet. */
export async function haushaltBeitreten(k: KontoKontext, uid: number, code: string) {
  const r = await k.haushalt.einladungEinloesen(uid, code);
  if ('fehler' in r) return r;
  const ich = await k.konten.profilZeile(uid);
  if (ich?.email) {
    const sprache = await k.einstellungen
      .getSetting(uid, 'language', 'de')
      .catch(meldeUndLiefere('einstellungen:sprache', 'de'));
    void k.mail
      .sendHaushaltVerknuepftMail(ich.email, ich.username, r.linked_to.username, String(sprache ?? 'de'))
      .catch(logAndContinue('haushalt:hinweismail'));
  }
  return r;
}
