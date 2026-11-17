/** Die Adresse kommt als Wert; welche eine Anfrage hat, entscheidet die HTTP-Schicht. */
import crypto from 'node:crypto';
import { einzelwert } from '../infra/validate';
import { meldeUndLiefere } from '../infra/fehler';
import { suchwert } from '../infra/geheimnis';
import { fachfehler, type FehlerCode } from '../infra/fehlerTexte';
import type { KontoKontext } from './kontext';
import { drosselAdresse } from '../infra/drosselAdresse';

export const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

/** Je Konto über alle Adressen, verdoppelnd: Ein Angreifer rät rund 15 Mal je Viertelstunde,
 * der Inhaber wartet nach einem Vertipper Sekunden statt einer festen Sperre. */
export function wartezeitSekunden(fehlversuche: number): number {
  if (fehlversuche < MAX_ATTEMPTS) return 0;
  return Math.min(2 ** (fehlversuche - MAX_ATTEMPTS), WINDOW_MS / 1000);
}
/** Über ALLE Namen: Die Grenze je Konto liesse sonst Password-Spraying zu. */
export const MAX_JE_ADRESSE = 30;
const BEKANNT_MIN = 30 * 24 * 60;
const WINDOW_MIN = WINDOW_MS / 60000;
/** Ein reservierter Platz, dessen Prüfung nie gemeldet wurde, verfällt danach. */
const LAUFEND_VERFALL_S = 60;

// einzelwert(): Kommt der Name doppelt an, liefert Express ein Array.
const _key = (ip: string, name: string) => `login|${drosselAdresse(ip)}|${einzelwert(name).toLowerCase()}`;
const _adressKey = (ip: string) => `login-adresse|${drosselAdresse(ip)}`;
const _nameKey = (name: string) => `login-name|${einzelwert(name).toLowerCase()}`;
/** Die Bekannt-Zeile lebt 30 Tage und die Tabelle liest die Leserolle: Dort steht
 * nur der HMAC der Adresse; er bleibt für dieselbe Adresse gleich und zählt weiter. */
function adressAbdruck(ip: string): string {
  return suchwert('anmeldeadresse', drosselAdresse(ip));
}
const _bekanntKey = (ip: string, name: string) =>
  `login-bekannt|${adressAbdruck(ip)}|${einzelwert(name).toLowerCase()}`;
const _erfolgKey = (ip: string, kennung: string) => `login-erfolg|${adressAbdruck(ip)}|${kennung}`;

/** Name und E-Mail eines Kontos zählen gemeinsam, sonst gälte jede Grenze doppelt.
 * Klein schreibt PostgreSQL wie beim Login: JS macht aus „İ" zwei Zeichen. */
async function kontoKennung(k: KontoKontext, username: string): Promise<string> {
  // Ausnahme: Bei gestörter Datenbank zählt die Drossel im Speicher weiter
  // (inMemory); ohne Konto dann nach dem Namen, statt die Anmeldung zu sperren.
  const z = await k.konten.kontoZumNamen(einzelwert(username)).catch(meldeUndLiefere('anmeldung:konto-kennung', null));
  if (z?.id) return `konto:${z.id}`;
  return `name:${namensAbdruck(z?.kennung ?? einzelwert(username).toLowerCase())}`;
}

/** Ein unbekannter Name ist oft ein vertipptes Passwort, und die Tabelle liest die
 * Leserolle: nur der HMAC, der für denselben Namen gleich bleibt und weiter zählt. */
function namensAbdruck(name: string): string {
  return suchwert('anmeldename', name);
}

export type Sperre = { code: FehlerCode; vars: { minuten: number } };

