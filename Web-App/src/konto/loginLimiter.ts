/** Die Funktionen nehmen die Adresse als Wert; welche Adresse eine Anfrage
 * hat, entscheidet die HTTP-Schicht. */
import { createHash } from 'node:crypto';
import { isIPv4, isIPv6 } from 'node:net';
import { einzelwert } from '../infra/validate';
import { fehlertext, meldeUndLiefere } from '../infra/fehler';
import { suchwert } from '../infra/geheimnis';
import type { FehlerCode } from '../infra/fehlerTexte';
import * as repo from './repository/anmeldezaehler';
import { kontoBereich } from './prozess';

/** Typisiert, weil ein vertippter Feldname `undefined >= MAX_ATTEMPTS` ergäbe
 * — `false`, also keine Sperre. */
interface Zaehlerstand {
  count: number;
  waitMin: number;
  seitLetztem: number;
}

export const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

/** Je KONTO über alle Adressen, verdoppelnd: Wer viele Adressen hat, rät nur
 * noch rund 15 Mal je Viertelstunde; der Inhaber wartet bei einem Vertipper
 * Sekunden statt einer festen Sperre. */
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

type Eintrag = { count: number; firstAt: number; lastAt: number | null; laufend: number };
/** Rückfall, falls die Datenbank klemmt: Die Bremse soll dann nicht offen stehen. */
const _attempts = new Map<string, Eintrag>();

/** Der Rückfall zählt nur je Prozess: melden, aber höchstens einmal je Minute. */
let _gemeldetAm = 0;
function imSpeicher(wo: string, e: unknown): void {
  if (Date.now() - _gemeldetAm < 60_000) return;
  _gemeldetAm = Date.now();
  console.warn(`[anmeldung] Zähler im Prozessspeicher statt in der Datenbank (${wo}): ${fehlertext(e)}`);
}

/** Ein IPv6-Anschluss bekommt ein ganzes /64; je Adresse gezählt, wäre jede
 * Bremse mit einer neuen Adresse aus dem eigenen Netz umgangen. IPv4 in IPv6
 * (::ffff:a.b.c.d) zählt als IPv4. Alles andere (`konto:7`) bleibt, wie es ist. */
export function drosselAdresse(ip: string): string {
  const v4 = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (v4 && isIPv4(v4[1]!)) return v4[1]!;
  if (!isIPv6(ip)) return ip;
  const [links = '', rechts = ''] = ip.toLowerCase().split('::');
  const l = links ? links.split(':') : [],
    r = rechts ? rechts.split(':') : [];
  const gruppen = ip.includes('::') ? [...l, ...Array(8 - l.length - r.length).fill('0'), ...r] : l;
  return (
    gruppen
      .slice(0, 4)
      .map(g => g.replace(/^0+(?=.)/, ''))
      .join(':') + '::/64'
  );
}

// einzelwert(): Kommt der Name doppelt an, liefert Express ein Array.
const _key = (ip: string, name: string) => `login|${drosselAdresse(ip)}|${einzelwert(name).toLowerCase()}`;
const _adressKey = (ip: string) => `login-adresse|${drosselAdresse(ip)}`;
const _nameKey = (name: string) => `login-name|${einzelwert(name).toLowerCase()}`;
/** Die Bekannt-Zeile lebt 30 Tage und die Tabelle liest die Leserolle: Dort steht
 * nur der HMAC der Adresse; er bleibt für dieselbe Adresse gleich und zählt weiter. */
function adressAbdruck(ip: string): string {
  const a = drosselAdresse(ip);
  try {
    return suchwert('anmeldeadresse', a);
  } catch {
    return createHash('sha256').update(`brickinventory/anmeldeadresse/${a}`).digest('hex');
  }
}
const _bekanntKey = (ip: string, name: string) =>
  `login-bekannt|${adressAbdruck(ip)}|${einzelwert(name).toLowerCase()}`;
const _erfolgKey = (ip: string, kennung: string) => `login-erfolg|${adressAbdruck(ip)}|${kennung}`;

function _prune() {
  if (_attempts.size <= 5000) return;
  const cutoff = Date.now() - WINDOW_MS;
  for (const [k, v] of _attempts) if (v.firstAt < cutoff) _attempts.delete(k);
}

