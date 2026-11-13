/** Jeder Weg, der ein Passwort ändert, beendet danach alle Zugänge — an einer
 * Stelle, damit kein Weg den Schritt vergisst. */
import { hashePasswort } from './bcryptSchranke';
import * as repo from './repository/konten';
import { BCRYPT_ROUNDS } from './anmeldepruefung';
import { leereTokenCache } from './tokenCache';
import { mitZugangsende, revokeAllSessions } from './zugangsende';
import { revokeAllTokens } from './geraeteToken';
import { erhoeheSitzungsVersion } from './sitzungsVersion';
import { emailGueltig } from '../infra/validate';
import { entferneStartpasswort } from '../infra/startpasswort';
import { kontoBereich } from './prozess';
import { protokolliere } from './verwalterProtokoll';
import { alsDoppelt } from '../infra/fehlerTexte';

export { LETZTER_VERWALTER } from './repository/konten';

/** Die neue Version schreibt der Aufrufer in die Sitzung, die bleibt. */
export async function andereSitzungenBeenden(
  uid: number,
  eigeneSid: string,
): Promise<{ beendet: number; version: number }> {
  const version = await erhoeheSitzungsVersion(uid);
  return { beendet: await kontoBereich().konten.loescheAndereSitzungen(uid, eigeneSid), version };
}

/** Nur melden, nichts ändern: Welche Adresse gemeint war, weiss nur der Inhaber. */
export async function meldeUngueltigeAdressen(): Promise<number[]> {
  const ids = (await kontoBereich().konten.alleAdressen()).filter(z => !emailGueltig(z.email)).map(z => z.id);
  if (ids.length)
    console.warn(
      `⚠️  [konto] ${ids.length} Konto/Konten mit einer E-Mail-Adresse, die keine einzelne reine Adresse ist ` +
        `(IDs ${ids.join(', ')}). An sie geht keine Mail; Adresse im Konto neu eintragen oder das Konto löschen (UPGRADE.md).`,
    );
  return ids;
}

/** H5: Eine Adresse aus dem Altbestand, die nie bestätigt wurde, gilt nicht mehr; der Inhaber muss es wissen. */
export async function meldeAusstehendeAdressen(): Promise<number[]> {
  const ids = await kontoBereich().konten.ausstehendOhneLink();
  if (ids.length)
    console.warn(
      `⚠️  [konto] ${ids.length} Konto/Konten mit einer nie bestätigten Adresse (IDs ${ids.join(', ')}). ` +
        'Sie gilt erst nach Bestätigung; im Profil neu eintragen, dann kommt der Link (UPGRADE.md).',
    );
  return ids;
}

export async function kontenListe() {
  return kontoBereich().konten.alleKonten();
}

export async function profil(id: number) {
  return kontoBereich().konten.profilZeile(id);
}

export function kontoKurz(id: number) {
  return kontoBereich().konten.kontoKurz(id);
}

export function kontoVoll(id: number) {
  return kontoBereich().konten.kontoVoll(id);
}

export function kontoExistiert(id: number): Promise<boolean> {
  return kontoBereich().konten.kontoExistiert(id);
}

/** Für Hinweise an Verwalter: Ein gerade gelöschtes Konto heisst wenigstens nach seiner ID. */
export async function kontoName(id: number): Promise<string> {
  return (await kontoBereich().konten.kontoKurz(id))?.username ?? String(id);
}

export function mussPasswortAendern(id: number): Promise<boolean> {
  return kontoBereich().konten.mussPasswortAendern(id);
}

const hashe = (passwort: string) => hashePasswort(passwort, BCRYPT_ROUNDS);

async function zugaengeBeenden(uid: number): Promise<void> {
  await revokeAllTokens(uid);
  await revokeAllSessions(uid);
}

async function startpasswortErledigt(uid: number): Promise<void> {
  if ((await kontoBereich().konten.kontoKurz(uid))?.is_admin) entferneStartpasswort();
}

/** Passwort, Zugänge und Protokolleintrag des Verwalters `durch` zusammen oder gar nicht. */
export async function setzeFremdesPasswort(
  uid: number,
  passwort: string,
  durch: number | null = null,
): Promise<boolean> {
  const hash = await hashe(passwort);
  return mitZugangsende(uid, async () => {
    if (!(await kontoBereich().konten.setzePasswortHash(uid, hash))) return false;
    await zugaengeBeenden(uid);
    if (durch !== null) await protokolliere(durch, uid, 'passwort_gesetzt');
    return true;
  });
}

/** Auch der gerade benutzte Token fällt. Passkeys nur auf Wunsch: Wer sein
 * Passwort bloss erneuert, soll seine Geräte nicht neu einrichten müssen. */
