/** Jeder Weg, der ein Passwort ändert, beendet danach alle Zugänge — an einer
 * Stelle, damit kein Weg den Schritt vergisst. */
import { hashePasswort } from './bcryptSchranke';
import * as repo from './repository/konten';
import * as passkeyRepo from './repository/passkeys';
import { BCRYPT_ROUNDS, leereTokenCache, revokeAllSessions, revokeAllTokens } from './auth';
import { erhoeheSitzungsVersion } from './sitzungsVersion';
import { emailGueltig } from '../infra/validate';
import { entferneStartpasswort } from '../infra/startpasswort';

export { LETZTER_VERWALTER, aendereProfil, aktivesKontoNachEmail, emailVergeben, erneuereEmailTokenWennFrei, kontoExistiert, kontoKurz, kontoMitEmail, kontoNachRuecksetzToken, kontoVoll, loescheEigenesKonto, loescheKonto, merkeEmailNeu, mussPasswortAendern, nameVergeben, nameZuEmailToken, offeneRegistrierungen, schalteRegistrierungFrei, setzeRuecksetzTokenWennFrei, tokenStand, zugaengeDesKontos, zugaengeLoeschen } from './repository/konten';

/** Die neue Version schreibt der Aufrufer in die Sitzung, die bleibt. */
export async function andereSitzungenBeenden(uid: number, eigeneSid: string): Promise<{ beendet: number; version: number }> {
  const version = await erhoeheSitzungsVersion(uid);
  return { beendet: await repo.loescheAndereSitzungen(uid, eigeneSid), version };
}

/** Nur melden, nichts ändern: Welche Adresse gemeint war, weiss nur der Inhaber. */
export async function meldeUngueltigeAdressen(): Promise<number[]> {
  const ids = (await repo.alleAdressen()).filter(z => !emailGueltig(z.email)).map(z => z.id);
  if (ids.length) console.warn(`⚠️  [konto] ${ids.length} Konto/Konten mit einer E-Mail-Adresse, die keine einzelne reine Adresse ist `
    + `(IDs ${ids.join(', ')}). An sie geht keine Mail; Adresse im Konto neu eintragen oder das Konto löschen (UPGRADE.md).`);
  return ids;
}

/** H5: Eine Adresse aus dem Altbestand, die nie bestätigt wurde, gilt nicht mehr; der Inhaber muss es wissen. */
export async function meldeAusstehendeAdressen(): Promise<number[]> {
  const ids = await repo.ausstehendOhneLink();
  if (ids.length) console.warn(`⚠️  [konto] ${ids.length} Konto/Konten mit einer nie bestätigten Adresse (IDs ${ids.join(', ')}). `
    + 'Sie gilt erst nach Bestätigung; im Profil neu eintragen, dann kommt der Link (UPGRADE.md).');
  return ids;
}

export async function kontenListe() {
  return repo.alleKonten();
}

export async function profil(id: number) {
  return repo.profilZeile(id);
}

const hashe = (passwort: unknown) => hashePasswort(passwort, BCRYPT_ROUNDS);

async function zugaengeBeenden(uid: number): Promise<void> {
  await revokeAllTokens(uid);
  await revokeAllSessions(uid);
}

async function startpasswortErledigt(uid: number): Promise<void> {
  if ((await repo.kontoKurz(uid))?.is_admin) entferneStartpasswort();
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
  await startpasswortErledigt(uid);
  if (o.passkeysWiderrufen) await passkeyRepo.loescheAlleDesKontos(uid);
}

/** Hier will man einen fremden Zugang loswerden; deshalb fallen auch alle Passkeys. */
export async function setzePasswortZurueck(uid: number, passwort: unknown): Promise<void> {
  await repo.setzePasswortNachRuecksetzen(uid, await hashe(passwort));
  await zugaengeBeenden(uid);
  await startpasswortErledigt(uid);
  await passkeyRepo.loescheAlleDesKontos(uid);
}

/** Dieselbe Rechenzeit wie registriere(): Die Antwortzeit verriete sonst eine vergebene Adresse. */
export async function rechneWieRegistrierung(passwort: unknown): Promise<void> {
  await hashe(passwort);
}

/** Länger als jeder Bestätigungslink gilt; danach sind Name und Adresse wieder frei. */
export const REGISTRIERUNG_FRIST_TAGE = 7;
export function raeumeOffeneRegistrierungenAuf(): Promise<number> {
  return repo.loescheOffeneRegistrierungen(REGISTRIERUNG_FRIST_TAGE);
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
export async function setzeAktiv(uid: number, soll: boolean): Promise<{ geaendert: boolean } | typeof repo.LETZTER_VERWALTER | null> {
  const r = await repo.schreibeAktiv(uid, soll);
  if (!r) return null;
  if (r === repo.LETZTER_VERWALTER) return r;
  if (!soll) await zugaengeBeenden(uid);
  return { geaendert: r.vorher !== soll };
}

/** Ändert sich die Rolle, enden die Browser-Sitzungen: Sie tragen die Rolle
 * seit der Anmeldung. Der Token-Cache wird nur geleert — die App soll die neue
 * Rolle sehen, nicht abgemeldet werden. */
export async function setzeVerwalterRolle(uid: number, soll: boolean): Promise<{ geaendert: boolean } | typeof repo.LETZTER_VERWALTER | null> {
  const vorher = await repo.setzeVerwalter(uid, soll);
  if (!vorher) return null;
  if (vorher === repo.LETZTER_VERWALTER) return vorher;
  const geaendert = vorher.vorher !== soll;
  if (geaendert) {
    await revokeAllSessions(uid);
    leereTokenCache();
  }
  return { geaendert };
}