/** Belegt den Versuch; anmeldungGescheitert, anmeldungGelungen oder gibAnmeldeplatzFrei geben ihn frei. */
export async function anmeldungErlaubt(k: KontoKontext, ip: string, username: string): Promise<Sperre | null> {
  const kennung = await kontoKennung(k, username);
  // Bekannt: nur die Sperre je Adresse und Konto. Gesamtsperre und Wartezeit liessen sich sonst
  // gegen den Inhaber richten, hinter einem Proxy teilen sich alle eine Adresse.
  const bekannt = !!(await k.throttle.counterState(_bekanntKey(ip, kennung), BEKANNT_MIN));
  const gesamt = await k.throttle.reserve(
    _adressKey(ip),
    WINDOW_MIN,
    LAUFEND_VERFALL_S,
    s => bekannt || s.count + s.laufend < MAX_JE_ADRESSE,
  );
  if (!gesamt.ok) return { code: 'zu_viele_fehlversuche', vars: { minuten: gesamt.stand.waitMin } };
  const adresse = await k.throttle.reserve(
    _key(ip, kennung),
    WINDOW_MIN,
    LAUFEND_VERFALL_S,
    s => s.count + s.laufend < MAX_ATTEMPTS,
  );
  if (!adresse.ok) {
    await k.throttle.releaseSlot(_adressKey(ip));
    return { code: 'zu_viele_fehlversuche', vars: { minuten: adresse.stand.waitMin } };
  }
  if (bekannt) return null;
  let rest = 0;
  const konto = await k.throttle.reserve(_nameKey(kennung), WINDOW_MIN, LAUFEND_VERFALL_S, s => {
    rest = wartezeitSekunden(s.count) - s.seitLetztem;
    // In der Wartezeit-Phase höchstens ein Versuch zugleich je Konto.
    return rest <= 0 && (s.count < MAX_ATTEMPTS || s.laufend === 0);
  });
  if (!konto.ok) {
    await k.throttle.releaseSlot(_key(ip, kennung));
    await k.throttle.releaseSlot(_adressKey(ip));
    return { code: 'zu_viele_fehlversuche', vars: { minuten: Math.max(1, Math.ceil(Math.max(rest, 1) / 60)) } };
  }
  return null;
}

export async function gibAnmeldeplatzFrei(k: KontoKontext, ip: string, username: string): Promise<void> {
  const kennung = await kontoKennung(k, username);
  await k.throttle.releaseSlot(_key(ip, kennung));
  await k.throttle.releaseSlot(_nameKey(kennung));
  await k.throttle.releaseSlot(_adressKey(ip));
}

/** @returns die Fehlversuche des Kontos im Fenster und ob die Tagesgrenze gerade erreicht ist */
export async function anmeldungGescheitert(
  k: KontoKontext,
  ip: string,
  username: string,
): Promise<{ n: number; tagesgrenze: boolean }> {
  const kennung = await kontoKennung(k, username);
  await k.throttle.countAttempt(_key(ip, kennung), WINDOW_MIN);
  const n = await k.throttle.countAttempt(_nameKey(kennung), WINDOW_MIN);
  await k.throttle.countAttempt(_adressKey(ip), WINDOW_MIN);
  const tag = await k.throttle.countAttempt(await _tagKey(k, ip, kennung), KONTO_FENSTER_MIN);
  return { n, tagesgrenze: tag === MAX_JE_KONTO_TAG };
}

/** Eine bekannte Adresse umgeht die Bremse je Konto; wer dort sitzt, riete sonst 480 Mal am Tag.
 * Darüber gilt das Passwort nur mit zweitem Faktor; Passkey und „Passwort vergessen“ bleiben
 * offen, das Zurücksetzen leert den Zähler. Bekannte Adressen zählen je für sich: Sonst
 * sperrte ein Fremder mit 50 Versuchen den Inhaber auch an seinen eigenen Geräten aus. */
export const MAX_JE_KONTO_TAG = 50;
async function _tagKey(k: KontoKontext, ip: string, kennung: string): Promise<string> {
  const eigen =
    !!(await k.throttle.counterState(_bekanntKey(ip, kennung), BEKANNT_MIN)) ||
    !!(await k.throttle.counterState(_freigabeKey(kennung, adressAbdruck(ip)), KONTO_FENSTER_MIN));
  return eigen ? `login-tag|${kennung}|${adressAbdruck(ip)}` : `login-tag|${kennung}`;
}

/** Über der Tagesgrenze sperrte ein Fremder den Inhaber an jedem neuen Ort aus: Ein signierter, einmal
 * gültiger Link lässt die Adresse der gesperrten Anmeldung einen Tag lang wie eine bekannte zählen. */
const _freigabeKey = (kennung: string, abdruck: string) => `login-freigabe|${kennung}|${abdruck}`;
const freigabeSignatur = (uid: number, abdruck: string, bis: number) =>
  suchwert('anmeldefreigabe', `${uid}|${abdruck}|${bis}`);
