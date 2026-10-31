/**
 * Brute-Force-Schutz für die Anmeldung und missbrauchsanfällige Routen. Die
 * Funktionen nehmen die Adresse als Wert; welche Adresse eine Anfrage hat,
 * entscheidet die HTTP-Schicht (src/konto/http/anmeldung.ts).
 * Ausführlich: docs/begruendungen/src/konto/loginLimiter.ts.md#abschnitt
 */
import * as db from '../../db/database';
import { einzelwert } from '../infra/validate';
import type { FehlerCode } from '../infra/fehlerTexte';
import * as repo from './repository/anmeldezaehler';

/**
 * Typisiert, weil ein vertippter Feldname hier `undefined >= MAX_ATTEMPTS`
 * ergäbe — `false`, also keine Sperre.
 * Ausführlich: docs/begruendungen/src/konto/loginLimiter.ts.md#zaehlerstand
 */
interface Zaehlerstand {
  count: number;
  waitMin: number;
  /** Sekunden seit dem letzten Fehlversuch. */
  seitLetztem: number;
}

export const MAX_ATTEMPTS = 5;
const WINDOW_MS    = 15 * 60 * 1000;

/**
 * Wartezeit je KONTO über alle Adressen: ab dem fünften Fehlversuch 1 s, dann
 * jedes Mal doppelt so lang, höchstens das Fenster. Wer viele Adressen hat,
 * rät so nur noch rund 15 Mal je Viertelstunde; der Inhaber wartet bei ein,
 * zwei Vertippern dagegen Sekunden statt einer festen Sperre.
 */
export function wartezeitSekunden(fehlversuche: number): number {
  if (fehlversuche < MAX_ATTEMPTS) return 0;
  return Math.min(2 ** (fehlversuche - MAX_ATTEMPTS), WINDOW_MS / 1000);
}
/**
 * Fehlversuche je Adresse über ALLE Namen. Die Grenze je Konto lässt sonst
 * Password-Spraying zu: fünf Versuche gegen jedes Konto, unbegrenzt viele Konten.
 */
export const MAX_JE_ADRESSE = 30;
/** So lange gilt eine Adresse nach einer erfolgreichen Anmeldung als bekannt. */
const BEKANNT_MIN  = 30 * 24 * 60;
const WINDOW_MIN   = WINDOW_MS / 60000;
/** Ein reservierter Platz, dessen Prüfung nie gemeldet wurde, verfällt danach. */
const LAUFEND_VERFALL_S = 60;

type Eintrag = { count: number; firstAt: number; lastAt: number | null; laufend: number };
/** Rückfallebene, falls die Datenbank klemmt: Die Bremse soll dann nicht offen stehen. */
const _attempts = new Map<string, Eintrag>();

// einzelwert(): Kommt der Name doppelt an, liefert Express ein Array.
const _key = (ip: string, name: unknown) => `login|${ip}|${einzelwert(name).toLowerCase()}`;
const _adressKey = (ip: string) => `login-adresse|${ip}`;
const _nameKey = (name: unknown) => `login-name|${einzelwert(name).toLowerCase()}`;
const _bekanntKey = (ip: string, name: unknown) => `login-bekannt|${ip}|${einzelwert(name).toLowerCase()}`;

function _prune() {
  if (_attempts.size <= 5000) return;
  const cutoff = Date.now() - WINDOW_MS;
  for (const [k, v] of _attempts) if (v.firstAt < cutoff) _attempts.delete(k);
}

const _restMin = (firstAt: number, windowMin: number, now = Date.now()) =>
  Math.max(1, Math.ceil((firstAt + windowMin * 60000 - now) / 60000));

/** Zählerstand, oder null, wenn es keinen gibt oder sein Fenster abgelaufen ist. */
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

async function _bump(key: string, windowMin: number): Promise<void> {
  try {
    await repo.erhoehe(key, windowMin);
  } catch (_) {
    const now = Date.now();
    const e = _attempts.get(key);
    if (!e || now - e.firstAt > windowMin * 60000) _attempts.set(key, { count: 1, firstAt: now, lastAt: now, laufend: 0 });
    else { e.count++; e.lastAt = now; e.laufend = Math.max(0, (e.laufend || 0) - 1); }
    _prune();
  }
}

type Stand = Zaehlerstand & { laufend: number };

