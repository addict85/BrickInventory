/** Jeder Weg, der ein Passwort ändert, beendet danach alle Zugänge — an einer
 * Stelle, damit kein Weg den Schritt vergisst. */
import { hashePasswort } from './passwortHash';
import * as repo from './repository/konten';
import { leereTokenCache } from './tokenCache';
import { mitZugangsende, revokeAllSessions, zugangsTransaktion } from './zugangsende';
import { hashToken, revokeAllTokens } from './geraeteToken';
import { erhoeheSitzungsVersion } from './sitzungsVersion';
import { emailGueltig } from '../infra/validate';
import { entferneStartpasswort } from '../infra/startpasswort';
import { verwalterAktionMerken } from './verwalterProtokoll';
import { alsDoppelt } from '../infra/fehlerTexte';
import type { KontoKontext } from './kontext';

export { LETZTER_VERWALTER } from './repository/konten';

/** Die neue Version schreibt der Aufrufer in die Sitzung, die bleibt. */
export async function andereSitzungenBeenden(
  k: KontoKontext,
  uid: number,
  eigeneSid: string,
): Promise<{ beendet: number; version: number }> {
  const version = await erhoeheSitzungsVersion(k, uid);
  return { beendet: await k.konten.loescheAndereSitzungen(uid, eigeneSid), version };
}

/** Nur melden, nichts ändern: Welche Adresse gemeint war, weiss nur der Inhaber. */
export async function meldeUngueltigeAdressen(k: KontoKontext): Promise<number[]> {
  const ids = (await k.konten.alleAdressen()).filter(z => !emailGueltig(z.email)).map(z => z.id);
  if (ids.length)
    console.warn(
      `⚠️  [konto] ${ids.length} Konto/Konten mit einer E-Mail-Adresse, die keine einzelne reine Adresse ist ` +
        `(IDs ${ids.join(', ')}). An sie geht keine Mail; Adresse im Konto neu eintragen oder das Konto löschen (UPGRADE.md).`,
    );
  return ids;
}

/** H5: Eine Adresse aus dem Altbestand, die nie bestätigt wurde, gilt nicht mehr; der Inhaber muss es wissen. */
export async function meldeAusstehendeAdressen(k: KontoKontext): Promise<number[]> {
  const ids = await k.konten.ausstehendOhneLink();
  if (ids.length)
    console.warn(
      `⚠️  [konto] ${ids.length} Konto/Konten mit einer nie bestätigten Adresse (IDs ${ids.join(', ')}). ` +
        'Sie gilt erst nach Bestätigung; im Profil neu eintragen, dann kommt der Link (UPGRADE.md).',
    );
  return ids;
}

export async function kontenListe(k: KontoKontext) {
  return k.konten.alleKonten();
}

export async function profil(k: KontoKontext, id: number) {
  return k.konten.profilZeile(id);
}

export function kontoKurzVon(k: KontoKontext, id: number) {
  return k.konten.kontoKurz(id);
}

export function kontoVollVon(k: KontoKontext, id: number) {
  return k.konten.kontoVoll(id);
}

export function gibtKonto(k: KontoKontext, id: number): Promise<boolean> {
  return k.konten.kontoExistiert(id);
}

/** Für Hinweise an Verwalter: Ein gerade gelöschtes Konto heisst wenigstens nach seiner ID. */
export async function kontoAnzeigeName(k: KontoKontext, id: number): Promise<string> {
  return (await k.konten.kontoKurz(id))?.username ?? String(id);
}

export function passwortWechselFaellig(k: KontoKontext, id: number): Promise<boolean> {
  return k.konten.mussPasswortAendern(id);
}

const hashe = (passwort: string) => hashePasswort(passwort);

async function zugaengeBeenden(k: KontoKontext, uid: number): Promise<void> {
  await revokeAllTokens(k, uid);
  await revokeAllSessions(k, uid);
}

async function startpasswortErledigt(k: KontoKontext, uid: number): Promise<void> {
  if ((await k.konten.kontoKurz(uid))?.is_admin) entferneStartpasswort();
}

/** Passwort, Zugänge und Protokolleintrag des Verwalters `durch` zusammen oder gar nicht. */
export async function setzeFremdesPasswort(
  k: KontoKontext,
  uid: number,
  passwort: string,
  durch: number | null = null,
): Promise<boolean> {
  const hash = await hashe(passwort);
  return mitZugangsende(k, uid, async t => {
    if (!(await t.konten.setzePasswortHash(uid, hash))) return false;
    await zugaengeBeenden(t, uid);
    if (durch !== null) await verwalterAktionMerken(t, durch, uid, 'passwort_gesetzt');
    return true;
  });
}

/** Auch der gerade benutzte Token fällt. Passkeys nur auf Wunsch: Wer sein
 * Passwort bloss erneuert, soll seine Geräte nicht neu einrichten müssen. */