const _restMin = (firstAt: number, windowMin: number, now = Date.now()) =>
  Math.max(1, Math.ceil((firstAt + windowMin * 60000 - now) / 60000));

async function _read(key: string, windowMin: number): Promise<Zaehlerstand | null> {
  try {
    const row = await kontoBereich().anmeldezaehler.lies(key, windowMin);
    if (!row) return null;
    return {
      count: parseInt(row.count, 10) || 0,
      waitMin: Math.max(1, Math.ceil(parseFloat(row.wait_min) || 1)),
      seitLetztem: Math.max(0, parseFloat(row.seit) || 0),
    };
  } catch (fehler) {
    imSpeicher('lesen', fehler);
    const e = _attempts.get(key);
    if (!e || Date.now() - e.firstAt > windowMin * 60000) return null;
    return {
      count: e.count,
      waitMin: _restMin(e.firstAt, windowMin),
      seitLetztem: (Date.now() - (e.lastAt ?? e.firstAt)) / 1000,
    };
  }
}

async function _bump(key: string, windowMin: number): Promise<number> {
  try {
    return await kontoBereich().anmeldezaehler.erhoehe(key, windowMin);
  } catch (fehler) {
    imSpeicher('zählen', fehler);
    const now = Date.now();
    const e = _attempts.get(key);
    if (!e || now - e.firstAt > windowMin * 60000)
      _attempts.set(key, { count: 1, firstAt: now, lastAt: now, laufend: 0 });
    else {
      e.count++;
      e.lastAt = now;
      e.laufend = Math.max(0, (e.laufend || 0) - 1);
    }
    _prune();
    return _attempts.get(key)?.count ?? 1;
  }
}

type Stand = Zaehlerstand & { laufend: number };

/** BEVOR geprüft wird, unter einer Zeilensperre, damit gleichzeitige Versuche
 * einander sehen. */
async function _reserviere(
  key: string,
  windowMin: number,
  erlaubt: (s: Stand) => boolean,
): Promise<{ ok: boolean; stand: Stand }> {
  try {
    return await kontoBereich().db.transaction(async tx => {
      const r = await repo.sperre(tx, key, windowMin, LAUFEND_VERFALL_S);
      const neu = !!r.abgelaufen;
      const stand: Stand = {
        count: neu ? 0 : parseInt(r.count, 10) || 0,
        laufend: r.laufend_alt ? 0 : parseInt(r.laufend, 10) || 0,
        waitMin: neu ? windowMin : Math.max(1, Math.ceil(parseFloat(r.wait_min) || 1)),
        seitLetztem: Math.max(0, parseFloat(r.seit) || 0),
      };
      if (!erlaubt(stand)) return { ok: false, stand };
      await repo.belegeLaufplatz(tx, key, stand.laufend + 1, neu);
      return { ok: true, stand };
    });
  } catch (fehler) {
    imSpeicher('reservieren', fehler);
    // Im Prozessspeicher ist dieser Block ohne await atomar.
    const now = Date.now();
    let e = _attempts.get(key);
    if (!e || now - e.firstAt > windowMin * 60000) {
      e = { count: 0, firstAt: now, lastAt: null, laufend: 0 };
      _attempts.set(key, e);
    }
    const stand: Stand = {
      count: e.count,
      laufend: e.laufend || 0,
      waitMin: _restMin(e.firstAt, windowMin, now),
      seitLetztem: (now - (e.lastAt ?? e.firstAt)) / 1000,
    };
    if (!erlaubt(stand)) return { ok: false, stand };
    e.laufend = stand.laufend + 1;
    _prune();
    return { ok: true, stand };
  }
}

async function _freigeben(key: string): Promise<void> {
  try {
    await kontoBereich().anmeldezaehler.gibLaufplatzFrei(key);
  } catch (fehler) {
    imSpeicher('freigeben', fehler);
    const e = _attempts.get(key);
    if (e) e.laufend = Math.max(0, (e.laufend || 0) - 1);
  }
}

async function _clear(key: string): Promise<void> {
  try {
    await kontoBereich().anmeldezaehler.loescheZaehler(key);
  } catch (e) {
    imSpeicher('löschen', e);
    _attempts.delete(key);
  }
}

/** Name und E-Mail desselben Kontos zählen gemeinsam, sonst gälte jede Grenze
 * doppelt. Kleinschreibung in PostgreSQL wie beim Login: JS macht aus „İ"
 * zwei Zeichen. */
