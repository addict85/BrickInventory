/**
 * Brute-Force-Schutz für Login-Endpunkte und missbrauchsanfällige Routen.
 * Ausführlich: docs/begruendungen/utils/loginLimiter.ts.md#abschnitt
 */
import * as db from '../db/database';
import type { Request, Response, NextFunction } from 'express';
import { einzelwert } from './validate';
import { sendeFehler } from './fehlerTexte';
import type { FehlerCode } from './fehlerTexte';

/**
 * Warum hier Typen stehen
 * Diese Datei entscheidet, ob ein Anmeldeversuch durchgelassen wird. Sie hatte
 * 20 implizite `any`. Ein vertippter Feldname (`st.cnt` statt `st.count`) ergibt
 * dort `undefined`, und `undefined >= MAX_ATTEMPTS` ist `false` — die Sperre …
 * Ausführlich: docs/begruendungen/utils/loginLimiter.ts.md#zaehlerstand
 */

/** Ergebnis eines Zaehlerstands: wie viele Versuche, und wie lange noch gesperrt. */
interface Zaehlerstand {
  count: number;
  waitMin: number;
}


const MAX_ATTEMPTS = 5;
/**
 * Fehlversuche je Benutzername über ALLE Adressen. Wer viele IPs hat, kommt am
 * Zähler je IP vorbei, an diesem nicht. Höher als MAX_ATTEMPTS, weil ein
 * Angreifer damit auch den echten Nutzer für das Fenster aussperren kann.
 */
const MAX_JE_NAME  = 20;
const WINDOW_MS    = 15 * 60 * 1000;
/** So lange gilt eine Adresse nach einer erfolgreichen Anmeldung als bekannt. */
const BEKANNT_MIN  = 30 * 24 * 60;
const WINDOW_MIN   = WINDOW_MS / 60000;

/** Rückfallebene, falls die DB klemmt. key → { count, firstAt } */
const _attempts = new Map();

// req.ip statt X-Forwarded-For: Express wertet den Kopf nur aus, wenn er von
// einem vertrauten Proxy kommt (utils/proxyVertrauen.ts).
// Ausführlich: docs/begruendungen/utils/loginLimiter.ts.md#ipof
function _ipOf(req: Request): string {
  return req.ip || req.socket?.remoteAddress || '?';
}

function _key(req: Request, username: unknown): string {
  // einzelwert() statt (username || ''): Kommt der Benutzername doppelt an
  // (?username=a&username=b), liefert Express ein Array — und darauf gibt es
  // kein toLowerCase(). Vorher warf das eine TypeError-Ausnahme mitten in der
  // Sperrpruefung; mit `unknown` als Typ hat TypeScript es sichtbar gemacht.
  // einzelwert() nimmt in dem Fall den ERSTEN Wert, wie ueberall sonst im Baum.
  return `login|${_ipOf(req)}|${einzelwert(username).toLowerCase()}`;
}

function _nameKey(username: unknown): string {
  return `login-name|${einzelwert(username).toLowerCase()}`;
}

function _bekanntKey(req: Request, username: unknown): string {
  return `login-bekannt|${_ipOf(req)}|${einzelwert(username).toLowerCase()}`;
}

function _prune() {
  if (_attempts.size <= 5000) return;
  const cutoff = Date.now() - WINDOW_MS;
  for (const [k, v] of _attempts) if (v.firstAt < cutoff) _attempts.delete(k);
}

/**
 * Zähler lesen. Gibt { count, waitMin } zurück oder null, wenn kein Eintrag
 * existiert oder das Fenster abgelaufen ist.
 */
async function _read(key: string, windowMin: number): Promise<Zaehlerstand | null> {
  try {
    const row = await db.get(
      `SELECT count, EXTRACT(EPOCH FROM (first_at + make_interval(mins => $2) - NOW()))/60 AS wait_min
         FROM rate_limit_attempts
        WHERE key = $1 AND first_at > NOW() - make_interval(mins => $2)`,
      [key, windowMin]);
    if (!row) return null;
    return { count: parseInt(row.count) || 0, waitMin: Math.max(1, Math.ceil(parseFloat(row.wait_min) || 1)) };
  } catch (_) {
    const e = _attempts.get(key);
    if (!e || Date.now() - e.firstAt > windowMin * 60000) return null;
    return { count: e.count, waitMin: Math.max(1, Math.ceil((e.firstAt + windowMin * 60000 - Date.now()) / 60000)) };
  }
}

/**
 * Atomar hochzählen. Ein abgelaufenes Fenster startet neu — beides in EINEM
 * Statement, damit zwei gleichzeitige Fehlversuche nicht denselben Stand lesen.
 */
