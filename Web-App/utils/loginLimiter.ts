/**
 * Brute-Force-Schutz für Login-Endpunkte und missbrauchsanfällige Routen.
 *
 * ── Warum jetzt in der Datenbank ────────────────────────────────────────────
 * Die Zähler lagen bisher im Prozessspeicher. Der Server läuft im Cluster mit
 * WEB_WORKERS Prozessen (Vorgabe: Anzahl CPU-Kerne), und jede Anfrage kann in
 * einem beliebigen davon landen. Aus "5 Fehlversuche" wurden damit faktisch
 * N×5 — auf einem Achtkerner also vierzig. Der Kommentar hier nannte das
 * "völlig ausreichend"; das stimmt für gelegentliches Raten, nicht für einen
 * automatisierten Angriff.
 *
 * Jetzt zählt eine gemeinsame Tabelle. Kosten: ein Primärschlüssel-Lookup pro
 * Login-Versuch und ein UPSERT je Fehlversuch. Das Hochzählen passiert atomar
 * in einem Statement — ohne SELECT-dann-UPDATE und damit ohne Race zwischen
 * parallelen Versuchen.
 *
 * ── Rückfallebene ───────────────────────────────────────────────────────────
 * Ist die Datenbank nicht erreichbar, greift der alte In-Memory-Zähler. Lieber
 * ein schwächeres Limit als ein Login, der gar nicht mehr funktioniert.
 */
import * as db from '../db/database';
import type { Request, Response, NextFunction } from 'express';
import { einzelwert } from './validate';

/**
 * ── Warum hier Typen stehen (Nachtrag 155) ───────────────────────────────────
 *
 * Diese Datei entscheidet, ob ein Anmeldeversuch durchgelassen wird. Sie hatte
 * 20 implizite `any`. Ein vertippter Feldname (`st.cnt` statt `st.count`) ergibt
 * dort `undefined`, und `undefined >= MAX_ATTEMPTS` ist `false` — die Sperre
 * faellt still aus, und nichts im Protokoll sagt es. Genau diese Fehlerklasse
 * faengt eine Typpruefung, und genau hier ist sie am meisten wert.
 */

/** Ergebnis eines Zaehlerstands: wie viele Versuche, und wie lange noch gesperrt. */
interface Zaehlerstand {
  count: number;
  waitMin: number;
}


const MAX_ATTEMPTS = 5;
const WINDOW_MS    = 15 * 60 * 1000;
const WINDOW_MIN   = WINDOW_MS / 60000;

/** Rückfallebene, falls die DB klemmt. key → { count, firstAt } */
const _attempts = new Map();

// VORHER: der ERSTE Eintrag aus dem rohen X-Forwarded-For-Header, ungeprüft.
// Der Header kommt vom CLIENT, nicht vom Proxy — jeder darf ihn mitschicken.
// Ein Angreifer, der bei jedem Versuch einen anderen (frei erfundenen) Wert
// sendet, bekommt bei jedem Versuch einen frischen Rate-Limit-Bucket; die
// "5 Fehlversuche, dann 15 Min Sperre"-Regel griff dadurch nie.
//
// server.ts setzt bereits `app.set('trust proxy', 1)` in Produktion — Express
// wertet X-Forwarded-For damit selbst aus (genau ein Hop, der eigene
// Reverse-Proxy) und legt das Ergebnis in req.ip ab. req.ip ist deshalb die
// vertrauenswürdige Quelle; der Header-Zugriff bleibt nur als Fallback für
// Kontexte ohne Express-Request (aktuell keine), falls req.ip einmal fehlt.
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
async function checkLoginAllowed(req: Request, username: unknown): Promise<string | null> {
  const st = await _read(_key(req, username), WINDOW_MIN);
  if (st && st.count >= MAX_ATTEMPTS)
    return `Zu viele Fehlversuche — bitte in ${st.waitMin} Min. erneut versuchen`;
  return null;
}

/** Nach einem fehlgeschlagenen Login aufrufen. */
async function recordLoginFailure(req: Request, username: unknown): Promise<void> {
  await _bump(_key(req, username), WINDOW_MIN);
}

/** Nach einem erfolgreichen Login aufrufen. */
async function recordLoginSuccess(req: Request, username: unknown): Promise<void> {
  await _clear(_key(req, username));
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
      return res.status(429).json({ success: false, error: `Zu viele Anfragen — bitte in ${st.waitMin} Min. erneut versuchen` });
    await _bump(key, windowMin);
    next();
  };
}

export { checkLoginAllowed, recordLoginFailure, recordLoginSuccess, ipThrottle };
