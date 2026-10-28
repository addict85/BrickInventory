/**
 * Zentrale Auth-Helfer: Session ODER Bearer-Token (Android-App).
 * Ausführlich: docs/begruendungen/utils/auth.ts.md#abschnitt
 */

import * as db from '../db/database';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import type { Request, Response, NextFunction } from 'express';
import { checkLoginAllowed, gibAnmeldeplatzFrei, recordLoginFailure, recordLoginSuccess } from './loginLimiter';
import { sendeFehler } from './fehlerTexte';
import { logAndContinue } from './httpError';
import * as zf from './zweiterFaktor';
import { ausTabelle } from './validate';
import type { FehlerCode } from './fehlerTexte';

/**
 * Warum diese Typen hier stehen
 * Diese Datei hatte 20 implizite `any` — mehr als jede andere sicherheitsnahe
 * Stelle im Baum. Das ist die schlechteste Stelle dafuer: Wer hier einen
 * Feldnamen vertippt (`user.is_activ`), bekommt `undefined`, und `undefined` …
 * Ausführlich: docs/begruendungen/utils/auth.ts.md#tokenbenutzer
 */

/** Eine Zeile aus api_tokens JOIN users, wie validateToken sie liefert. */
export interface TokenBenutzer {
  /** api_tokens.user_id ist INTEGER; der pg-Treiber liefert dafuer `number` (nachgemessen). */
  user_id: number;
  username?: string;
  is_admin?: number | boolean;
  /** Die GLEITENDE Frist: „so lange ungenutzt" (siehe _touchLastUsed). */
  expires_at?: string | Date | null;
  /** Die FESTE Frist, falls beim QR-Code eine gewaehlt wurde. `null` = keine. */
  hard_expires_at?: string | Date | null;
  last_used?: string | Date | null;
  [k: string]: unknown;
}

/** Was der In-Memory-Cache je Token haelt. */
interface CacheEintrag {
  user: TokenBenutzer;
  cachedAt: number;
  lastUsedWritten: number;
  dbKey: string;
}

/** Die Konto-Felder, die assertLoginAllowed tatsaechlich prueft. */
export interface KontoZustand {
  is_active?: number | boolean | null;
  email_verified?: number | boolean | null;
  email?: string | null;
  is_admin?: number | boolean | null;
  [k: string]: unknown;
}

/**
 * Tokens werden seit diesem Stand NUR als SHA-256-Hash gespeichert — bei
 * einem DB-Leak sind die Klartext-Tokens damit nicht direkt verwendbar.
 * Es werden ausschliesslich Hashes gespeichert und gesucht:
 * der Lookup fällt auf Klartext zurück und upgraded die Zeile in-place
 * auf den Hash. Der Client (Android/Webapp/QR) erhält weiterhin den
 * Klartext-Token — nur die DB-Seite ist gehasht.
 */
/** @param {string} token @returns {string} SHA-256-Hex */
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * E-Mail-Verifikation: einen Token einlösen.
 * Ausführlich: docs/begruendungen/utils/auth.ts.md#verifiziereemailtoken
 * @param {string|undefined|null} token Der ROHE Token aus der URL, ungehasht.
 * @returns {Promise<{ok: boolean, grund?: string, userId?: number}>}
 */
async function verifiziereEmailToken(token: unknown): Promise<{ ok: boolean; grund?: string; userId?: number }> {
  // Leerstring und Whitespace zählen wie „nicht da" — sonst schlüge unten
  // der Hash eines leeren Strings in der DB auf, und das ist ein gültiger
  // SHA-256-Wert, der theoretisch in einer Zeile stehen könnte.
  if (token === undefined || token === null || String(token).trim() === '') {
    return { ok: false, grund: 'fehlt' };
  }
  // verification_token liegt seit dem Token-Hardening nur noch als SHA-256 in
  // der DB. Klartext nachzuschlagen fände nie etwas.
  const user = await db.get(
    'SELECT id FROM users WHERE verification_token = $1 AND token_expires > NOW() AND email_verified = 0',
    [hashToken(String(token))]
  );
  if (!user) return { ok: false, grund: 'ungueltig' };
  // Token-Felder mit abräumen: Ein zweiter Klick auf denselben Link soll
  // NICHT nochmals „erfolgreich" melden, und ein liegengebliebener Hash wäre
  // ein unnötig lange gültiges Geheimnis in der Datenbank.
  await db.run(
    'UPDATE users SET email_verified=1, verification_token=NULL, token_expires=NULL WHERE id=$1',
    [user.id]
  );
  return { ok: true, userId: user.id };
}

const TOKEN_TTL_MS      = 60 * 1000;       // Cache-Gültigkeit
const LAST_USED_THROTTLE = 5 * 60 * 1000;  // last_used max. alle 5 Min schreiben

