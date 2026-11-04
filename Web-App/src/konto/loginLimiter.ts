/** Die Funktionen nehmen die Adresse als Wert; welche Adresse eine Anfrage
 * hat, entscheidet die HTTP-Schicht.
 * Ausführlich: docs/begruendungen/src/konto/loginLimiter.ts.md#abschnitt */
import { isIPv4, isIPv6 } from 'node:net';
import * as db from '../../db/database';
import { einzelwert } from '../infra/validate';
import { meldeUndLiefere } from '../infra/httpError';
import type { FehlerCode } from '../infra/fehlerTexte';
import * as repo from './repository/anmeldezaehler';

/** Typisiert, weil ein vertippter Feldname `undefined >= MAX_ATTEMPTS` ergäbe
 * — `false`, also keine Sperre. */
interface Zaehlerstand {
  count: number;
  waitMin: number;
  seitLetztem: number;
}

export const MAX_ATTEMPTS = 5;
const WINDOW_MS    = 15 * 60 * 1000;

/** Je KONTO über alle Adressen, verdoppelnd: Wer viele Adressen hat, rät nur
 * noch rund 15 Mal je Viertelstunde; der Inhaber wartet bei einem Vertipper
 * Sekunden statt einer festen Sperre. */
export function wartezeitSekunden(fehlversuche: number): number {
  if (fehlversuche < MAX_ATTEMPTS) return 0;
  return Math.min(2 ** (fehlversuche - MAX_ATTEMPTS), WINDOW_MS / 1000);
}
/** Über ALLE Namen: Die Grenze je Konto liesse sonst Password-Spraying zu. */
export const MAX_JE_ADRESSE = 30;
const BEKANNT_MIN  = 30 * 24 * 60;
const WINDOW_MIN   = WINDOW_MS / 60000;
/** Ein reservierter Platz, dessen Prüfung nie gemeldet wurde, verfällt danach. */
const LAUFEND_VERFALL_S = 60;

type Eintrag = { count: number; firstAt: number; lastAt: number | null; laufend: number };
/** Rückfall, falls die Datenbank klemmt: Die Bremse soll dann nicht offen stehen. */
const _attempts = new Map<string, Eintrag>();

/** Ein IPv6-Anschluss bekommt ein ganzes /64; je Adresse gezählt, wäre jede
 * Bremse mit einer neuen Adresse aus dem eigenen Netz umgangen. IPv4 in IPv6
 * (::ffff:a.b.c.d) zählt als IPv4. Alles andere (`konto:7`) bleibt, wie es ist. */