export function freigabeToken(k: KontoKontext, ip: string, uid: number): string {
  const abdruck = adressAbdruck(ip);
  const bis = Math.floor(k.uhr.jetzt() / 1000) + KONTO_FENSTER_MIN * 60;
  return `${uid}.${abdruck}.${bis}.${freigabeSignatur(uid, abdruck, bis)}`;
}
export async function anmeldungFreigeben(k: KontoKontext, token: string): Promise<void> {
  const [u, abdruck = '', b, sig = ''] = String(token).split('.');
  const uid = Number(u),
    bis = Number(b);
  const soll = Number.isInteger(uid) && Number.isInteger(bis) ? freigabeSignatur(uid, abdruck, bis) : '';
  const echt = soll.length === sig.length && crypto.timingSafeEqual(Buffer.from(soll), Buffer.from(sig));
  if (!echt || bis * 1000 <= k.uhr.jetzt()) fachfehler('konflikt', 'freigabe_link_ungueltig');
  if ((await k.throttle.countAttempt(`login-freigabe-benutzt|${sig}`, KONTO_FENSTER_MIN)) > 1)
    fachfehler('konflikt', 'freigabe_link_ungueltig');
  await k.throttle.countAttempt(_freigabeKey(`konto:${uid}`, abdruck), KONTO_FENSTER_MIN);
}
export async function tagesgrenzeErreicht(k: KontoKontext, ip: string, username: string): Promise<boolean> {
  const key = await _tagKey(k, ip, await kontoKennung(k, username));
  return ((await k.throttle.counterState(key, KONTO_FENSTER_MIN))?.count ?? 0) >= MAX_JE_KONTO_TAG;
}
export async function loescheTagesgrenze(k: KontoKontext, uid: number): Promise<void> {
  await k.throttle.forgetCounter(`login-tag|konto:${uid}`, { auchDarunter: true });
}

export type Anmeldeereignis =
  | 'anmeldung_fehlgeschlagen'
  | 'anmeldung_gesperrt'
  | 'anmeldung_tagesgrenze'
  | 'zweiter_faktor_falsch'
  | 'bestaetigung_fehlgeschlagen'
  | 'bestaetigung_gesperrt'
  | 'bestaetigung_gebremst';
/** Eine Warnzeile je Ereignis für Protokoll, app_logs und fail2ban; nie Passwort, Code
 * oder eingegebener Name, denn im Namensfeld landet auch einmal ein Passwort. */
export function meldeAnmeldeereignis(
  ereignis: Anmeldeereignis,
  angaben: { ip?: string; konto?: number | null; art?: Bremse; zugang?: string },
): void {
  const { ip, konto, ...rest } = angaben;
  console.warn(`[anmeldung] ${ereignis}`, {
    ereignis,
    ...(ip ? { adresse: drosselAdresse(ip) } : {}),
    konto: konto ?? 'unbekannt',
    ...rest,
  });
}

/** Erst der Erfolg zeigt, ob nach Fehlversuchen jemand hineinkam, und von wo; nie der Name. */
export type Anmeldeweg = 'passwort' | 'passwort+code' | 'passwort+passkey' | 'passkey' | 'qr';
export function meldeAnmeldung(angaben: { ip?: string | undefined; konto: number; zugang: Anmeldeweg }): void {
  const { ip, konto, zugang } = angaben;
  console.info('[anmeldung] anmeldung_erfolgreich', {
    ereignis: 'anmeldung_erfolgreich',
    ...(ip ? { adresse: drosselAdresse(ip) } : {}),
    konto,
    zugang,
  });
}

export async function anmeldungGelungen(k: KontoKontext, ip: string, username: string): Promise<void> {
  const kennung = await kontoKennung(k, username);
  await k.throttle.forgetCounter(_key(ip, kennung));
  await k.throttle.forgetCounter(_nameKey(kennung));
  // Nur freigeben: Ein Erfolg setzt den Zähler der Adresse nach Fehlversuchen gegen andere Konten nicht zurück.
  await k.throttle.releaseSlot(_adressKey(ip));
  await k.throttle.countAttempt(_bekanntKey(ip, kennung), BEKANNT_MIN);
  await k.throttle.countAttempt(_erfolgKey(ip, kennung), WINDOW_MIN);
}

/** Weiche Grenze: Wer sich öfter anmeldet, verliert nur den Vorrang. Eine harte träfe
 * den Inhaber, und gegen die Last wirken schon Sperren und Schranke. */
export const ERFOLGE_MIT_VORRANG = 30;

/** Diese Adresse hat sich mit diesem Namen zuletzt angemeldet, und nicht zu oft. */
export async function bekannteAnmeldung(k: KontoKontext, ip: string, username: string): Promise<boolean> {
  const kennung = await kontoKennung(k, username);
  if (!(await k.throttle.counterState(_bekanntKey(ip, kennung), BEKANNT_MIN))) return false;
  return ((await k.throttle.counterState(_erfolgKey(ip, kennung), WINDOW_MIN))?.count ?? 0) < ERFOLGE_MIT_VORRANG;
}