// token → { user: {user_id, username, is_admin, expires_at}, cachedAt, lastUsedWritten }
const _tokenCache = new Map();

// Cache klein halten — bei einer Handvoll Nutzern reichen 200 Einträge locker.
function _pruneCache() {
  if (_tokenCache.size <= 200) return;
  const cutoff = Date.now() - TOKEN_TTL_MS;
  for (const [k, v] of _tokenCache) {
    if (v.cachedAt < cutoff) _tokenCache.delete(k);
  }
}

/**
 * @typedef {Object} TokenUser
 * @property {number|string} user_id
 * @property {string} username
 * @property {number|boolean} is_admin
 * @property {string|null} expires_at
 * @property {string|null} [last_used]
 */

/**
 * Validiert einen Bearer-Token. Nutzt den In-Memory-Cache; DB nur bei Miss.
 * @param {string|null|undefined} token
 * @returns {Promise<TokenUser|null>}
 */
/**
 * Ist dieser Zeitpunkt erreicht? `null`/leer heisst „keine Frist", also nein.
 *
 * Steht als Funktion da, weil die Frage seit der festen Laufzeit ZWEIMAL im
 * selben Zweig gestellt wird (gleitende und feste Frist) — und weil `null`
 * hier „unbegrenzt" bedeutet und nicht „sofort abgelaufen".
 */
function fristErreicht(zeitpunkt: string | Date | null | undefined, jetzt: number): boolean {
  return !!zeitpunkt && new Date(zeitpunkt).getTime() <= jetzt;
}

async function validateToken(token: string | null | undefined): Promise<TokenBenutzer | null> {
  if (!token) return null;
  const now = Date.now();

  const hit = _tokenCache.get(token);
  if (hit && now - hit.cachedAt < TOKEN_TTL_MS) {
    // Ablauf auch bei Cache-Treffern respektieren — BEIDE Fristen.
    //
    // `hard_expires_at` muss hier eigens stehen und nicht bloss in der
    // WHERE-Klausel unten: Dieser Zweig fragt die Datenbank gar nicht. Ohne
    // die zweite Bedingung bediente der Cache einen Token noch bis zu
    // TOKEN_TTL_MS ueber seinen festen Termin hinaus — bei einer Frist, die
    // der Nutzer AUSDRUECKLICH gesetzt hat, ist das die falsche Seite zum
    // Irren.
    if (fristErreicht(hit.user.expires_at, now) || fristErreicht(hit.user.hard_expires_at, now)) {
      _tokenCache.delete(token);
      return null;
    }
    _touchLastUsed(token, hit);
    return hit.user;
  }

  const hashed = hashToken(token);
  const SQL = `
    SELECT t.user_id, t.expires_at, t.hard_expires_at, t.last_used, t.sliding,
           u.username, u.is_admin
    FROM api_tokens t JOIN users u ON u.id = t.user_id
    WHERE t.token = $1
      AND (t.expires_at      IS NULL OR t.expires_at      > NOW())
      AND (t.hard_expires_at IS NULL OR t.hard_expires_at > NOW())`;
  // Nur noch der Hash-Pfad.
  // Ausführlich: docs/begruendungen/utils/auth.ts.md#validatetoken-row
  const row = await db.get(SQL, [hashed]);
  const dbKey = hashed;
  if (!row) { _tokenCache.delete(token); return null; }

  const entry = { user: row, cachedAt: now, lastUsedWritten: 0, dbKey };
  _tokenCache.set(token, entry);
  _pruneCache();
  _touchLastUsed(token, entry);
  return row;
}

// last_used gedrosselt und fire-and-forget aktualisieren — blockiert den
// Request-Pfad nicht und schreibt höchstens alle 5 Minuten pro Token.
function _touchLastUsed(token: string, entry: CacheEintrag): void {
  const now = Date.now();
  if (now - entry.lastUsedWritten < LAST_USED_THROTTLE) return;
  entry.lastUsedWritten = now;
  // Die stille Erneuerung
  // Hier wird nicht nur vermerkt, DASS der Token benutzt wurde, sondern die
  // Frist gleich mit nach vorn geschoben. Genau das macht sie zur gleitenden:
  // Ein Telefon, das taeglich synchronisiert, laeuft nie ab; eines, das in …
  // Ausführlich: docs/begruendungen/utils/auth.ts.md#touchlastused-gleitet
  const gleitet = TOKEN_IDLE_DAYS > 0;
  const sql = gleitet
    ? `UPDATE api_tokens
          SET last_used = NOW(),
              expires_at = CASE WHEN sliding AND expires_at IS NOT NULL
                                THEN NOW() + make_interval(days => $2)
                                ELSE expires_at END
        WHERE token = $1`
    : 'UPDATE api_tokens SET last_used = NOW() WHERE token = $1';
  const params = gleitet
    ? [entry.dbKey || hashToken(token), TOKEN_IDLE_DAYS]
    : [entry.dbKey || hashToken(token)];
  db.run(sql, params)
    .then(() => {
      // Den Cache mitziehen. Ohne das haelt er bis zu TOKEN_TTL_MS (eine
      // Minute) das ALTE Datum und wuerde einen gerade erneuerten Token am
      // Fristende einmal faelschlich abweisen — der Treffer-Zweig oben prueft
      // `hit.user.expires_at` selbst.
      if (gleitet && entry.user?.sliding && entry.user.expires_at)
        entry.user.expires_at = new Date(now + TOKEN_IDLE_DAYS * 86400_000);
    })
    .catch(e => console.warn('[auth] last_used konnte nicht geschrieben werden:', e?.message || e));
}

