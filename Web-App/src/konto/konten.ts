/** Jeder Weg, der ein Passwort ändert, beendet danach alle Zugänge — an einer
 * Stelle, damit kein Weg den Schritt vergisst. */
import { hashePasswort } from './passwortHash';
import * as repo from './repository/konten';
import { leereTokenCache } from './tokenCache';
import { mitZugangsende, alleSitzungenBeenden, zugangsTransaktion } from './zugangsende';
import { tokenAbdruck, alleTokensWiderrufen } from './geraeteToken';
import { emailGueltig } from '../infra/validate';
import { entferneStartpasswort } from '../infra/startpasswort';
import { verwalterAktionMerken } from './verwalterProtokoll';
import { alsDoppelt, fachfehler, nichtGefunden } from '../infra/fehlerTexte';
import type { ResetSideEffects } from '../mail';
import { hinweisNebenher } from './kontoHinweis';
import { loescheTagesgrenze } from './loginLimiter';
import type { KontoKontext } from './kontext';
import type { UebernahmeArt } from './repository/uebernahmen';

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
  const konten = await k.konten.alleKonten();
  const mitFaktor = await k.factors.activeAmong(konten.map(z => z.id));
  // Angekündigte Änderungen an Verwaltern (24 h): Die übrigen Verwalter sollen sie sehen, nicht nur per Mail.
  const angekuendigt = new Map<number, { type: UebernahmeArt; effective_at: string }[]>();
  for (const a of await k.uebernahmen.angekuendigte())
    angekuendigt.set(a.target_id, [
      ...(angekuendigt.get(a.target_id) ?? []),
      { type: a.type, effective_at: new Date(a.effective_at).toISOString() },
    ]);
  return konten.map(z => ({ ...z, zweiter_faktor: mitFaktor.has(z.id), angekuendigt: angekuendigt.get(z.id) ?? [] }));
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

/** Verwalterrechte trägt das Passwort allein nicht; ein Passkey ersetzt TOTP hier nicht. */
export async function faktorPflichtOffen(k: KontoKontext, uid: number, verwalter: boolean): Promise<boolean> {
  return verwalter && !(await k.factors.isActive(uid));
}

/** Der Schritt „Konto“ der Einrichtung: Es gibt eines, und ein Verwalter hat das Startpasswort ersetzt. */
export async function kontoEingerichtet(k: KontoKontext, verwalter: boolean): Promise<boolean> {
  const s = await k.einrichtung.kontenStand();
  return s.vorhanden && (!verwalter || !s.startpasswort);
}

export function passwortWechselFaellig(k: KontoKontext, id: number): Promise<boolean> {
  return k.konten.mussPasswortAendern(id);
}

const hashe = (passwort: string) => hashePasswort(passwort);

export async function zugaengeBeenden(k: KontoKontext, uid: number): Promise<void> {
  await alleTokensWiderrufen(k, uid);
  await alleSitzungenBeenden(k, uid);
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
    if (o.passkeysWiderrufen) await t.factors.revokePasskeys(uid);
  });
  await startpasswortErledigt(k, uid);
}

/** Der Link trägt den Token im Klartext; gespeichert ist nur sein Hash. */
export function passwortPerLinkSetzen(k: KontoKontext, token: string, passwort: string): Promise<number | null> {
  return setzePasswortZurueck(k, tokenAbdruck(token), passwort);
}

/** Hier will man einen Eindringling loswerden: Passkeys, Hauptkonten über diesem Konto, offene
 * Einladungen und ein Adresswechsel fallen mit (beim normalen Wechsel nicht: den löst der
 * angemeldete Inhaber aus). @returns das Konto, oder null, wenn der Link schon verbraucht oder abgelaufen ist */
export async function setzePasswortZurueck(
  k: KontoKontext,
  tokenHash: string,
  passwort: string,
): Promise<number | null> {
  const hash = await hashe(passwort);
  const r = await mitZugangsende(
    k,
    (e: { uid: number; geloest: ResetSideEffects } | null) => e?.uid ?? null,
    async t => {
      const uid = (await t.konten.setzePasswortNachRuecksetzen(tokenHash, hash))?.id;
      if (!uid) return null;
      await zugaengeBeenden(t, uid);
      await t.factors.revokePasskeys(uid);
      const haushalt = await t.haushalt.fremdzugriffLoesen(uid);
      const adresse = await t.konten.verwirfAusstehendeAdresse(uid);
      await loescheTagesgrenze(t, uid);
      return { uid, geloest: { haushalt: haushalt.hauptkonten, einladungen: haushalt.einladungen, adresse } };
    },
  );
  if (!r) return null;
  k.haushalt.meldeHaushaltsaenderung();
  await startpasswortErledigt(k, r.uid);
  hinweisNebenher(k, r.uid, 'passwort_zurueckgesetzt', undefined, { geloest: r.geloest });
  return r.uid;
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
  return zugangsTransaktion(k, async t => {
    // Auch gegen die Adressen: Die Anmeldung sucht in beiden Spalten.
    if (await t.konten.nameVergeben(username, 0)) return null;
    const neu = await t.konten.fuegeKontoEin(username, hash, alsVerwalter);
    if (neu === null) return null;
    await verwalterAktionMerken(t, verwalter, neu, 'konto_angelegt');
    if (alsVerwalter) await verwalterAktionMerken(t, verwalter, neu, 'verwalter_ernannt');
    return neu;
  }).catch(alsDoppelt('benutzername_vergeben'));
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
export async function setzeAktiv(k: KontoKontext, uid: number, soll: boolean): Promise<{ geaendert: boolean }> {
  const r = await zugangsTransaktion(k, t => t.konten.schreibeAktiv(uid, soll));
  if (!r) nichtGefunden('benutzer_nicht_gefunden');
  if (r === repo.LETZTER_VERWALTER) fachfehler('konflikt', 'letzter_verwalter');
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
): Promise<{ geaendert: boolean }> {
  const vorher = await zugangsTransaktion(k, t => t.konten.setzeVerwalter(uid, soll));
  if (!vorher) nichtGefunden('benutzer_nicht_gefunden');
  if (vorher === repo.LETZTER_VERWALTER) fachfehler('konflikt', 'letzter_verwalter');
  const geaendert = vorher.vorher !== soll;
  if (geaendert) {
    await alleSitzungenBeenden(k, uid);
    leereTokenCache(k);
  }
  return { geaendert };
}