/** Jeder unbekannte Name legt eine Zeile an; ohne Aufräumen wüchse die Tabelle mit jedem Rateversuch. */
export async function raeumeAnmeldezaehlerAuf(k: KontoKontext): Promise<number> {
  return k.throttle.cleanUp(BEKANNT_MIN);
}

export function zaehleAnfrage(
  k: KontoKontext,
  bucket: string,
  ip: string,
  windowMs: number,
): Promise<{ count: number; waitMin: number }> {
  return k.throttle.countInWindow(`${bucket}|${drosselAdresse(ip)}`, windowMs / 60000);
}

/** Je Konto und Zugang: Ein erbeuteter Zugang sperrt nicht die Notbremsen des Inhabers.
 * Codes zählen getrennt und länger; nur ein richtiger Code setzt sie zurück. */
export type Bremse = 'passwort' | 'faktor';
const FAKTOR_FENSTER_MIN = 60;
const _bestaetigungKey = (art: Bremse, uid: number, zugang: string) =>
  `${art === 'faktor' ? 'faktor' : 'passwort'}-bestaetigen|${uid}|${zugang}`;
const fenster = (art: Bremse) => (art === 'faktor' ? FAKTOR_FENSTER_MIN : WINDOW_MIN);

/** Über alle Zugänge eines Kontos, damit mehrere erbeutete Zugänge nicht mehrfach raten;
 * gesperrt werden nur Zugänge, die selbst falsch geraten haben. */
export const MAX_BESTAETIGUNG_JE_KONTO = 20;
const KONTO_FENSTER_MIN = 24 * 60;
const _kontoBestaetigungKey = (art: Bremse, uid: number) =>
  `${art === 'faktor' ? 'faktor' : 'passwort'}-bestaetigen-konto|${uid}`;

export async function bestaetigungGesperrt(
  k: KontoKontext,
  art: Bremse,
  uid: number,
  zugang: string,
): Promise<Sperre | null> {
  const konto = await k.throttle.counterState(_kontoBestaetigungKey(art, uid), KONTO_FENSTER_MIN);
  const kontoVoll = !!konto && konto.count >= MAX_BESTAETIGUNG_JE_KONTO;
  const r = await k.throttle.reserve(
    _bestaetigungKey(art, uid, zugang),
    fenster(art),
    LAUFEND_VERFALL_S,
    s => s.count + s.laufend < MAX_ATTEMPTS && !(kontoVoll && s.count > 0),
  );
  if (r.ok) return null;
  const minuten = kontoVoll && r.stand.count < MAX_ATTEMPTS ? konto!.waitMin : r.stand.waitMin;
  return { code: 'zu_viele_fehlversuche', vars: { minuten } };
}
/** @returns true, wenn dieser Fehlversuch eine Bremse (Zugang oder Konto) gerade erreicht hat */
export async function bestaetigungFehlgeschlagen(
  k: KontoKontext,
  art: Bremse,
  uid: number,
  zugang: string,
): Promise<boolean> {
  const jeZugang = await k.throttle.countAttempt(_bestaetigungKey(art, uid, zugang), fenster(art));
  const jeKonto = await k.throttle.countAttempt(_kontoBestaetigungKey(art, uid), KONTO_FENSTER_MIN);
  return jeZugang === MAX_ATTEMPTS || jeKonto === MAX_BESTAETIGUNG_JE_KONTO;
}
export async function bestaetigungGelungen(k: KontoKontext, art: Bremse, uid: number, zugang: string): Promise<void> {
  await k.throttle.forgetCounter(_bestaetigungKey(art, uid, zugang));
}

/** Wer das Passwort kennt, riete den Code sonst langsam unter jeder Wartezeit durch;
 * über der Schranke (24 h je Konto) gelten nur Wiederherstellungscode und Passkey. */
export const MAX_FAKTOR_ANMELDUNG_JE_KONTO = 20;
const _faktorAnmeldungKey = (uid: number) => `faktor-anmeldung-konto|${uid}`;
export async function faktorCodeGesperrt(k: KontoKontext, uid: number): Promise<boolean> {
  return (
    ((await k.throttle.counterState(_faktorAnmeldungKey(uid), KONTO_FENSTER_MIN))?.count ?? 0) >=
    MAX_FAKTOR_ANMELDUNG_JE_KONTO
  );
}
/** @returns true, wenn dieser Fehlversuch die Schranke gerade erreicht hat */
export async function faktorCodeFalsch(k: KontoKontext, uid: number): Promise<boolean> {
  return (await k.throttle.countAttempt(_faktorAnmeldungKey(uid), KONTO_FENSTER_MIN)) === MAX_FAKTOR_ANMELDUNG_JE_KONTO;
}