/**
 * Ein Widerruf muss in JEDEM Worker wirken, nicht nur im eigenen.
 *
 * Jeder Worker hat seinen eigenen Cache. Ohne Signal bediente ein anderer
 * einen widerrufenen Token noch bis zu TOKEN_TTL_MS. Die Empfänger leeren
 * ganz: Den Klartext schicken wir nicht über die Datenbank, und nach ihm ist
 * der Cache indiziert.
 */
export const TOKEN_KANAL = 'tokens_geaendert';

function meldeTokenWiderruf(): void {
  require('./pgNotify').notify(TOKEN_KANAL).catch(logAndContinue('tokens:widerruf melden'));
}

/** Nur der eigene Cache — für den Empfang des Signals, das nicht zurückfunken darf. */
function leereTokenCacheLokal(): void { _tokenCache.clear(); }

/**
 * Den Empfang anmelden. Beim (Wieder-)Verbinden ruft pgNotify den Handler
 * einmal ohne Signal auf — dann wird ebenfalls geleert, die sichere Seite.
 */
function horcheAufTokenWiderruf(): void {
  require('./pgNotify').listen(TOKEN_KANAL, () => leereTokenCacheLokal());
}

/** Beim Logout/Token-Löschen aufrufen, damit der Token sofort ungültig wird. */
function invalidateToken(token: string | null | undefined): void {
  if (!token) return;
  _tokenCache.delete(token);
  meldeTokenWiderruf();
}

/**
 * Den ganzen Token-Cache verwerfen — für Löschungen ohne Klartext (die
 * Token-Verwaltung kennt nur den Hash-Anfang). Gilt für alle Worker.
 */
function leereTokenCache(): void {
  leereTokenCacheLokal();
  meldeTokenWiderruf();
}

/**
 * Ist diese Datenbank-Flagge gesetzt?
 * Ausführlich: docs/begruendungen/utils/auth.ts.md#flaggegesetzt
 */
function flaggeGesetzt(wert: unknown): boolean {
  return wert === true || wert == 1;
}

// ── Gemeinsame Login-/Konto-Regeln ────────────────────────────────────────────
// Vorher existierten diese Regeln nur im Webapp-Login (routes/auth.ts).
// /api/v1/auth/login hat weder is_active noch email_verified geprüft — ein
// deaktiviertes oder nie bestätigtes Konto konnte sich über die Android-API
// anmelden und bekam dort einen Token OHNE Ablaufdatum. Genau die Sorte
// Divergenz, die api-parity.test.js für Daten schon abfängt; jetzt gibt es
// für die Vorbedingungen eine einzige Quelle.

/**
 * Session-ID erneuern und danach die Anmeldedaten hineinschreiben.
 * Ausführlich: docs/begruendungen/utils/auth.ts.md#establishsession
 * @param {any} req
 * @param {{userId:number, username:string, isAdmin:boolean}} data
 */
function establishSession(req: Request, data: { userId: number; username: string; isAdmin: boolean }): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!req.session?.regenerate) {   // z. B. in Tests ohne Session-Middleware
      // Bewusste Ausnahme, benannt statt weggedrueckt: Ohne
      // express-session-Middleware gibt es kein Session-Objekt mit id/cookie.
      // Dieser Zweig existiert NUR fuer Tests — im Betrieb steht die
      // Middleware immer davor, und dann greift regenerate() darueber.
      Object.assign(req.session || (req.session = {} as typeof req.session), data, { angemeldetAm: Date.now() });
      return resolve(undefined);
    }
    req.session.regenerate((err?: any) => {
      if (err) return reject(err);
      Object.assign(req.session, data, { angemeldetAm: Date.now() });
      // Sofort schreiben, damit die neue ID auch dann gültig ist, wenn der
      // Client unmittelbar danach eine zweite Anfrage stellt.
      req.session.save((e2?: any) => (e2 ? reject(e2) : resolve(undefined)));
    });
  });
}

