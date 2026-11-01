/** Jeder Weg, der ein Passwort ändert, beendet danach alle Zugänge — an einer
 * Stelle, damit kein Weg den Schritt vergisst. */
import bcrypt from 'bcryptjs';
import * as repo from './repository/konten';
import * as passkeyRepo from './repository/passkeys';
import { BCRYPT_ROUNDS, leereTokenCache, revokeAllSessions, revokeAllTokens } from './auth';
import { erhoeheSitzungsVersion } from './sitzungsVersion';

export { aendereProfil, aktivesKontoNachEmail, emailVergeben, kontoExistiert, kontoKurz, kontoMitEmail, kontoNachRuecksetzToken, kontoVoll, legeQrTokenAn, loescheKonto, loeseQrTokenEin, mussPasswortAendern, nameVergeben, raeumeQrTokensAuf, setzeRuecksetzTokenWennFrei, tokenStand, zugaengeDesKontos, zugaengeLoeschen } from './repository/konten';

/** Die neue Version schreibt der Aufrufer in die Sitzung, die bleibt. */
export async function andereSitzungenBeenden(uid: number, eigeneSid: string): Promise<{ beendet: number; version: number }> {
  const version = await erhoeheSitzungsVersion(uid);
  return { beendet: await repo.andereSitzungenBeenden(uid, eigeneSid), version };
}

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

/** Auch der gerade benutzte Token fällt. Passkeys nur auf Wunsch: Wer sein
 * Passwort bloss erneuert, soll seine Geräte nicht neu einrichten müssen. */
export async function aendereEigenesPasswort(uid: number, passwort: unknown,
                                             o: { passkeysWiderrufen?: boolean } = {}): Promise<void> {
  await repo.setzeEigenesPasswort(uid, await hashe(passwort));
  await zugaengeBeenden(uid);
  if (o.passkeysWiderrufen) await passkeyRepo.loescheAlleDesKontos(uid);
}

/** Hier will man einen fremden Zugang loswerden; deshalb fallen auch alle Passkeys. */
export async function setzePasswortZurueck(uid: number, passwort: unknown): Promise<void> {
  await repo.setzePasswortNachRuecksetzen(uid, await hashe(passwort));
  await zugaengeBeenden(uid);
  await passkeyRepo.loescheAlleDesKontos(uid);
}

/** Dieselbe Rechenzeit wie registriere(): Die Antwortzeit verriete sonst eine vergebene Adresse. */
export async function rechneWieRegistrierung(passwort: unknown): Promise<void> {
  await hashe(passwort);
}

export async function legeKontoAn(username: string, passwort: unknown, verwalter: boolean): Promise<number | null> {
  return repo.fuegeKontoEin(username, await hashe(passwort), verwalter);
}

export async function registriere(d: { username: string; email: string; first_name?: string | null | undefined;
  last_name?: string | null | undefined; passwort: unknown; tokenHash: string; bis: Date }): Promise<number | null> {
  return repo.registriereKonto({ username: d.username, email: d.email, first_name: d.first_name,
    last_name: d.last_name, hash: await hashe(d.passwort), tokenHash: d.tokenHash, bis: d.bis });
}

/** Erst sperren, dann Zugänge löschen (die Token-Abfrage prüft is_active). Sitzungen
 * fallen über die Sitzungsversion, auch eine wieder geschriebene Zeile. */
export async function setzeAktiv(uid: number, soll: boolean): Promise<{ geaendert: boolean } | null> {
  const r = await repo.schreibeAktiv(uid, soll);
  if (!r) return null;
  if (!soll) await zugaengeBeenden(uid);
  return { geaendert: r.vorher !== soll };
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