async function _bump(key: string, windowMin: number): Promise<void> {
  try {
    await db.run(
      `INSERT INTO rate_limit_attempts (key, count, first_at) VALUES ($1, 1, NOW())
       ON CONFLICT (key) DO UPDATE SET
         count    = CASE WHEN rate_limit_attempts.first_at < NOW() - make_interval(mins => $2)
                         THEN 1 ELSE rate_limit_attempts.count + 1 END,
         first_at = CASE WHEN rate_limit_attempts.first_at < NOW() - make_interval(mins => $2)
                         THEN NOW() ELSE rate_limit_attempts.first_at END`,
      [key, windowMin]);
  } catch (_) {
    const now = Date.now();
    const e = _attempts.get(key);
    if (!e || now - e.firstAt > windowMin * 60000) _attempts.set(key, { count: 1, firstAt: now });
    else e.count++;
    _prune();
  }
}

async function _clear(key: string): Promise<void> {
  try { await db.run('DELETE FROM rate_limit_attempts WHERE key = $1', [key]); }
  catch (_) { _attempts.delete(key); }
}

/**
 * Vor der Passwortprüfung aufrufen.
 * @returns {Promise<string|null>} Sperr-Meldung oder null
 */
async function checkLoginAllowed(
  req: Request, username: unknown,
): Promise<{ code: FehlerCode; vars: { minuten: number } } | null> {
  // Code statt Satz (Nachtrag 130): Dieser Helfer weiss nicht, welche Sprache
  // der Anfragende sieht — die Route weiss es.
  const st = await _read(_key(req, username), WINDOW_MIN);
  if (st && st.count >= MAX_ATTEMPTS)
    return { code: 'zu_viele_fehlversuche', vars: { minuten: st.waitMin } };
  // Die Sperre je Name liesse sich von aussen gegen den Inhaber richten. Von
  // einer Adresse, an der er sich schon angemeldet hat, gilt deshalb nur die
  // Sperre je Adresse.
  const jeName = await _read(_nameKey(username), WINDOW_MIN);
  if (jeName && jeName.count >= MAX_JE_NAME && !(await _read(_bekanntKey(req, username), BEKANNT_MIN)))
    return { code: 'zu_viele_fehlversuche', vars: { minuten: jeName.waitMin } };
  return null;
}

/** Nach einem fehlgeschlagenen Login aufrufen. */
async function recordLoginFailure(req: Request, username: unknown): Promise<void> {
  await _bump(_key(req, username), WINDOW_MIN);
  await _bump(_nameKey(username), WINDOW_MIN);
}

/** Nach einem erfolgreichen Login aufrufen. */
async function recordLoginSuccess(req: Request, username: unknown): Promise<void> {
  await _clear(_key(req, username));
  await _clear(_nameKey(username));
  await _bump(_bekanntKey(req, username), BEKANNT_MIN);
}

/**
 * Generischer IP-Throttle als Express-Middleware — dieselbe Mechanik, nur nach
 * IP geschlüsselt. Deckt /register, /forgot-password, /reset-password und
 * /check-token ab, die vorher komplett unbegrenzt waren.
 */
function ipThrottle(bucket: string, max: number, windowMs: number) {
  const windowMin = windowMs / 60000;
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = `${bucket}|${_ipOf(req)}`;
    const st  = await _read(key, windowMin);
    if (st && st.count >= max)
      return sendeFehler(req, res, 429, 'zu_viele_anfragen', { minuten: st.waitMin });
    await _bump(key, windowMin);
    next();
  };
}

/**
 * Bestätigung des aktuellen Passworts in einer laufenden Sitzung (Passwort
 * ändern, E-Mail ändern, zweiter Faktor). Gezählt je KONTO, nicht je Adresse:
 * Wer ein Token erbeutet hat, soll das Passwort auch von wechselnden Adressen
 * aus nicht unbegrenzt raten können.
 */
const _bestaetigungKey = (uid: number) => `passwort-bestaetigen|${uid}`;
async function bestaetigungGesperrt(uid: number): Promise<{ code: FehlerCode; vars: { minuten: number } } | null> {
  const st = await _read(_bestaetigungKey(uid), WINDOW_MIN);
  return st && st.count >= MAX_ATTEMPTS ? { code: 'zu_viele_fehlversuche', vars: { minuten: st.waitMin } } : null;
}
async function bestaetigungFehlgeschlagen(uid: number): Promise<void> { await _bump(_bestaetigungKey(uid), WINDOW_MIN); }
async function bestaetigungGelungen(uid: number): Promise<void> { await _clear(_bestaetigungKey(uid)); }

export { checkLoginAllowed, recordLoginFailure, recordLoginSuccess, ipThrottle, MAX_ATTEMPTS, MAX_JE_NAME,
         bestaetigungGesperrt, bestaetigungFehlgeschlagen, bestaetigungGelungen };