/** Kostenfaktor für bcrypt.hash — überall derselbe (vorher 10 bzw. 12 gemischt). */
const BCRYPT_ROUNDS = 12;

/**
 * Wie kurz ein Passwort hoechstens sein darf.
 * Ausführlich: docs/begruendungen/utils/auth.ts.md#passwort-min-zeichen
 */
const PASSWORT_MIN_ZEICHEN = 8;

/**
 * Ist dieses Passwort zu kurz?
 * Ausführlich: docs/begruendungen/utils/auth.ts.md#passwortzukurz
 * @param passwort  der Rohwert aus dem Anfragerumpf
 */
function passwortZuKurz(passwort: unknown): boolean {
  return String(passwort ?? '').length < PASSWORT_MIN_ZEICHEN;
}

/** Erlaubte Benutzernamen. Login und Register erzwangen das bereits, das Profil-Update nicht. */
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;

/**
 * Erlaubte E-Mail-Adressen — dieselbe Prüfung wie bei der Registrierung.
 * Bewusst grob: Die Adresse wird ohnehin gegen die Datenbank geprüft, und
 * strengere Muster lehnen regelmässig gültige Adressen ab.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Darf das als ANMELDENAME durchgehen?
 * Ausführlich: docs/begruendungen/utils/auth.ts.md#isvalidloginidentifier
 */
function isValidLoginIdentifier(value: unknown): boolean {
  const v = String(value || '');
  return USERNAME_RE.test(v) || (v.length <= 254 && EMAIL_RE.test(v));
}

/**
 * Prüft die Konto-Vorbedingungen NACH erfolgreicher Passwortprüfung.
 * Die Absage kommt als CODE zurueck, nicht als Satz (Nachtrag 130): Dieser
 * Helfer weiss nicht, welche Sprache der Anfragende sieht — die Route weiss es.
 *
 * @returns null = Login erlaubt
 */
function assertLoginAllowed(user: KontoZustand):
    { status: number; code: FehlerCode; unverified?: boolean } | null {
  if (user.is_active === 0 || user.is_active === false)
    return { status: 403, code: 'konto_deaktiviert' };
  if ((user.email_verified === 0 || user.email_verified === false) && user.email && !user.is_admin)
    return { status: 403, code: 'email_nicht_bestaetigt', unverified: true };
  return null;
}

/**
 * Fester bcrypt-Hash für Anmeldeversuche mit unbekanntem Benutzernamen.
 *
 * Der Klartext dazu ist bedeutungslos — der Hash wird nur benutzt, damit
 * bcrypt.compare() im Fehlerfall dieselbe Zeit verbraucht wie bei einem
 * existierenden Konto. Einmal beim Start erzeugt, mit denselben Runden wie
 * echte Passwörter, damit die Kosten wirklich gleich sind.
 */
const DUMMY_HASH = bcrypt.hashSync('nonexistent-account-placeholder', BCRYPT_ROUNDS);

/** Absage an einen Anmeldeversuch — fertig zum Verschicken. */
export interface AnmeldeAbsage {
  status: number;
  /**
   * Der Grund als SCHLUESSEL, nicht als Satz (Nachtrag 130).
   *
   * Diese Funktion laeuft ohne zu wissen, welche Sprache der Anfragende sieht.
   * Die Route weiss es (Accept-Language) und macht daraus mit sendeFehler()
   * einen Satz.
   */
  code: FehlerCode;
  /** Werte fuer die Platzhalter des Textes, falls er welche hat. */
  vars?: Record<string, string | number>;
  /** Nur bei unbestätigter E-Mail: Der Client blendet dann das Erneut-senden an. */
  unverified?: boolean;
  /** Passwort stimmt, es fehlt (oder scheiterte) der Code des zweiten Faktors. */
  zweiterFaktor?: boolean;
}

/** Ergebnis von pruefeAnmeldedaten(): entweder die Konto-Zeile oder eine Absage. */
export type AnmeldeErgebnis =
  | { ok: true; user: Record<string, any> }
  | { ok: false; absage: AnmeldeAbsage };

/**
 * Anmeldedaten prüfen — die einzige Stelle im Baum, an der das passiert.
 * Ausführlich: docs/begruendungen/utils/auth.ts.md#pruefeanmeldedaten
 * @param req      Für den Brute-Force-Zähler (IP) gebraucht.
 * @param username Benutzername ODER E-Mail-Adresse.
 * @param password Klartext-Passwort aus dem Request.
 * @param code     Einmal- oder Wiederherstellungscode (utils/zweiterFaktor.ts).
 */
