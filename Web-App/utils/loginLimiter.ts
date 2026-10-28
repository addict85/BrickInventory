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
  /** Sekunden seit dem letzten Fehlversuch. */
  seitLetztem: number;
}


const MAX_ATTEMPTS = 5;
const WINDOW_MS    = 15 * 60 * 1000;

/**
 * Wartezeit je KONTO über alle Adressen: ab dem fünften Fehlversuch 1 s, dann
 * jedes Mal doppelt so lang, höchstens das Fenster. Wer viele Adressen hat,
 * rät so nur noch rund 15 Mal je Viertelstunde; der Inhaber wartet bei ein,
 * zwei Vertippern dagegen Sekunden statt einer festen Sperre.
 */
function wartezeitSekunden(fehlversuche: number): number {
  if (fehlversuche < MAX_ATTEMPTS) return 0;
  return Math.min(2 ** (fehlversuche - MAX_ATTEMPTS), WINDOW_MS / 1000);
}
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
      `SELECT count, EXTRACT(EPOCH FROM (first_at + make_interval(mins => $2) - NOW()))/60 AS wait_min,
              EXTRACT(EPOCH FROM (NOW() - COALESCE(last_at, first_at))) AS seit
         FROM rate_limit_attempts
        WHERE key = $1 AND first_at > NOW() - make_interval(mins => $2)`,
      [key, windowMin]);
    if (!row) return null;
    return { count: parseInt(row.count) || 0, waitMin: Math.max(1, Math.ceil(parseFloat(row.wait_min) || 1)),
             seitLetztem: Math.max(0, parseFloat(row.seit) || 0) };
  } catch (_) {
    const e = _attempts.get(key);
    if (!e || Date.now() - e.firstAt > windowMin * 60000) return null;
    return { count: e.count, waitMin: Math.max(1, Math.ceil((e.firstAt + windowMin * 60000 - Date.now()) / 60000)),
             seitLetztem: (Date.now() - (e.lastAt ?? e.firstAt)) / 1000 };
  }
}

/**
 * Atomar hochzählen. Ein abgelaufenes Fenster startet neu — beides in EINEM
 * Statement, damit zwei gleichzeitige Fehlversuche nicht denselben Stand lesen.
 */
async function _bump(key: string, windowMin: number): Promise<void> {
  try {
    await db.run(
      `INSERT INTO rate_limit_attempts (key, count, first_at, last_at) VALUES ($1, 1, NOW(), NOW())
       ON CONFLICT (key) DO UPDATE SET
         last_at  = NOW(),
         count    = CASE WHEN rate_limit_attempts.first_at < NOW() - make_interval(mins => $2)
                         THEN 1 ELSE rate_limit_attempts.count + 1 END,
         first_at = CASE WHEN rate_limit_attempts.first_at < NOW() - make_interval(mins => $2)
                         THEN NOW() ELSE rate_limit_attempts.first_at END,
         laufend  = GREATEST(rate_limit_attempts.laufend - 1, 0)`,
      [key, windowMin]);
  } catch (_) {
    const now = Date.now();
    const e = _attempts.get(key);
    if (!e || now - e.firstAt > windowMin * 60000) _attempts.set(key, { count: 1, firstAt: now, lastAt: now, laufend: 0 });
    else { e.count++; e.lastAt = now; e.laufend = Math.max(0, (e.laufend || 0) - 1); }
    _prune();
  }
}

/** Ein reservierter Platz, dessen Prüfung nie gemeldet wurde, verfällt danach. */
const LAUFEND_VERFALL_S = 60;

type Stand = Zaehlerstand & { laufend: number };

/**
 * Einen Platz für einen Versuch belegen, BEVOR geprüft wird — unter einer
 * Zeilensperre, damit gleichzeitige Versuche einander sehen. `erlaubt` sieht
 * Fehlversuche und laufende Versuche; sagt es nein, wird nichts belegt.
 * Freigegeben wird der Platz durch _bump (Fehlschlag), _clear (Erfolg) oder
 * _freigeben.
 */
async function _reserviere(key: string, windowMin: number, erlaubt: (s: Stand) => boolean): Promise<{ ok: boolean; stand: Stand }> {
  try {
    return await db.transaction(async (tx) => {
      await tx.run(`INSERT INTO rate_limit_attempts (key, count, first_at, last_at, laufend)
                    VALUES ($1, 0, NOW(), NULL, 0) ON CONFLICT (key) DO NOTHING`, [key]);
      const r = await tx.get(
        `SELECT count, laufend,
                first_at < NOW() - make_interval(mins => $2) AS abgelaufen,
                COALESCE(laufend_seit < NOW() - make_interval(secs => $3), TRUE) AS laufend_alt,
                EXTRACT(EPOCH FROM (first_at + make_interval(mins => $2) - NOW()))/60 AS wait_min,
                EXTRACT(EPOCH FROM (NOW() - COALESCE(last_at, first_at))) AS seit
           FROM rate_limit_attempts WHERE key = $1 FOR UPDATE`, [key, windowMin, LAUFEND_VERFALL_S]);
      const neu = !!r.abgelaufen;
      const stand: Stand = {
        count: neu ? 0 : parseInt(r.count) || 0,
        laufend: r.laufend_alt ? 0 : parseInt(r.laufend) || 0,
        waitMin: neu ? windowMin : Math.max(1, Math.ceil(parseFloat(r.wait_min) || 1)),
        seitLetztem: Math.max(0, parseFloat(r.seit) || 0),
      };
      if (!erlaubt(stand)) return { ok: false, stand };
      await tx.run(
        `UPDATE rate_limit_attempts
            SET laufend = $2, laufend_seit = NOW(),
                count = CASE WHEN $3 THEN 0 ELSE count END,
                first_at = CASE WHEN $3 THEN NOW() ELSE first_at END
          WHERE key = $1`, [key, stand.laufend + 1, neu]);
      return { ok: true, stand };
    });
  } catch (_) {
    // Rückfall im Prozessspeicher: Dort ist dieser Block ohne await atomar.
    const now = Date.now();
    let e = _attempts.get(key);
    if (!e || now - e.firstAt > windowMin * 60000) { e = { count: 0, firstAt: now, lastAt: null, laufend: 0 }; _attempts.set(key, e); }
    const stand: Stand = { count: e.count, laufend: e.laufend || 0,
      waitMin: Math.max(1, Math.ceil((e.firstAt + windowMin * 60000 - now) / 60000)),
      seitLetztem: (now - (e.lastAt ?? e.firstAt)) / 1000 };
    if (!erlaubt(stand)) return { ok: false, stand };
    e.laufend = stand.laufend + 1;
    _prune();
    return { ok: true, stand };
  }
}

