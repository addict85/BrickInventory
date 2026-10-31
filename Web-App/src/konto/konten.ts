/** Jeder Weg, der ein Passwort ändert, beendet danach alle Zugänge — an einer
 * Stelle, damit kein Weg den Schritt vergisst. */
import bcrypt from 'bcryptjs';
import * as repo from './repository/konten';
import { BCRYPT_ROUNDS, leereTokenCache, revokeAllSessions, revokeAllTokens } from './auth';

export { aendereProfil, aktivesKontoNachEmail, andereSitzungenBeenden, emailVergeben, kontoExistiert, kontoKurz, kontoNachRuecksetzToken, kontoVoll, legeQrTokenAn, loescheKonto, loeseQrTokenEin, mussPasswortAendern, nameOderEmailVergeben, nameVergeben, raeumeQrTokensAuf, setzeRuecksetzToken, tokenNachKennung, tokenStand, zugaengeDesKontos, zugaengeLoeschen } from './repository/konten';

export async function kontenListe() {
  return repo.alleKonten();
}

export async function profil(id: number) {
  return repo.profilZeile(id);
}

const hashe = (passwort: unknown) => bcrypt.hash(String(passwort), BCRYPT_ROUNDS);

async function zugaengeBeenden(uid: number): Promise<void> {
  await revokeAllTokens(uid);
  await revokeAllSessions(uid);
}

export async function setzeFremdesPasswort(uid: number, passwort: unknown): Promise<boolean> {
  if (!await repo.setzePasswortHash(uid, await hashe(passwort))) return false;
  await zugaengeBeenden(uid);
  return true;
}

/** Auch der gerade benutzte Token fällt: Eine Ausnahme wäre genau die Lücke,
 * über die ein fremder Zugang bliebe. */
export async function aendereEigenesPasswort(uid: number, passwort: unknown): Promise<void> {
  await repo.setzeEigenesPasswort(uid, await hashe(passwort));
  await zugaengeBeenden(uid);
}

/** Der Moment, in dem man einen fremden Zugang loswerden will. */
export async function setzePasswortZurueck(uid: number, passwort: unknown): Promise<void> {
  await repo.setzePasswortNachRuecksetzen(uid, await hashe(passwort));
  await zugaengeBeenden(uid);
}

export async function legeKontoAn(username: string, passwort: unknown, verwalter: boolean): Promise<number | null> {
  return repo.fuegeKontoEin(username, await hashe(passwort), verwalter);
}

export async function registriere(d: { username: string; email: string; first_name?: string | null | undefined;
  last_name?: string | null | undefined; passwort: unknown; tokenHash: string; bis: Date }): Promise<number | null> {
  return repo.registriereKonto({ username: d.username, email: d.email, first_name: d.first_name,
    last_name: d.last_name, hash: await hashe(d.passwort), tokenHash: d.tokenHash, bis: d.bis });
}

/** Ändert sich die Rolle, enden die Browser-Sitzungen: Sie tragen die Rolle
 * seit der Anmeldung. Der Token-Cache wird nur geleert — die App soll die neue
 * Rolle sehen, nicht abgemeldet werden. */
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