async function pruefeAnmeldedaten(req: Request, username: unknown, password: unknown, code?: unknown): Promise<AnmeldeErgebnis> {
  // Die Absage traegt einen CODE und keinen Satz (Nachtrag 130): Welche
  // Sprache der Anfragende sieht, weiss die Route.
  const absage = (status: number, code: FehlerCode,
                  vars?: Record<string, string | number>, unverified?: boolean,
                  zweiterFaktor?: boolean): AnmeldeErgebnis =>
    ({ ok: false, absage: { status, code, ...(vars ? { vars } : {}),
                            ...(unverified ? { unverified: true } : {}),
                            ...(zweiterFaktor ? { zweiterFaktor: true } : {}) } });

  if (!username || !password)
    return absage(400, 'benutzername_passwort');
  if (!isValidLoginIdentifier(username))
    return absage(400, 'name_oder_email_eingeben');

  const name = String(username);
  const gesperrt = await checkLoginAllowed(req, name);
  if (gesperrt) return absage(429, gesperrt.code, gesperrt.vars);

  // Anmeldung per E-Mail ist erlaubt — so steht es über dem Feld.
  const user = await db.get(
    'SELECT * FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1)', [name]);
  // bcrypt.compare (async) statt compareSync — blockiert den Event-Loop nicht.
  // Der Vergleich läuft auch ohne Treffer, gegen DUMMY_HASH (s. o.).
  const passtDasPasswort = await bcrypt.compare(String(password), user?.password_hash || DUMMY_HASH);
  if (!user || !passtDasPasswort) {
    await recordLoginFailure(req, name);
    return absage(401, 'anmeldedaten_ungueltig');
  }
  const blockiert = assertLoginAllowed(user);
  if (blockiert) { await recordLoginSuccess(req, name); return absage(blockiert.status, blockiert.code, undefined, blockiert.unverified); }

  if (await zf.istAktiv(user.id)) {
    if (!String(code ?? '').trim()) {
      // Das Passwort stimmte; nur der Code fehlt noch — kein Fehlversuch.
      await gibAnmeldeplatzFrei(req, name);
      return absage(401, 'zweiter_faktor_noetig', undefined, false, true);
    }
    if (!await zf.pruefeCode(user.id, code)) {
      await recordLoginFailure(req, name);
      return absage(401, 'zweiter_faktor_falsch', undefined, false, true);
    }
  }
  await recordLoginSuccess(req, name);
  return { ok: true, user };
}

/**
 * Escaped LIKE-Sonderzeichen. Ohne das löscht ein "%" als tokenId in
 * DELETE /api/settings/tokens/:tokenId alle Tokens des Nutzers auf einmal.
 * @param {string} s
 */
function escapeLike(s: unknown): string { return String(s ?? '').replace(/([%_\\])/g, '\\$1'); }

/**
 * Warum es hier KEINE Liste mehr gibt: ?token= zaehlt nirgends.
 * Ausführlich: docs/begruendungen/utils/auth.ts.md#abschnitt-2
 */

/**
 * Ermittelt die userId aus Session oder Bearer-Token.
 * Ausführlich: docs/begruendungen/utils/auth.ts.md#resolveuserid
 * @param req Express-Request
 * @returns {Promise<number|null>} null wenn nicht authentifiziert
 */
async function resolveUserId(req: Request): Promise<number | null> {
  if (req.session?.userId) return req.session.userId;
  const auth = req.headers.authorization || '';
  const token: string | null = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const user = await validateToken(token).catch(() => null);
  // Der ganze Nutzer wird abgelegt, nicht nur seine Kennung: Sonst wuesste ein
  // Handler hinter requireLoginOrToken zwar WER fragt, aber nicht, ob es ein
  // Verwalter ist — `req.session.isAdmin` ist bei einer Token-Anfrage immer
  // undefined. Das faellt nicht als Fehler auf, sondern liefert stillschweigend …
  // Ausführlich: docs/begruendungen/utils/auth.ts.md#resolveuserid-2
  if (user) req.apiUser = { ...user, is_admin: user.is_admin ? 1 : 0 };
  return user ? user.user_id : null;
}

/**
 * Express-Middleware: Session ODER Bearer-Token, setzt req.tokenUserId.
 * Ausführlich: docs/begruendungen/utils/auth.ts.md#loginortokenguard
 * @param opts.timeoutMs Antwortet nach dieser Zeit mit 503, statt zu warten.
 */
function loginOrTokenGuard(opts: { timeoutMs?: number } = {}) {
  return async function requireLoginOrToken(req: Request, res: Response, next: NextFunction) {
    if (req.session?.userId) return next();
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          if (!res.headersSent) sendeFehler(req, res, 503, 'server_ausgelastet');
        }, opts.timeoutMs)
      : null;
    let uid: number | null = null;
    try { uid = await resolveUserId(req); } catch (_) { uid = null; }
    if (timer) clearTimeout(timer);
    if (res.headersSent) return;               // Zeitlimit war schneller
    if (uid) { req.tokenUserId = uid; return next(); }
    return sendeFehler(req, res, 401, 'nicht_angemeldet');
  };
}