async function _freigeben(key: string): Promise<void> {
  try { await db.run('UPDATE rate_limit_attempts SET laufend = GREATEST(laufend - 1, 0) WHERE key = $1', [key]); }
  catch (_) { const e = _attempts.get(key); if (e) e.laufend = Math.max(0, (e.laufend || 0) - 1); }
}

async function _clear(key: string): Promise<void> {
  try { await db.run('DELETE FROM rate_limit_attempts WHERE key = $1', [key]); }
  catch (_) { _attempts.delete(key); }
}

/**
 * Vor der Passwortprüfung aufrufen.
 * @returns {Promise<string|null>} Sperr-Meldung oder null
 */
/**
 * Name und E-Mail desselben Kontos zählen gemeinsam — sonst gälte jede Grenze
 * doppelt. Unbekannte Namen zählen unter sich selbst.
 */
async function kontoKennung(username: unknown): Promise<string> {
  const roh = einzelwert(username).toLowerCase();
  const u = await db.get(
    'SELECT id FROM users WHERE lower(username) = $1 OR lower(email) = $1 ORDER BY id LIMIT 1', [roh]
  ).catch(() => null);
  return u ? `konto:${u.id}` : roh;
}

async function checkLoginAllowed(
  req: Request, username: unknown,
): Promise<{ code: FehlerCode; vars: { minuten: number } } | null> {
  // Belegt den Versuch schon jetzt (siehe _reserviere); recordLoginFailure,
  // recordLoginSuccess oder gibAnmeldeplatzFrei geben ihn wieder frei.
  const kennung = await kontoKennung(username);
  const adresse = await _reserviere(_key(req, kennung), WINDOW_MIN,
    s => s.count + s.laufend < MAX_ATTEMPTS);
  if (!adresse.ok)
    return { code: 'zu_viele_fehlversuche', vars: { minuten: adresse.stand.waitMin } };
  // Von einer Adresse, an der sich der Inhaber schon angemeldet hat, gilt nur
  // die Sperre je Adresse — sonst liesse sich die Wartezeit gegen ihn richten.
  if (await _read(_bekanntKey(req, kennung), BEKANNT_MIN)) return null;
  let rest = 0;
  const konto = await _reserviere(_nameKey(kennung), WINDOW_MIN, s => {
    rest = wartezeitSekunden(s.count) - s.seitLetztem;
    // In der Wartezeit-Phase höchstens ein Versuch zugleich je Konto.
    return rest <= 0 && (s.count < MAX_ATTEMPTS || s.laufend === 0);
  });
  if (!konto.ok) {
    await _freigeben(_key(req, kennung));
    return { code: 'zu_viele_fehlversuche', vars: { minuten: Math.max(1, Math.ceil(Math.max(rest, 1) / 60)) } };
  }
  return null;
}

/** Den belegten Versuch freigeben, ohne ihn zu zählen (etwa: Code fehlt noch). */
async function gibAnmeldeplatzFrei(req: Request, username: unknown): Promise<void> {
  const kennung = await kontoKennung(username);
  await _freigeben(_key(req, kennung));
  await _freigeben(_nameKey(kennung));
}

/** Nach einem fehlgeschlagenen Login aufrufen. */
async function recordLoginFailure(req: Request, username: unknown): Promise<void> {
  const kennung = await kontoKennung(username);
  await _bump(_key(req, kennung), WINDOW_MIN);
  await _bump(_nameKey(kennung), WINDOW_MIN);
}

/** Nach einem erfolgreichen Login aufrufen. */
async function recordLoginSuccess(req: Request, username: unknown): Promise<void> {
  const kennung = await kontoKennung(username);
  await _clear(_key(req, kennung));
  await _clear(_nameKey(kennung));
  await _bump(_bekanntKey(req, kennung), BEKANNT_MIN);
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
  // Belegt den Versuch wie checkLoginAllowed; Fehlgeschlagen/Gelungen geben ihn frei.
  const r = await _reserviere(_bestaetigungKey(uid), WINDOW_MIN, s => s.count + s.laufend < MAX_ATTEMPTS);
  return r.ok ? null : { code: 'zu_viele_fehlversuche', vars: { minuten: r.stand.waitMin } };
}
async function bestaetigungFehlgeschlagen(uid: number): Promise<void> { await _bump(_bestaetigungKey(uid), WINDOW_MIN); }
async function bestaetigungGelungen(uid: number): Promise<void> { await _clear(_bestaetigungKey(uid)); }

export { checkLoginAllowed, gibAnmeldeplatzFrei, recordLoginFailure, recordLoginSuccess, ipThrottle, MAX_ATTEMPTS, wartezeitSekunden,
         bestaetigungGesperrt, bestaetigungFehlgeschlagen, bestaetigungGelungen };