/**
 * Einen Platz für einen Versuch belegen, BEVOR geprüft wird — unter einer
 * Zeilensperre, damit gleichzeitige Versuche einander sehen. `erlaubt` sieht
 * Fehlversuche und laufende Versuche; sagt es nein, wird nichts belegt.
 */
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
    // Rückfall im Prozessspeicher: Dort ist dieser Block ohne await atomar.
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

/**
 * Name und E-Mail desselben Kontos zählen gemeinsam — sonst gälte jede Grenze
 * doppelt. Kleingeschrieben wird in PostgreSQL wie beim Login selbst: JavaScript
 * macht aus „İ" zwei Zeichen, PostgreSQL ein „i".
 */
async function kontoKennung(username: unknown): Promise<string> {
  const z = await repo.kontoZumNamen(einzelwert(username)).catch(() => null);
  if (z?.id) return `konto:${z.id}`;
  return z?.kennung ?? einzelwert(username).toLowerCase();
}

export type Sperre = { code: FehlerCode; vars: { minuten: number } };

/** Belegt den Versuch; recordLoginFailure, recordLoginSuccess oder gibAnmeldeplatzFrei geben ihn frei. */
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
  // Von einer Adresse, an der sich der Inhaber schon angemeldet hat, gilt nur
  // die Sperre je Adresse — sonst liesse sich die Wartezeit gegen ihn richten.
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

/** Den belegten Versuch freigeben, ohne ihn zu zählen (etwa: Code fehlt noch). */
export async function gibAnmeldeplatzFrei(ip: string, username: unknown): Promise<void> {
  const kennung = await kontoKennung(username);
  await _freigeben(_key(ip, kennung));
  await _freigeben(_nameKey(kennung));
  await _freigeben(_adressKey(ip));
}

export async function recordLoginFailure(ip: string, username: unknown): Promise<void> {
  const kennung = await kontoKennung(username);
  await _bump(_key(ip, kennung), WINDOW_MIN);
  await _bump(_nameKey(kennung), WINDOW_MIN);
  await _bump(_adressKey(ip), WINDOW_MIN);
}

export async function recordLoginSuccess(ip: string, username: unknown): Promise<void> {
  const kennung = await kontoKennung(username);
  await _clear(_key(ip, kennung));
  await _clear(_nameKey(kennung));
  // Nur freigeben, nicht löschen: Ein Erfolg nach vielen Fehlversuchen gegen
  // andere Konten soll den Zähler der Adresse nicht zurücksetzen.
  await _freigeben(_adressKey(ip));
  await _bump(_bekanntKey(ip, kennung), BEKANNT_MIN);
}

/** Jeder unbekannte Name legt eine Zeile an; ohne Aufräumen wüchse die Tabelle mit jedem Rateversuch. */
export async function raeumeAnmeldezaehlerAuf(): Promise<number> {
  return repo.raeumeAuf(BEKANNT_MIN);
}

/**
 * Eine Anfrage je Adresse zählen und den neuen Stand liefern — in einem
 * Schritt: Getrennt gelesen und gezählt kamen 25 gleichzeitige Anfragen durch,
 * obwohl nur 5 erlaubt waren. Abgewiesene zählen mit, verlängern aber nicht.
 */
export async function zaehleAnfrage(bucket: string, ip: string, windowMs: number): Promise<{ count: number; waitMin: number }> {
  const key = `${bucket}|${ip}`;
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

/**
 * Bestätigung des aktuellen Passworts in einer laufenden Sitzung. Gezählt je
 * KONTO, nicht je Adresse: Wer ein Token erbeutet hat, soll das Passwort auch
 * von wechselnden Adressen aus nicht unbegrenzt raten können.
 */
const _bestaetigungKey = (uid: number) => `passwort-bestaetigen|${uid}`;

export async function bestaetigungGesperrt(uid: number): Promise<Sperre | null> {
  const r = await _reserviere(_bestaetigungKey(uid), WINDOW_MIN, s => s.count + s.laufend < MAX_ATTEMPTS);
  return r.ok ? null : { code: 'zu_viele_fehlversuche', vars: { minuten: r.stand.waitMin } };
}
export async function bestaetigungFehlgeschlagen(uid: number): Promise<void> { await _bump(_bestaetigungKey(uid), WINDOW_MIN); }
export async function bestaetigungGelungen(uid: number): Promise<void> { await _clear(_bestaetigungKey(uid)); }