const requireLoginOrToken = loginOrTokenGuard();

/**
 * Wer fragt hier? — Sitzung ODER Bearer-Token, EINE Antwort.
 * Ausführlich: docs/begruendungen/utils/auth.ts.md#nutzerid
 * @returns Die Nutzerkennung als Zahl, oder null wenn niemand angemeldet ist.
 */
function nutzerId(req: Request): number | null {
  const roh = req.session?.userId ?? req.tokenUserId ?? (req as any).apiUser?.user_id;
  if (roh == null) return null;
  const n = Number(roh);
  return Number.isFinite(n) ? n : null;
}

/**
 * Ist dieser Anfragende ein Verwalter? — Sitzung ODER Bearer-Token.
 * Ausführlich: docs/begruendungen/utils/auth.ts.md#abschnitt-3
 */
/**
 * Wie [nutzerId], aber fuer Handler, die HINTER einem Waechter stehen.
 * Ausführlich: docs/begruendungen/utils/auth.ts.md#angemeldetenutzerid
 */
function angemeldeteNutzerId(req: Request): number {
  const id = nutzerId(req);
  if (id == null) {
    throw new Error('angemeldeteNutzerId ohne Anmeldung — die Route steht vor ihrem Waechter');
  }
  return id;
}

/**
 * Wie heisst der Anfragende? — Sitzung ODER Bearer-Token.
 * Ausführlich: docs/begruendungen/utils/auth.ts.md#nutzername
 */
function nutzerName(req: Request): string | null {
  return req.session?.username ?? (req as any).apiUser?.username ?? null;
}

function istVerwalter(req: Request): boolean {
  if (req.session?.isAdmin) return true;
  return !!(req as any).apiUser?.is_admin;
}

/**
 * Einen Bearer-Token ausstellen.
 * Ausführlich: docs/begruendungen/utils/auth.ts.md#abschnitt-4
 * @param dauerhaft true = kein Ablaufdatum (App, QR-Anmeldung).
 */
/**
 * Der Wert, mit dem „unbegrenzt" in der Tageszahl steht.
 * Ausführlich: docs/begruendungen/utils/auth.ts.md#unbegrenzt
 */
const UNBEGRENZT = 0;

/**
 * Die WAEHLBAREN festen Laufzeiten eines QR-Zugangs, in Tagen.
 * Ausführlich: docs/begruendungen/utils/auth.ts.md#token-laufzeiten
 */
const TOKEN_LAUFZEITEN: Record<string, number> = {
  '1m':  30,
  '2m':  60,
  '6m':  180,
  '12m': 365,
  // Marcos ausdrueckliche Wahl. Sie nimmt die einzige selbsttaetige Reissleine
  // fuer ein verlorenes Geraet weg — was das heisst, steht in
  // db/migrations/0017-token-unbegrenzt.sql. Sie ist deshalb nicht die
  // Vorgabe: Wer nichts waehlt, bekommt weiterhin die Gleitfrist.
  'unbegrenzt': UNBEGRENZT,
};

/**
 * Eine Laufzeit-Angabe aus einer Anfrage in Tage uebersetzen.
 * Ausführlich: docs/begruendungen/utils/auth.ts.md#laufzeittage
 * @returns Tage, oder null fuer „keine feste Frist" (nichts gewaehlt, oder
 */
function laufzeitTage(wahl: unknown): number | null {
  if (wahl === undefined || wahl === null || wahl === '') return null;
  return ausTabelle(TOKEN_LAUFZEITEN, String(wahl)) ?? null;
}