export function drosselAdresse(ip: string): string {
  const v4 = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (v4 && isIPv4(v4[1]!)) return v4[1]!;
  if (!isIPv6(ip)) return ip;
  const [links = '', rechts = ''] = ip.toLowerCase().split('::');
  const l = links ? links.split(':') : [], r = rechts ? rechts.split(':') : [];
  const gruppen = ip.includes('::') ? [...l, ...Array(8 - l.length - r.length).fill('0'), ...r] : l;
  return gruppen.slice(0, 4).map(g => g.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

// einzelwert(): Kommt der Name doppelt an, liefert Express ein Array.
const _key = (ip: string, name: unknown) => `login|${drosselAdresse(ip)}|${einzelwert(name).toLowerCase()}`;
const _adressKey = (ip: string) => `login-adresse|${drosselAdresse(ip)}`;
const _nameKey = (name: unknown) => `login-name|${einzelwert(name).toLowerCase()}`;
const _bekanntKey = (ip: string, name: unknown) => `login-bekannt|${drosselAdresse(ip)}|${einzelwert(name).toLowerCase()}`;

function _prune() {
  if (_attempts.size <= 5000) return;
  const cutoff = Date.now() - WINDOW_MS;
  for (const [k, v] of _attempts) if (v.firstAt < cutoff) _attempts.delete(k);
}

const _restMin = (firstAt: number, windowMin: number, now = Date.now()) =>
  Math.max(1, Math.ceil((firstAt + windowMin * 60000 - now) / 60000));

async function _read(key: string, windowMin: number): Promise<Zaehlerstand | null> {
  try {
    const row = await repo.lies(key, windowMin);
    if (!row) return null;
    return { count: parseInt(row.count) || 0, waitMin: Math.max(1, Math.ceil(parseFloat(row.wait_min) || 1)),
             seitLetztem: Math.max(0, parseFloat(row.seit) || 0) };
  } catch (_) {
    const e = _attempts.get(key);
    if (!e || Date.now() - e.firstAt > windowMin * 60000) return null;
    return { count: e.count, waitMin: _restMin(e.firstAt, windowMin), seitLetztem: (Date.now() - (e.lastAt ?? e.firstAt)) / 1000 };
  }
}

async function _bump(key: string, windowMin: number): Promise<number> {
  try {
    return await repo.erhoehe(key, windowMin);
  } catch (_) {
    const now = Date.now();
    const e = _attempts.get(key);
    if (!e || now - e.firstAt > windowMin * 60000) _attempts.set(key, { count: 1, firstAt: now, lastAt: now, laufend: 0 });
    else { e.count++; e.lastAt = now; e.laufend = Math.max(0, (e.laufend || 0) - 1); }
    _prune();
    return _attempts.get(key)?.count ?? 1;
  }
}

type Stand = Zaehlerstand & { laufend: number };

/** BEVOR geprüft wird, unter einer Zeilensperre, damit gleichzeitige Versuche
 * einander sehen. */
async function _reserviere(key: string, windowMin: number, erlaubt: (s: Stand) => boolean): Promise<{ ok: boolean; stand: Stand }> {
  try {
    return await db.transaction(async (tx) => {
      const r = await repo.sperre(tx, key, windowMin, LAUFEND_VERFALL_S);
      const neu = !!r.abgelaufen;
      const stand: Stand = {
        count: neu ? 0 : parseInt(r.count) || 0,
        laufend: r.laufend_alt ? 0 : parseInt(r.laufend) || 0,
        waitMin: neu ? windowMin : Math.max(1, Math.ceil(parseFloat(r.wait_min) || 1)),
        seitLetztem: Math.max(0, parseFloat(r.seit) || 0),
      };
      if (!erlaubt(stand)) return { ok: false, stand };
      await repo.belegeLaufplatz(tx, key, stand.laufend + 1, neu);
      return { ok: true, stand };
    });
  } catch (_) {
    // Im Prozessspeicher ist dieser Block ohne await atomar.
    const now = Date.now();
    let e = _attempts.get(key);
    if (!e || now - e.firstAt > windowMin * 60000) { e = { count: 0, firstAt: now, lastAt: null, laufend: 0 }; _attempts.set(key, e); }
    const stand: Stand = { count: e.count, laufend: e.laufend || 0, waitMin: _restMin(e.firstAt, windowMin, now),
      seitLetztem: (now - (e.lastAt ?? e.firstAt)) / 1000 };
    if (!erlaubt(stand)) return { ok: false, stand };
    e.laufend = stand.laufend + 1;
    _prune();
    return { ok: true, stand };
  }
}

async function _freigeben(key: string): Promise<void> {
  try { await repo.gibLaufplatzFrei(key); }
  catch (_) { const e = _attempts.get(key); if (e) e.laufend = Math.max(0, (e.laufend || 0) - 1); }
}

async function _clear(key: string): Promise<void> {
  try { await repo.loescheZaehler(key); }
  catch (_) { _attempts.delete(key); }
}

/** Name und E-Mail desselben Kontos zählen gemeinsam, sonst gälte jede Grenze
 * doppelt. Kleinschreibung in PostgreSQL wie beim Login: JS macht aus „İ"
 * zwei Zeichen. */
async function kontoKennung(username: unknown): Promise<string> {
  const z = await repo.kontoZumNamen(einzelwert(username)).catch(meldeUndLiefere('anmeldung:konto-kennung', null));
  if (z?.id) return `konto:${z.id}`;
  return z?.kennung ?? einzelwert(username).toLowerCase();
}

export type Sperre = { code: FehlerCode; vars: { minuten: number } };

/** Belegt den Versuch; recordLoginFailure, recordLoginSuccess oder
 * gibAnmeldeplatzFrei geben ihn frei. */
export async function checkLoginAllowed(ip: string, username: unknown): Promise<Sperre | null> {
  const kennung = await kontoKennung(username);
  const gesamt = await _reserviere(_adressKey(ip), WINDOW_MIN, s => s.count + s.laufend < MAX_JE_ADRESSE);
  if (!gesamt.ok)
    return { code: 'zu_viele_fehlversuche', vars: { minuten: gesamt.stand.waitMin } };
  const adresse = await _reserviere(_key(ip, kennung), WINDOW_MIN, s => s.count + s.laufend < MAX_ATTEMPTS);
  if (!adresse.ok) {
    await _freigeben(_adressKey(ip));
    return { code: 'zu_viele_fehlversuche', vars: { minuten: adresse.stand.waitMin } };
  }
  // Von einer bekannten Adresse gilt nur die Sperre je Adresse — sonst liesse
  // sich die Wartezeit gegen den Inhaber richten.
  if (await _read(_bekanntKey(ip, kennung), BEKANNT_MIN)) return null;
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

export async function gibAnmeldeplatzFrei(ip: string, username: unknown): Promise<void> {
  const kennung = await kontoKennung(username);
  await _freigeben(_key(ip, kennung));
  await _freigeben(_nameKey(kennung));
  await _freigeben(_adressKey(ip));
}

/** @returns die Fehlversuche des Kontos im Fenster */
export async function recordLoginFailure(ip: string, username: unknown): Promise<number> {
  const kennung = await kontoKennung(username);
  await _bump(_key(ip, kennung), WINDOW_MIN);
  const n = await _bump(_nameKey(kennung), WINDOW_MIN);
  await _bump(_adressKey(ip), WINDOW_MIN);
  return n;
}

export type Anmeldeereignis = 'anmeldung_fehlgeschlagen' | 'anmeldung_gesperrt' | 'zweiter_faktor_falsch'
  | 'bestaetigung_fehlgeschlagen' | 'bestaetigung_gesperrt';
/** Eine Warnzeile je Ereignis für Protokoll, app_logs und fail2ban; nie Passwort, Code
 * oder eingegebener Name, denn im Namensfeld landet auch einmal ein Passwort. */
export function meldeAnmeldeereignis(ereignis: Anmeldeereignis, angaben: { ip?: string; konto?: number | null; art?: Bremse; zugang?: string }): void {
  const { ip, konto, ...rest } = angaben;
  console.warn(`[anmeldung] ${ereignis}`, { ereignis, ...(ip ? { adresse: drosselAdresse(ip) } : {}),
    konto: konto ?? 'unbekannt', ...rest });
}

export async function recordLoginSuccess(ip: string, username: unknown): Promise<void> {
  const kennung = await kontoKennung(username);
  await _clear(_key(ip, kennung));
  await _clear(_nameKey(kennung));
  // Nur freigeben, nicht löschen: Ein Erfolg soll den Zähler der Adresse nach
  // Fehlversuchen gegen andere Konten nicht zurücksetzen.
  await _freigeben(_adressKey(ip));
  await _bump(_bekanntKey(ip, kennung), BEKANNT_MIN);
}

/** Jeder unbekannte Name legt eine Zeile an; ohne Aufräumen wüchse die Tabelle mit jedem Rateversuch. */
export async function raeumeAnmeldezaehlerAuf(): Promise<number> {
  return repo.raeumeAuf(BEKANNT_MIN);
}

/** In einem Schritt: Getrennt gelesen und gezählt kamen gleichzeitige Anfragen
 * durch. Abgewiesene zählen mit, verlängern aber nicht. */
export async function zaehleAnfrage(bucket: string, ip: string, windowMs: number): Promise<{ count: number; waitMin: number }> {
  const key = `${bucket}|${drosselAdresse(ip)}`;
  const windowMin = windowMs / 60000;
  try {
    const r = await repo.zaehleHoch(key, windowMin);
    return { count: parseInt(r.count) || 0, waitMin: Math.max(1, Math.ceil(parseFloat(r.wait_min) || 1)) };
  } catch (_) {
    const now = Date.now();
    let e = _attempts.get(key);
    if (!e || now - e.firstAt > windowMin * 60000) { e = { count: 0, firstAt: now, lastAt: now, laufend: 0 }; _attempts.set(key, e); }
    e.count++; e.lastAt = now;
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

export async function bestaetigungGesperrt(art: Bremse, uid: number, zugang: string): Promise<Sperre | null> {
  const r = await _reserviere(_bestaetigungKey(art, uid, zugang), fenster(art), s => s.count + s.laufend < MAX_ATTEMPTS);
  return r.ok ? null : { code: 'zu_viele_fehlversuche', vars: { minuten: r.stand.waitMin } };
}
export async function bestaetigungFehlgeschlagen(art: Bremse, uid: number, zugang: string): Promise<void> {
  await _bump(_bestaetigungKey(art, uid, zugang), fenster(art));
}
export async function bestaetigungGelungen(art: Bremse, uid: number, zugang: string): Promise<void> {
  await _clear(_bestaetigungKey(art, uid, zugang));
}