async function kontoKennung(username: string): Promise<string> {
  // Ausnahme: Bei gestörter Datenbank zählt die Drossel im Speicher weiter
  // (imSpeicher); ohne Konto dann nach dem Namen, statt die Anmeldung zu sperren.
  const z = await kontoBereich()
    .anmeldezaehler.kontoZumNamen(einzelwert(username))
    .catch(meldeUndLiefere('anmeldung:konto-kennung', null));
  if (z?.id) return `konto:${z.id}`;
  return `name:${namensAbdruck(z?.kennung ?? einzelwert(username).toLowerCase())}`;
}

/** Ein unbekannter Name ist oft ein vertipptes Passwort, und die Tabelle liest die
 * Leserolle: nur der HMAC, der für denselben Namen gleich bleibt und weiter zählt. */
function namensAbdruck(name: string): string {
  try {
    return suchwert('anmeldename', name);
  } catch {
    // Ohne Datenschlüssel (Werkzeuge, frühe Tests) wenigstens kein Klartext.
    return createHash('sha256').update(`brickinventory/anmeldename/${name}`).digest('hex');
  }
}

export type Sperre = { code: FehlerCode; vars: { minuten: number } };

/** Belegt den Versuch; recordLoginFailure, recordLoginSuccess oder
 * gibAnmeldeplatzFrei geben ihn frei. */
export async function checkLoginAllowed(ip: string, username: string): Promise<Sperre | null> {
  const kennung = await kontoKennung(username);
  // Von einer bekannten Adresse gilt nur die Sperre je Adresse und Konto: Die
  // Gesamtsperre der Adresse und die Wartezeit des Kontos liessen sich sonst
  // gegen den Inhaber richten — hinter einem Proxy teilen sich alle eine Adresse.
  const bekannt = !!(await _read(_bekanntKey(ip, kennung), BEKANNT_MIN));
  const gesamt = await _reserviere(_adressKey(ip), WINDOW_MIN, s => bekannt || s.count + s.laufend < MAX_JE_ADRESSE);
  if (!gesamt.ok) return { code: 'zu_viele_fehlversuche', vars: { minuten: gesamt.stand.waitMin } };
  const adresse = await _reserviere(_key(ip, kennung), WINDOW_MIN, s => s.count + s.laufend < MAX_ATTEMPTS);
  if (!adresse.ok) {
    await _freigeben(_adressKey(ip));
    return { code: 'zu_viele_fehlversuche', vars: { minuten: adresse.stand.waitMin } };
  }
  if (bekannt) return null;
  let rest = 0;
  const konto = await _reserviere(_nameKey(kennung), WINDOW_MIN, s => {
    rest = wartezeitSekunden(s.count) - s.seitLetztem;
    // In der Wartezeit-Phase höchstens ein Versuch zugleich je Konto.
    return rest <= 0 && (s.count < MAX_ATTEMPTS || s.laufend === 0);
  });
  if (!konto.ok) {
    await _freigeben(_key(ip, kennung));
    await _freigeben(_adressKey(ip));
    return { code: 'zu_viele_fehlversuche', vars: { minuten: Math.max(1, Math.ceil(Math.max(rest, 1) / 60)) } };
  }
  return null;
}

export async function gibAnmeldeplatzFrei(ip: string, username: string): Promise<void> {
  const kennung = await kontoKennung(username);
  await _freigeben(_key(ip, kennung));
  await _freigeben(_nameKey(kennung));
  await _freigeben(_adressKey(ip));
}

/** @returns die Fehlversuche des Kontos im Fenster */
export async function recordLoginFailure(ip: string, username: string): Promise<number> {
  const kennung = await kontoKennung(username);
  await _bump(_key(ip, kennung), WINDOW_MIN);
  const n = await _bump(_nameKey(kennung), WINDOW_MIN);
  await _bump(_adressKey(ip), WINDOW_MIN);
  return n;
}

export type Anmeldeereignis =
  | 'anmeldung_fehlgeschlagen'
  | 'anmeldung_gesperrt'
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