export async function aendereEigenesPasswort(
  uid: number,
  passwort: string,
  o: { passkeysWiderrufen?: boolean } = {},
): Promise<void> {
  const hash = await hashe(passwort);
  await mitZugangsende(uid, async () => {
    await kontoBereich().konten.setzeEigenesPasswort(uid, hash);
    await zugaengeBeenden(uid);
    if (o.passkeysWiderrufen) await kontoBereich().passkeys.loescheAlleDesKontos(uid);
  });
  await startpasswortErledigt(uid);
}

/** Hier will man einen fremden Zugang loswerden; deshalb fallen auch alle Passkeys.
 * @returns das Konto, oder null, wenn der Link schon verbraucht oder abgelaufen ist */
export async function setzePasswortZurueck(tokenHash: string, passwort: string): Promise<number | null> {
  const hash = await hashe(passwort);
  const konto = await mitZugangsende(
    (id: number | null) => id,
    async () => {
      const uid = (await kontoBereich().konten.setzePasswortNachRuecksetzen(tokenHash, hash))?.id;
      if (!uid) return null;
      await zugaengeBeenden(uid);
      await kontoBereich().passkeys.loescheAlleDesKontos(uid);
      return uid;
    },
  );
  if (konto) await startpasswortErledigt(konto);
  return konto;
}

/** Dieselbe Rechenzeit wie registriere(): Die Antwortzeit verriete sonst eine vergebene Adresse. */
export async function rechneWieRegistrierung(passwort: string): Promise<void> {
  await hashe(passwort);
}

/** Länger als jeder Bestätigungslink gilt; danach sind Name und Adresse wieder frei. */
export const REGISTRIERUNG_FRIST_TAGE = 7;
export function raeumeOffeneRegistrierungenAuf(): Promise<number> {
  return kontoBereich().konten.loescheOffeneRegistrierungen(REGISTRIERUNG_FRIST_TAGE);
}

/** Konto und Protokolleintrag in einer Transaktion: Ein Konto ohne Eintrag
 * verschwiege, wer es angelegt hat. Gehasht wird vorher, damit bcrypt keine
 * Verbindung hält. @returns die neue ID, oder null, wenn der Name vergeben ist */
export async function legeKontoAn(
  verwalter: number,
  username: string,
  passwort: string,
  alsVerwalter: boolean,
): Promise<number | null> {
  const hash = await hashe(passwort);
  return kontoBereich()
    .db.transaction(async () => {
      // Auch gegen die Adressen: Die Anmeldung sucht in beiden Spalten.
      if (await kontoBereich().konten.nameVergeben(username, 0)) return null;
      const neu = await kontoBereich().konten.fuegeKontoEin(username, hash, alsVerwalter);
      if (neu === null) return null;
      await protokolliere(verwalter, neu, 'konto_angelegt');
      if (alsVerwalter) await protokolliere(verwalter, neu, 'verwalter_ernannt');
      return neu;
    })
    .catch(alsDoppelt('benutzername_vergeben'));
}

export async function registriere(d: {
  username: string;
  email: string;
  first_name?: string | null | undefined;
  last_name?: string | null | undefined;
  passwort: string;
  tokenHash: string;
  bis: Date;
}): Promise<number | null> {
  return kontoBereich().konten.registriereKonto({
    username: d.username,
    email: d.email,
    first_name: d.first_name,
    last_name: d.last_name,
    hash: await hashe(d.passwort),
    tokenHash: d.tokenHash,
    bis: d.bis,
  });
}

/** Erst sperren, dann Zugänge löschen (die Token-Abfrage prüft is_active). Sitzungen
 * fallen über die Sitzungsversion, auch eine wieder geschriebene Zeile. */
export async function setzeAktiv(
  uid: number,
  soll: boolean,
): Promise<{ geaendert: boolean } | typeof repo.LETZTER_VERWALTER | null> {
  const r = await kontoBereich().konten.schreibeAktiv(uid, soll);
  if (!r) return null;
  if (r === repo.LETZTER_VERWALTER) return r;
  if (!soll) await zugaengeBeenden(uid);
  return { geaendert: r.vorher !== soll };
}

/** Ändert sich die Rolle, enden die Browser-Sitzungen: Sie tragen die Rolle
 * seit der Anmeldung. Der Token-Cache wird nur geleert — die App soll die neue
 * Rolle sehen, nicht abgemeldet werden. */
export async function setzeVerwalterRolle(
  uid: number,
  soll: boolean,
): Promise<{ geaendert: boolean } | typeof repo.LETZTER_VERWALTER | null> {
  const vorher = await kontoBereich().konten.setzeVerwalter(uid, soll);
  if (!vorher) return null;
  if (vorher === repo.LETZTER_VERWALTER) return vorher;
  const geaendert = vorher.vorher !== soll;
  if (geaendert) {
    await revokeAllSessions(uid);
    leereTokenCache();
  }
  return { geaendert };
}