async function createToken(userId: number, label = 'Android App', dauerhaft = false,
                           festeTage: number | null = null): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  if (dauerhaft) {
    // Gleitende Frist statt gar keiner. Bis hierher stand hier NULL, und die
    // 90 Tage aus TOKEN_IDLE_DAYS setzte allein der stuendliche Aufraeumjob
    // durch — per DELETE. Lief der Job nicht (kein Primary-Worker, Absturz,
    // ein Neustart zur falschen Stunde), galt der Token weiter, denn die …
    // Ausführlich: docs/begruendungen/utils/auth.ts.md#createtoken
    if (festeTage === UNBEGRENZT) {
      await db.run(
        `INSERT INTO api_tokens (token, user_id, label, expires_at, sliding, hard_expires_at, never_expires)
         VALUES ($1,$2,$3,NULL,FALSE,NULL,TRUE) ON CONFLICT DO NOTHING`,
        [hashToken(token), userId, label]
      );
      return token;
    }
    const fest = festeTage && festeTage > 0 ? festeTage : null;
    await db.run(
      TOKEN_IDLE_DAYS > 0
        ? `INSERT INTO api_tokens (token, user_id, label, expires_at, sliding, hard_expires_at)
           VALUES ($1,$2,$3, NOW() + make_interval(days => $4), TRUE,
                   CASE WHEN $5::int IS NULL THEN NULL ELSE NOW() + make_interval(days => $5::int) END)
           ON CONFLICT DO NOTHING`
        : `INSERT INTO api_tokens (token, user_id, label, expires_at, sliding, hard_expires_at)
           VALUES ($1,$2,$3,NULL,TRUE,
                   CASE WHEN $4::int IS NULL THEN NULL ELSE NOW() + make_interval(days => $4::int) END)
           ON CONFLICT DO NOTHING`,
      TOKEN_IDLE_DAYS > 0
        ? [hashToken(token), userId, label, TOKEN_IDLE_DAYS, fest]
        : [hashToken(token), userId, label, fest]
    );
  } else {
    // Der Token des Browsers gleitet NICHT: Er liegt im sessionStorage und ist
    // damit per XSS auslesbar. Sieben feste Tage sind hier Absicht — eine
    // gleitende Frist wuerde ihn genau so lange am Leben halten, wie ein
    // Angreifer ihn benutzt.
    await db.run(
      "INSERT INTO api_tokens (token, user_id, label, expires_at, sliding) VALUES ($1,$2,$3, NOW() + INTERVAL '7 days', FALSE) ON CONFLICT DO NOTHING",
      [hashToken(token), userId, label]
    );
  }
  return token;
}

/**
 * Bekommt ein App-Token ueberhaupt ein Ablaufdatum?
 *
 * Genau dann nicht, wenn die Gleitfrist abgeschaltet ist. Die Antwort steht
 * hier statt an den drei Routen, die sie als `never_expires` weitergeben —
 * sonst waere die Regel wieder an mehreren Stellen buchstabiert.
 */
function appTokenOhneAblauf(): boolean { return TOKEN_IDLE_DAYS === 0; }

/**
 * Löscht einen Token und invalidiert den Cache.
 * @param {string|null|undefined} token
 * @returns {Promise<void>}
 */
async function deleteToken(token: string): Promise<void> {
  if (!token) return;
  await db.run('DELETE FROM api_tokens WHERE token = $1', [hashToken(token)]);
  invalidateToken(token);
}

/**
 * Alle Tokens eines Nutzers verwerfen.
 * Ausführlich: docs/begruendungen/utils/auth.ts.md#abschnitt-5
 * @param {number} userId
 * @returns {Promise<void>}
 */
/**
 * Alle offenen BROWSER-SITZUNGEN eines Kontos beenden.
 * Ausführlich: docs/begruendungen/utils/auth.ts.md#revokeallsessions
 */
async function revokeAllSessions(userId: number): Promise<void> {
  await db.run("DELETE FROM user_sessions WHERE sess::jsonb->>'userId' = $1", [String(userId)]);
}

/**
 * Alle Zugänge eines Kontos ausser dem gerade benutzten beenden — nach dem
 * Einschalten des zweiten Faktors: Ein Angreifer, der schon drin war, soll
 * nicht mit einem alten Token oder einer alten Sitzung drinbleiben.
 */
async function beendeAndereZugaenge(userId: number, aktuellerToken: string | null, sitzungsId: string | null): Promise<void> {
  if (aktuellerToken) {
    await db.run('DELETE FROM api_tokens WHERE user_id = $1 AND token <> $2', [userId, hashToken(aktuellerToken)]);
  } else {
    await db.run('DELETE FROM api_tokens WHERE user_id = $1', [userId]);
  }
  leereTokenCache();
  await db.run("DELETE FROM user_sessions WHERE sess::jsonb->>'userId' = $1 AND sid IS DISTINCT FROM $2",
    [String(userId), sitzungsId]);
}

async function revokeAllTokens(userId: number): Promise<void> {
  // Ohne .catch(() => {}): Das Verwerfen aller Tokens ist ein Sicherheitsschritt
  // (Passwortwechsel, Zurücksetzen). Scheitert es still, meldet der Aufrufer
  // Erfolg, während die alten Tokens weitergelten — und der geleerte Cache
  // lässt sie beim nächsten Request sogar frisch aus der DB nachladen.
  await db.run('DELETE FROM api_tokens WHERE user_id = $1', [userId]);
  leereTokenCache();
}

/**
 * Tage ohne Nutzung, nach denen ein Token OHNE Ablaufdatum verfällt.
 * 0 schaltet die Regel ab (dann gilt wieder: unbegrenzt).
 * Ausführlich: docs/begruendungen/utils/auth.ts.md#token-idle-days
 */
