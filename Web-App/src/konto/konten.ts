/**
 * Konten: Passwörter setzen und Rollen ändern. Jeder Weg, der ein Passwort
 * ändert, beendet danach alle Zugänge des Kontos — an einer Stelle, damit
 * kein Weg den Schritt vergisst. Die schlichten Abfragen reicht der Dienst
 * an die Routen weiter, die das Repository nicht kennen dürfen.
 */
import bcrypt from 'bcryptjs';
import * as repo from './repository/konten';
import { BCRYPT_ROUNDS, leereTokenCache, revokeAllSessions, revokeAllTokens } from './auth';

export { aendereProfil, aktivesKontoNachEmail, andereSitzungenBeenden, emailVergeben, kontoExistiert, kontoKurz, kontoNachRuecksetzToken, kontoVoll, legeQrTokenAn, loescheKonto, loeseQrTokenEin, mussPasswortAendern, nameOderEmailVergeben, nameVergeben, raeumeQrTokensAuf, setzeRuecksetzToken, tokenNachKennung, tokenStand, zugaengeDesKontos, zugaengeLoeschen } from './repository/konten';

/**
 * Die Antwortform der Konten — die eine Stelle, an der Ja/Nein der Datenbank
 * (BOOLEAN) als 0/1 hinausgeht, wie vor der Umstellung der Spalten. Die App
 * liest email_verified als Zahl; echte Wahrheitswerte kommen mit dem
 * gemeinsamen API-Schema.
 */
const alsApiZahl = (ja: boolean): 0 | 1 => (ja ? 1 : 0);

/** Alle Konten für die Verwaltung; is_admin als 0/1. */
export async function kontenListe() {
  return (await repo.alleKonten()).map(k => ({ ...k, is_admin: alsApiZahl(k.is_admin) }));
}

/** Das eigene Profil; email_verified als 0/1. */
export async function profil(id: number) {
  const p = await repo.profilZeile(id);
  return p && { ...p, email_verified: alsApiZahl(p.email_verified) };
}

const hashe = (passwort: unknown) => bcrypt.hash(String(passwort), BCRYPT_ROUNDS);

async function zugaengeBeenden(uid: number): Promise<void> {
  await revokeAllTokens(uid);
  await revokeAllSessions(uid);
}

/** Ein Verwalter setzt das Passwort eines anderen Kontos. @returns ob es das Konto gab */
export async function setzeFremdesPasswort(uid: number, passwort: unknown): Promise<boolean> {
  if (!await repo.setzePasswortHash(uid, await hashe(passwort))) return false;
  await zugaengeBeenden(uid);
  return true;
}

/**
 * Eigenes Passwort ändern. Auch der gerade benutzte Token fällt: Eine Ausnahme
 * für ihn wäre genau die Lücke, über die ein fremder Zugang bliebe.
 */
export async function aendereEigenesPasswort(uid: number, passwort: unknown): Promise<void> {
  await repo.setzeEigenesPasswort(uid, await hashe(passwort));
  await zugaengeBeenden(uid);
}

/** Zurücksetzen per E-Mail-Token: der Moment, in dem man einen fremden Zugang loswerden will. */
export async function setzePasswortZurueck(uid: number, passwort: unknown): Promise<void> {
  await repo.setzePasswortNachRuecksetzen(uid, await hashe(passwort));
  await zugaengeBeenden(uid);
}

/** @returns die neue Kennung, oder null, wenn der Name vergeben ist */
export async function legeKontoAn(username: string, passwort: unknown, verwalter: boolean): Promise<number | null> {
  return repo.fuegeKontoEin(username, await hashe(passwort), verwalter);
}

export async function registriere(d: { username: string; email: string; first_name?: string | null | undefined;
  last_name?: string | null | undefined; passwort: unknown; tokenHash: string; bis: Date }): Promise<number | null> {
  return repo.registriereKonto({ username: d.username, email: d.email, first_name: d.first_name,
    last_name: d.last_name, hash: await hashe(d.passwort), tokenHash: d.tokenHash, bis: d.bis });
}

/**
 * Verwalterrolle setzen. Ändert sie sich, enden die Browser-Sitzungen des
 * Kontos: Die Sitzung trägt die Rolle seit der Anmeldung und wird nie
 * nachgeführt. Der Token-Cache wird nur geleert — die App soll die neue Rolle
 * sehen, nicht abgemeldet werden.
 * @returns null, wenn es das Konto nicht gibt; sonst ob sich die Rolle geändert hat
 */
export async function setzeVerwalterRolle(uid: number, soll: boolean): Promise<{ geaendert: boolean } | null> {
  const vorher = await repo.verwalterVorher(uid);
  if (!vorher) return null;
  const geaendert = vorher.is_admin !== soll;
  await repo.setzeVerwalter(uid, soll);
  if (geaendert) {
    await revokeAllSessions(uid);
    leereTokenCache();
  }
  return { geaendert };
}