export async function aendereEigenesPasswort(
  k: KontoKontext,
  uid: number,
  passwort: string,
  o: { passkeysWiderrufen?: boolean } = {},
): Promise<void> {
  const hash = await hashe(passwort);
  await mitZugangsende(k, uid, async t => {
    await t.konten.setzeEigenesPasswort(uid, hash);
    await zugaengeBeenden(t, uid);
    if (o.passkeysWiderrufen) await t.passkeys.loescheAlleDesKontos(uid);
  });
  await startpasswortErledigt(k, uid);
}

/** Der Link trägt den Token im Klartext; gespeichert ist nur sein Hash. */
export function passwortPerLinkSetzen(k: KontoKontext, token: string, passwort: string): Promise<number | null> {
  return setzePasswortZurueck(k, hashToken(token), passwort);
}

/** Hier will man einen fremden Zugang loswerden; deshalb fallen auch alle Passkeys.
 * @returns das Konto, oder null, wenn der Link schon verbraucht oder abgelaufen ist */
export async function setzePasswortZurueck(
  k: KontoKontext,
  tokenHash: string,
  passwort: string,
): Promise<number | null> {
  const hash = await hashe(passwort);
  const konto = await mitZugangsende(
    k,
    (id: number | null) => id,
    async t => {
      const uid = (await t.konten.setzePasswortNachRuecksetzen(tokenHash, hash))?.id;
      if (!uid) return null;
      await zugaengeBeenden(t, uid);
      await t.passkeys.loescheAlleDesKontos(uid);
      return uid;
    },
  );
  if (konto) await startpasswortErledigt(k, konto);
  return konto;
}

/** Dieselbe Rechenzeit wie registriere(): Die Antwortzeit verriete sonst eine vergebene Adresse. */
export async function rechneWieRegistrierung(passwort: string): Promise<void> {
  await hashe(passwort);
}

/** Länger als jeder Bestätigungslink gilt; danach sind Name und Adresse wieder frei. */
export const REGISTRIERUNG_FRIST_TAGE = 7;
export function raeumeOffeneRegistrierungenAuf(k: KontoKontext): Promise<number> {
  return zugangsTransaktion(k, t => t.konten.loescheOffeneRegistrierungen(REGISTRIERUNG_FRIST_TAGE));
}

/** Konto und Protokolleintrag in einer Transaktion: Ein Konto ohne Eintrag
 * verschwiege, wer es angelegt hat. Gehasht wird vorher, damit bcrypt keine
 * Verbindung hält. @returns die neue ID, oder null, wenn der Name vergeben ist */
export async function legeKontoAn(
  k: KontoKontext,
  verwalter: number,
  username: string,
  passwort: string,
  alsVerwalter: boolean,
): Promise<number | null> {
  const hash = await hashe(passwort);
  return k
    .transaktion(async t => {
      // Auch gegen die Adressen: Die Anmeldung sucht in beiden Spalten.
      if (await t.konten.nameVergeben(username, 0)) return null;
      const neu = await t.konten.fuegeKontoEin(username, hash, alsVerwalter);
      if (neu === null) return null;
      await verwalterAktionMerken(t, verwalter, neu, 'konto_angelegt');
      if (alsVerwalter) await verwalterAktionMerken(t, verwalter, neu, 'verwalter_ernannt');
      return neu;
    })
    .catch(alsDoppelt('benutzername_vergeben'));
}

export async function registriere(
  k: KontoKontext,
  d: {
    username: string;
    email: string;
    first_name?: string | null | undefined;
    last_name?: string | null | undefined;
    passwort: string;
    tokenHash: string;
    bis: Date;
  },
): Promise<number | null> {
  return k.konten.registriereKonto({
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
  k: KontoKontext,
  uid: number,
  soll: boolean,
): Promise<{ geaendert: boolean } | typeof repo.LETZTER_VERWALTER | null> {
  const r = await zugangsTransaktion(k, t => t.konten.schreibeAktiv(uid, soll));
  if (!r) return null;
  if (r === repo.LETZTER_VERWALTER) return r;
  if (!soll) await zugaengeBeenden(k, uid);
  return { geaendert: r.vorher !== soll };
}

/** Ändert sich die Rolle, enden die Browser-Sitzungen: Sie tragen die Rolle
 * seit der Anmeldung. Der Token-Cache wird nur geleert — die App soll die neue
 * Rolle sehen, nicht abgemeldet werden. */
export async function setzeVerwalterRolle(
  k: KontoKontext,
  uid: number,
  soll: boolean,
): Promise<{ geaendert: boolean } | typeof repo.LETZTER_VERWALTER | null> {
  const vorher = await zugangsTransaktion(k, t => t.konten.setzeVerwalter(uid, soll));
  if (!vorher) return null;
  if (vorher === repo.LETZTER_VERWALTER) return vorher;
  const geaendert = vorher.vorher !== soll;
  if (geaendert) {
    await revokeAllSessions(k, uid);
    leereTokenCache(k);
  }
  return { geaendert };
}