const TOKEN_IDLE_DAYS = (() => {
  const roh = process.env.TOKEN_IDLE_DAYS;
  if (roh === undefined || roh === '') return 90;
  const n = parseInt(roh, 10);
  if (!Number.isFinite(n) || n < 0) {
    console.warn(`[auth] TOKEN_IDLE_DAYS="${roh}" ist keine gültige Tageszahl — es gelten 90 Tage.`);
    return 90;
  }
  return n;
})();

/**
 * Tokens aufräumen: abgelaufene, und solche, die zu lange ungenutzt sind.
 * Ausführlich: docs/begruendungen/utils/auth.ts.md#purgeexpiredtokens
 * @returns {Promise<number>} Anzahl gelöschter Zeilen
 */
async function purgeExpiredTokens() {
  let entfernt = 0;

  // Altzeilen nachziehen, BEVOR geloescht wird
  // Auf einer gewachsenen Datenbank stehen App- und QR-Token noch ohne
  // Ablaufdatum. Ihre Frist lief bisher ueber COALESCE(last_used, created_at)
  // — genau diese Rechnung wird hier einmal in die Spalte geschrieben. Damit …
  // Ausführlich: docs/begruendungen/utils/auth.ts.md#purgeexpiredtokens-2
  if (TOKEN_IDLE_DAYS > 0) {
    const nachgezogen = await db.run(
      `UPDATE api_tokens
          SET sliding = TRUE,
              expires_at = COALESCE(last_used, created_at) + make_interval(days => $1)
        WHERE expires_at IS NULL AND NOT never_expires`,
      [TOKEN_IDLE_DAYS]
    ).catch(e => { console.warn('[tokens] Altzeilen nachziehen:', e?.message || e); return null; });
    const m = nachgezogen?.changes || 0;
    if (m) console.log(`[tokens] ${m} Token ohne Ablaufdatum auf die Gleitfrist von ${TOKEN_IDLE_DAYS} Tagen gesetzt`);
  }

  // Beide Fristen in EINEM DELETE: die gleitende (expires_at) und die feste,
  // die der Nutzer beim QR-Code gewaehlt hat (hard_expires_at). Ein zweites
  // DELETE daneben waere die naechste Stelle, an der jemand nur eine der
  // beiden Regeln nachzieht.
  const abgelaufen = await db.run(
    `DELETE FROM api_tokens
      WHERE (expires_at      IS NOT NULL AND expires_at      < NOW())
         OR (hard_expires_at IS NOT NULL AND hard_expires_at < NOW())`
  ).catch(e => { console.warn('[tokens] Aufräumen abgelaufener Tokens:', e?.message || e); return null; });
  entfernt += abgelaufen?.changes || 0;

  // Diese zweite Regel trifft seit der Umstellung oben kaum noch etwas: Nach
  // `AND NOT never_expires` in beiden Abfragen: Eine Zeile ohne Datum ist
  // entweder eine ALTZEILE (die soll nachgezogen und irgendwann geraeumt
  // werden) oder eine ausdrueckliche Wahl „unbegrenzt" (die soll genau das …
  // Ausführlich: docs/begruendungen/utils/auth.ts.md#purgeexpiredtokens-3
  if (TOKEN_IDLE_DAYS > 0) {
    const ungenutzt = await db.run(
      `DELETE FROM api_tokens
        WHERE expires_at IS NULL AND NOT never_expires
          AND COALESCE(last_used, created_at) < NOW() - make_interval(days => $1)`,
      [TOKEN_IDLE_DAYS]
    ).catch(e => { console.warn('[tokens] Aufräumen ungenutzter Tokens:', e?.message || e); return null; });
    const n = ungenutzt?.changes || 0;
    if (n) console.log(`[tokens] ${n} Token seit über ${TOKEN_IDLE_DAYS} Tagen ungenutzt — entfernt`);
    entfernt += n;
  }
  return entfernt;
}

export {
  validateToken, invalidateToken, leereTokenCache, horcheAufTokenWiderruf, flaggeGesetzt, resolveUserId, requireLoginOrToken, nutzerId, angemeldeteNutzerId, istVerwalter, nutzerName, hashToken, deleteToken,
  verifiziereEmailToken,
  revokeAllTokens, revokeAllSessions, beendeAndereZugaenge, purgeExpiredTokens, loginOrTokenGuard, TOKEN_IDLE_DAYS, appTokenOhneAblauf,
  laufzeitTage,
  assertLoginAllowed, pruefeAnmeldedaten, createToken, escapeLike, establishSession, BCRYPT_ROUNDS, USERNAME_RE,
  PASSWORT_MIN_ZEICHEN, passwortZuKurz,
  EMAIL_RE, isValidLoginIdentifier,
};