export async function recordLoginSuccess(ip: string, username: string): Promise<void> {
  const kennung = await kontoKennung(username);
  await _clear(_key(ip, kennung));
  await _clear(_nameKey(kennung));
  // Nur freigeben, nicht löschen: Ein Erfolg soll den Zähler der Adresse nach
  // Fehlversuchen gegen andere Konten nicht zurücksetzen.
  await _freigeben(_adressKey(ip));
  await _bump(_bekanntKey(ip, kennung), BEKANNT_MIN);
  await _bump(_erfolgKey(ip, kennung), WINDOW_MIN);
}

/** Weiche Grenze: Wer sich öfter anmeldet, verliert nur den Vorrang. Eine harte träfe
 * den Inhaber, und gegen die Last wirken schon Sperren und Schranke. */
export const ERFOLGE_MIT_VORRANG = 30;

/** Diese Adresse hat sich mit diesem Namen zuletzt angemeldet, und nicht zu oft. */
export async function bekannteAnmeldung(ip: string, username: string): Promise<boolean> {
  const kennung = await kontoKennung(username);
  if (!(await _read(_bekanntKey(ip, kennung), BEKANNT_MIN))) return false;
  return ((await _read(_erfolgKey(ip, kennung), WINDOW_MIN))?.count ?? 0) < ERFOLGE_MIT_VORRANG;
}

/** Jeder unbekannte Name legt eine Zeile an; ohne Aufräumen wüchse die Tabelle mit jedem Rateversuch. */
export async function raeumeAnmeldezaehlerAuf(): Promise<number> {
  return kontoBereich().anmeldezaehler.raeumeAuf(BEKANNT_MIN);
}

/** In einem Schritt: Getrennt gelesen und gezählt kamen gleichzeitige Anfragen
 * durch. Abgewiesene zählen mit, verlängern aber nicht. */
export async function zaehleAnfrage(
  bucket: string,
  ip: string,
  windowMs: number,
): Promise<{ count: number; waitMin: number }> {
  const key = `${bucket}|${drosselAdresse(ip)}`;
  const windowMin = windowMs / 60000;
  try {
    const r = await kontoBereich().anmeldezaehler.zaehleHoch(key, windowMin);
    return { count: parseInt(r.count, 10) || 0, waitMin: Math.max(1, Math.ceil(parseFloat(r.wait_min) || 1)) };
  } catch (fehler) {
    imSpeicher('anfrage', fehler);
    const now = Date.now();
    let e = _attempts.get(key);
    if (!e || now - e.firstAt > windowMin * 60000) {
      e = { count: 0, firstAt: now, lastAt: now, laufend: 0 };
      _attempts.set(key, e);
    }
    e.count++;
    e.lastAt = now;
    _prune();
    return { count: e.count, waitMin: _restMin(e.firstAt, windowMin, now) };
  }
}

/** Je Konto UND Zugang (Sitzung oder Token-Familie): Fehlversuche aus einem
 * erbeuteten Zugang sperren nicht die Notbremsen des Inhabers in seinem eigenen.
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

export async function bestaetigungGesperrt(art: Bremse, uid: number, zugang: string): Promise<Sperre | null> {
  const konto = await _read(_kontoBestaetigungKey(art, uid), KONTO_FENSTER_MIN);
  const kontoVoll = !!konto && konto.count >= MAX_BESTAETIGUNG_JE_KONTO;
  const r = await _reserviere(
    _bestaetigungKey(art, uid, zugang),
    fenster(art),
    s => s.count + s.laufend < MAX_ATTEMPTS && !(kontoVoll && s.count > 0),
  );
  if (r.ok) return null;
  const minuten = kontoVoll && r.stand.count < MAX_ATTEMPTS ? konto!.waitMin : r.stand.waitMin;
  return { code: 'zu_viele_fehlversuche', vars: { minuten } };
}
/** @returns true, wenn dieser Fehlversuch eine Bremse (Zugang oder Konto) gerade erreicht hat */
export async function bestaetigungFehlgeschlagen(art: Bremse, uid: number, zugang: string): Promise<boolean> {
  const jeZugang = await _bump(_bestaetigungKey(art, uid, zugang), fenster(art));
  const jeKonto = await _bump(_kontoBestaetigungKey(art, uid), KONTO_FENSTER_MIN);
  return jeZugang === MAX_ATTEMPTS || jeKonto === MAX_BESTAETIGUNG_JE_KONTO;
}
export async function bestaetigungGelungen(art: Bremse, uid: number, zugang: string): Promise<void> {
  await _clear(_bestaetigungKey(art, uid, zugang));
}
