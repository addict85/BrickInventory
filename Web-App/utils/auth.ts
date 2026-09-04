/**
 * Zentrale Auth-Helfer: Session ODER Bearer-Token (Android-App).
 *
 * Warum ein eigener Token-Cache: Die Android-App feuert beim Öffnen 5–8
 * API-Requests parallel. Vorher hat JEDER Request ein SELECT auf api_tokens
 * plus ein blockierendes UPDATE (last_used) ausgelöst — zwei DB-Roundtrips
 * pro Request nur für die Auth. Der Cache hält validierte Tokens 60s im
 * Speicher; last_used wird höchstens alle 5 Minuten und fire-and-forget
 * (ohne await im Request-Pfad) geschrieben.
 *
 * Cache-Invalidierung: Beim Logout/Token-Löschen invalidateToken() aufrufen.
 * Worst Case ohne Aufruf: ein gelöschter Token funktioniert max. 60s weiter —
 * für diese App ein akzeptabler Trade-off. (Cluster: Cache ist pro Worker.)
 */

import * as db from '../db/database';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import type { Request, Response, NextFunction } from 'express';
import { vorDem } from '../utils/httpError';
import { checkLoginAllowed, recordLoginFailure, recordLoginSuccess } from './loginLimiter';

/**
 * ── Warum diese Typen hier stehen (Nachtrag 155) ─────────────────────────────
 *
 * Diese Datei hatte 20 implizite `any` — mehr als jede andere sicherheitsnahe
 * Stelle im Baum. Das ist die schlechteste Stelle dafuer: Wer hier einen
 * Feldnamen vertippt (`user.is_activ`), bekommt `undefined`, und `undefined`
 * ist falsy — die Sperre eines deaktivierten Kontos faellt still aus. Genau so
 * ein Fehler ist ohne Typpruefung nicht zu sehen.
 *
 * Die JSDoc darunter beschrieb die Typen laengst korrekt; sie standen nur nicht
 * in den Signaturen. Hier wird also nichts erfunden, sondern aufgeschrieben,
 * was schon dokumentiert war.
 *
 * Ein Kommentar an resolveUserId behauptete "any bis @types/express installiert
 * ist" — @types/express IST installiert, samt @types/express-session. Der
 * Vorbehalt war ueberholt.
 */

/** Eine Zeile aus api_tokens JOIN users, wie validateToken sie liefert. */
export interface TokenBenutzer {
  /** api_tokens.user_id ist INTEGER; der pg-Treiber liefert dafuer `number` (nachgemessen). */
  user_id: number;
  username?: string;
  is_admin?: number | boolean;
  expires_at?: string | Date | null;
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
 *
 * ── Warum diese Funktion existiert (Nachtrag 154) ───────────────────────────
 * Dieselben acht Zeilen standen ZWEIMAL im Baum: in server.ts unter
 * `GET /verify` (der Link aus der Mail) und in routes/auth.ts unter
 * `GET /api/auth/verify`. Beide Kopien enthielten die Hash-Regel, die
 * Ablaufprüfung UND das Abräumen der Token-Felder. Wer die Regel ändert,
 * ändert sie an einer Stelle und übersieht die andere — genau die Bauart von
 * Fehler, gegen die dieses Projekt sonst überall angeht (Logik einmal
 * implementieren, über mehrere Routen anbieten).
 *
 * Geteilt wird nur die LOGIK. Die Antwortform bleibt Sache der Aufrufer: der
 * Browser-Link leitet weiter, die API antwortet mit JSON. Das ist kein
 * Zufall, sondern der Unterschied zwischen einem Klick in einer Mail und
 * einem Aufruf aus einem Programm.
 *
 * ── Warum „abgelaufen" und „unbekannt" NICHT unterschieden werden ───────────
 * Beides ergibt `ungueltig`. Die Abfrage prüft Hash, Ablauf und
 * `email_verified = 0` in EINEM Zug; ein bereits eingelöster Token findet
 * deshalb ebenfalls keine Zeile. Das ist Absicht: Wer von aussen erfährt, ob
 * ein Token existiert und nur abgelaufen ist, kann raten, ob eine Adresse ein
 * Konto hat. Dieselbe Überlegung wie bei der neutralen Antwort in
 * /forgot-password. Wer hier später doch unterscheiden will, handelt sich
 * genau diese Preisgabe ein.
 *
 * @param {string|undefined|null} token Der ROHE Token aus der URL, ungehasht.
 * @returns {Promise<{ok: boolean, grund?: string, userId?: number}>}
 *   `{ok:true, userId}` bei Erfolg, sonst `{ok:false, grund:'fehlt'}` wenn gar
 *   kein Token kam, oder `{ok:false, grund:'ungueltig'}` in allen anderen
 *   Fällen (unbekannt, abgelaufen, bereits eingelöst).
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
async function validateToken(token: string | null | undefined): Promise<TokenBenutzer | null> {
  if (!token) return null;
  const now = Date.now();

  const hit = _tokenCache.get(token);
  if (hit && now - hit.cachedAt < TOKEN_TTL_MS) {
    // Ablauf auch bei Cache-Treffern respektieren
    if (hit.user.expires_at && new Date(hit.user.expires_at).getTime() <= now) {
      _tokenCache.delete(token);
      return null;
    }
    _touchLastUsed(token, hit);
    return hit.user;
  }

  const hashed = hashToken(token);
  const SQL = `
    SELECT t.user_id, t.expires_at, t.last_used, u.username, u.is_admin
    FROM api_tokens t JOIN users u ON u.id = t.user_id
    WHERE t.token = $1 AND (t.expires_at IS NULL OR t.expires_at > NOW())`;
  // Nur noch der Hash-Pfad.
  //
  // VORHER stand hier ein Legacy-Fallback, der bei einem Fehlschlag ein
  // zweites Mal mit dem KLARTEXT-Token suchte und die Zeile dann in-place auf
  // den Hash umschrieb. Gedacht war das als einmalige Migrationshilfe für
  // Alt-Installationen — praktisch hielt es die Klartext-Speicherung dauerhaft
  // gültig: Wer eine Kopie der api_tokens-Tabelle in die Hände bekommt (Backup,
  // Log, versehentlicher Dump), kann jede noch nicht migrierte Zeile direkt als
  // Credential verwenden. Genau das soll das Hashen verhindern.
  //
  // Die Bereinigung übernimmt einmalig initSchema() in db/database.ts:
  // Zeilen, deren Token nicht dem Hash-Format entspricht (64 Hex-Zeichen),
  // werden beim Start gelöscht. Danach existiert der Klartext-Pfad nicht mehr.
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
  db.run('UPDATE api_tokens SET last_used = NOW() WHERE token = $1', [entry.dbKey || hashToken(token)])
    .catch(e => console.warn('[auth] last_used konnte nicht geschrieben werden:', e?.message || e));
}

/**
 * Beim Logout/Token-Löschen aufrufen, damit der Token sofort ungültig wird.
 * @param {string|null|undefined} token
 */
function invalidateToken(token: string | null | undefined): void { if (token) _tokenCache.delete(token); }

// ── Gemeinsame Login-/Konto-Regeln ────────────────────────────────────────────
// Vorher existierten diese Regeln nur im Webapp-Login (routes/auth.ts).
// /api/v1/auth/login hat weder is_active noch email_verified geprüft — ein
// deaktiviertes oder nie bestätigtes Konto konnte sich über die Android-API
// anmelden und bekam dort einen Token OHNE Ablaufdatum. Genau die Sorte
// Divergenz, die api-parity.test.js für Daten schon abfängt; jetzt gibt es
// für die Vorbedingungen eine einzige Quelle.

/**
 * Session-ID erneuern und danach die Anmeldedaten hineinschreiben.
 *
 * Ohne das behält der Browser die Session-ID, die er VOR dem Login hatte
 * (Session Fixation): Wer einem Opfer eine bekannte ID unterschieben kann —
 * über eine XSS-Lücke, ein geteiltes Gerät, einen manipulierten Link auf einer
 * Installation ohne HTTPS — ist nach dessen Anmeldung mit angemeldet.
 * express-session erneuert die ID nicht von selbst.
 *
 * regenerate() legt eine neue, leere Session an; die Felder werden deshalb
 * danach gesetzt.
 *
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
      Object.assign(req.session || (req.session = {} as typeof req.session), data);
      return resolve(undefined);
    }
    req.session.regenerate((err?: any) => {
      if (err) return reject(err);
      Object.assign(req.session, data);
      // Sofort schreiben, damit die neue ID auch dann gültig ist, wenn der
      // Client unmittelbar danach eine zweite Anfrage stellt.
      req.session.save((e2?: any) => (e2 ? reject(e2) : resolve(undefined)));
    });
  });
}

/** Kostenfaktor für bcrypt.hash — überall derselbe (vorher 10 bzw. 12 gemischt). */
const BCRYPT_ROUNDS = 12;

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
 *
 * ── Der gemeldete Fehler ────────────────────────────────────────────────────
 * Über dem Login-Feld steht "Benutzername oder E-Mail", die Abfrage sucht auch
 * in beiden Spalten (`LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1)`)
 * — davor stand aber ein Wächter, der NUR das Benutzernamen-Muster zuliess.
 * Wer seine E-Mail eintippte, bekam "Benutzername darf nur Buchstaben, Zahlen
 * und _.- enthalten" und kam gar nicht bis zur Abfrage. Das @-Zeichen fällt
 * durch das Muster, und ein 3-Zeichen-Minimum passt zu Adressen ohnehin nicht.
 *
 * Der Wächter selbst ist nicht überflüssig: Er hält Unsinn von der Abfrage und
 * vom Brute-Force-Zähler fern, der je Kombination aus IP und Anmeldename
 * zählt. Er muss nur BEIDE Formen kennen.
 *
 * Nicht zu verwechseln mit USERNAME_RE: Wer sich registriert oder sein Profil
 * ändert, bekommt weiterhin nur das Benutzernamen-Muster — sonst könnte jemand
 * die E-Mail-Adresse eines anderen als Benutzernamen eintragen und dessen
 * Anmeldung an sich ziehen.
 */
function isValidLoginIdentifier(value: unknown): boolean {
  const v = String(value || '');
  return USERNAME_RE.test(v) || (v.length <= 254 && EMAIL_RE.test(v));
}

/**
 * Prüft die Konto-Vorbedingungen NACH erfolgreicher Passwortprüfung.
 * @returns {{status:number, error:string, unverified?:boolean}|null} null = Login erlaubt
 */
function assertLoginAllowed(user: KontoZustand): { status: number; error: string; unverified?: boolean } | null {
  if (user.is_active === 0 || user.is_active === false)
    return { status: 403, error: 'Konto deaktiviert. Bitte Administrator kontaktieren.' };
  if ((user.email_verified === 0 || user.email_verified === false) && user.email && !user.is_admin)
    return { status: 403, error: 'E-Mail-Adresse noch nicht bestätigt. Bitte prüfe dein Postfach.', unverified: true };
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
  error: string;
  /** Nur bei unbestätigter E-Mail: Der Client blendet dann das Erneut-senden an. */
  unverified?: boolean;
}

/** Ergebnis von pruefeAnmeldedaten(): entweder die Konto-Zeile oder eine Absage. */
export type AnmeldeErgebnis =
  | { ok: true; user: Record<string, any> }
  | { ok: false; absage: AnmeldeAbsage };

/**
 * Anmeldedaten prüfen — die einzige Stelle im Baum, an der das passiert.
 *
 * ── Warum das hier steht und nicht in den Routen ────────────────────────────
 * Dieselbe Abfolge stand zweimal: einmal im Sitzungs-Login (routes/auth.ts,
 * Webapp) und einmal im Token-Login (routes/api_v1/auth.ts, Android-App). Sie
 * ist SCHON EINMAL auseinandergelaufen — der Kommentar an der v1-Route hält
 * fest, dass dort die Konto-Vorbedingungen komplett fehlten und sich ein
 * deaktiviertes Konto über die App anmelden konnte.
 *
 * Beim Nachmessen war sie ein ZWEITES Mal auseinandergelaufen, diesmal
 * unbemerkt: Der Sitzungs-Login vergleicht auch bei unbekanntem Namen gegen
 * einen Dummy-Hash, der Token-Login sprang bei `!user` sofort heraus. Der
 * Unterschied ist von aussen sauber messbar (eigene Messung, je 5 Versuche mit
 * verschiedenen Namen, damit die Sperre nicht dazwischenfunkt):
 *
 *     /api/v1/auth/login   bekannt 418.5 ms · unbekannt   4.0 ms · Δ  414.6 ms
 *     /api/auth/login      bekannt 419.3 ms · unbekannt 436.8 ms · Δ  -17.5 ms
 *
 * 415 ms Unterschied heisst: Wer eine Namensliste durchprobiert, weiss danach,
 * welche Konten es gibt — ohne ein einziges Passwort zu erraten. Ein Login
 * mehr bedeutet also nicht nur doppelte Arbeit, sondern eine Lücke, die nur an
 * einer der beiden Stellen sichtbar ist.
 *
 * ── Reihenfolge, und warum sie so ist ───────────────────────────────────────
 * 1. Form des Anmeldenamens — hält Unsinn von der Abfrage und vom
 *    Brute-Force-Zähler fern, der je IP und Anmeldename zählt.
 * 2. Sperre abfragen — VOR der teuren Passwortprüfung.
 * 3. Konto suchen und Passwort prüfen, immer mit bcrypt (s. o.).
 * 4. Fehlversuch/Erfolg beim Zähler melden.
 * 5. Konto-Vorbedingungen (assertLoginAllowed) NACH dem Passwort — sonst
 *    verrät die Antwort „Konto deaktiviert" die Existenz des Kontos an jeden,
 *    der nur den Namen kennt.
 *
 * Was NICHT hierher gehört: Sitzung anlegen bzw. Token ausstellen. Genau das
 * unterscheidet die beiden Aufrufer, und es ist der einzige Unterschied.
 *
 * @param req      Für den Brute-Force-Zähler (IP) gebraucht.
 * @param username Benutzername ODER E-Mail-Adresse.
 * @param password Klartext-Passwort aus dem Request.
 */
async function pruefeAnmeldedaten(req: Request, username: unknown, password: unknown): Promise<AnmeldeErgebnis> {
  const absage = (status: number, error: string, unverified?: boolean): AnmeldeErgebnis =>
    ({ ok: false, absage: unverified ? { status, error, unverified } : { status, error } });

  if (!username || !password)
    return absage(400, 'Benutzername und Passwort erforderlich');
  if (!isValidLoginIdentifier(username))
    return absage(400, 'Bitte Benutzername oder E-Mail-Adresse eingeben.');

  const name = String(username);
  const gesperrt = await checkLoginAllowed(req, name);
  if (gesperrt) return absage(429, gesperrt);

  // Anmeldung per E-Mail ist erlaubt — so steht es über dem Feld.
  const user = await db.get(
    'SELECT * FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1)', [name]);
  // bcrypt.compare (async) statt compareSync — blockiert den Event-Loop nicht.
  // Der Vergleich läuft auch ohne Treffer, gegen DUMMY_HASH (s. o.).
  const passtDasPasswort = await bcrypt.compare(String(password), user?.password_hash || DUMMY_HASH);
  if (!user || !passtDasPasswort) {
    await recordLoginFailure(req, name);
    return absage(401, 'Ungültige Anmeldedaten');
  }
  await recordLoginSuccess(req, name);

  const blockiert = assertLoginAllowed(user);
  if (blockiert) return absage(blockiert.status, blockiert.error, blockiert.unverified);
  return { ok: true, user };
}

/**
 * Escaped LIKE-Sonderzeichen. Ohne das löscht ein "%" als tokenId in
 * DELETE /api/settings/tokens/:tokenId alle Tokens des Nutzers auf einmal.
 * @param {string} s
 */
function escapeLike(s: unknown): string { return String(s ?? '').replace(/([%_\\])/g, '\\$1'); }

/**
 * Pfade, auf denen ?token=… als Authentifizierung zulässig bleibt.
 *
 * Ein Token in der Query-Zeichenkette landet im Referer fremder Seiten, in der
 * Browser-History, in Reverse-Proxy-Logs und in jedem Fehlerbericht, der die
 * URL mitschickt. Als allgemeiner Auth-Weg ist das deshalb keine Option.
 *
 * Es gibt aber Fälle, in denen kein Header gesetzt werden kann: <img src>,
 * <iframe src>, window.open() und EventSource erlauben keine eigenen
 * Kopfzeilen. Genau diese bleiben offen; alles andere verlangt einen
 * Authorization-Header.
 *
 * ── Warum der CSV-Import hier steht ─────────────────────────────────────────
 * routes/sets.ts hatte eine ZWEITE, eigene Fassung von requireLoginOrToken,
 * die ?token= bedingungslos akzeptierte — für den SSE-Fortschritt des
 * CSV-Imports, weil EventSource keine Header setzen kann. Der Bedarf ist echt,
 * die zweite Fassung war es nicht: Sie machte den Absatz oben unwahr („alles
 * andere verlangt einen Header"), ohne dass man es dieser Datei ansieht. Wer
 * hier nachliest, wo ein Token in der URL reiten darf, soll die vollständige
 * Antwort bekommen.
 *
 * /status steht mit in der Liste, weil der Polling-Rückfall greift, sobald
 * EventSource fehlt oder abbricht — derselbe Client, dieselbe Einschränkung.
 */
const TOKEN_QUERY_ALLOWED = [
  /^\/api\/img-proxy\b/,
  /^\/data\//,
  /^\/api\/sets\/import\/csv\/(stream|status)\b/,
];

/**
 * Ermittelt die userId aus Session oder Bearer-Token.
 *
 * ?token= wird nur auf den Pfaden aus TOKEN_QUERY_ALLOWED akzeptiert (siehe
 * dort). Auf allen anderen Routen zählt ausschliesslich der
 * Authorization-Header.
 *
 * @param req Express-Request
 * @returns {Promise<number|null>} null wenn nicht authentifiziert
 */
async function resolveUserId(req: Request): Promise<number | null> {
  if (req.session?.userId) return req.session.userId;
  const auth = req.headers.authorization || '';
  let token: string | null = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token && req.query?.token) {
    // req.path ist bei Sub-Routern relativ — für die Prüfung zählt der volle
    // Pfad, deshalb originalUrl ohne Query-Teil.
    const fullPath = vorDem(String(req.originalUrl || req.url || ''), '?');
    if (TOKEN_QUERY_ALLOWED.some(re => re.test(fullPath))) token = String(req.query.token);
  }
  if (!token) return null;
  const user = await validateToken(token).catch(() => null);
  // Vorher stand hier parseInt(user.user_id). Das war schon immer wirkungslos:
  // Die Spalte ist INTEGER, der Treiber liefert eine Zahl, und parseInt haette
  // sie erst in einen String verwandelt. Aufgefallen ist es erst, als der Typ
  // dastand.
  return user ? user.user_id : null;
}

/**
 * Express-Middleware: Session ODER Bearer-Token, setzt req.tokenUserId.
 *
 * @param opts.timeoutMs Antwortet nach dieser Zeit mit 503, statt zu warten.
 *        Für den Fortschrittskanal des CSV-Imports gedacht: Während eines
 *        Imports kann die Datenbank ausgelastet sein, und ein Client, der eine
 *        klare Absage bekommt, versucht es gleich wieder — besser als eine
 *        Verbindung, die minutenlang offen hängt. Ohne Angabe wird gewartet
 *        (unverändertes Verhalten aller übrigen Routen).
 */
function loginOrTokenGuard(opts: { timeoutMs?: number } = {}) {
  return async function requireLoginOrToken(req: Request, res: Response, next: NextFunction) {
    if (req.session?.userId) return next();
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          if (!res.headersSent) res.status(503).json({ success: false, error: 'Server ausgelastet' });
        }, opts.timeoutMs)
      : null;
    let uid: number | null = null;
    try { uid = await resolveUserId(req); } catch (_) { uid = null; }
    if (timer) clearTimeout(timer);
    if (res.headersSent) return;               // Zeitlimit war schneller
    if (uid) { req.tokenUserId = uid; return next(); }
    return res.status(401).json({ success: false, error: 'Nicht angemeldet' });
  };
}

const requireLoginOrToken = loginOrTokenGuard();

/**
 * Einen Bearer-Token ausstellen.
 *
 * ── Warum das hier steht ────────────────────────────────────────────────────
 * Dasselbe INSERT stand dreimal, mit drei verschiedenen Laengen und zwei
 * verschiedenen Laufzeiten: im Token-Login (32 Byte, ohne Ablauf), im
 * Sitzungs-Login (24 Byte, sieben Tage) und in /qr-login (32 Byte, ohne
 * Ablauf). Die Laenge war schlicht Zufall; die Laufzeit ist es NICHT — und
 * genau deshalb ist sie jetzt ein benannter Parameter statt einer Eigenheit
 * der Kopie, in der man gerade liest.
 *
 * ── Warum Browser und App verschiedene Laufzeiten bekommen ──────────────────
 * Der Token des Browsers liegt im sessionStorage und ist damit per XSS
 * auslesbar; er existiert nur, damit EventSource sich ausweisen kann (dort
 * lassen sich keine Kopfzeilen setzen). Sieben Tage sind dafür reichlich.
 * Der Token der App ist dagegen der einzige Ausweis des Geräts — wer die App
 * öffnet, soll nicht jedes Mal sein Passwort eintippen. Er bekommt kein
 * Ablaufdatum und verfällt stattdessen nach TOKEN_IDLE_DAYS ohne Nutzung
 * (siehe purgeExpiredTokens).
 *
 * Die Datenbank speichert nur den SHA-256-Hash; der Aufrufer bekommt den
 * Klartext.
 *
 * @param dauerhaft true = kein Ablaufdatum (App, QR-Anmeldung).
 */
async function createToken(userId: number, label = 'Android App', dauerhaft = false): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  await db.run(
    dauerhaft
      ? 'INSERT INTO api_tokens (token, user_id, label, expires_at) VALUES ($1,$2,$3,NULL) ON CONFLICT DO NOTHING'
      : "INSERT INTO api_tokens (token, user_id, label, expires_at) VALUES ($1,$2,$3, NOW() + INTERVAL '7 days') ON CONFLICT DO NOTHING",
    [hashToken(token), userId, label]
  );
  return token;
}

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
 *
 * Wird beim Passwortwechsel und beim Reset aufgerufen: Wer sein Passwort
 * ändert, tut das im Zweifel genau deshalb, weil ein Zugang kompromittiert
 * ist. Ein Bearer-Token mit sieben Tagen Restlaufzeit, das die Änderung
 * überlebt, macht den Wechsel wirkungslos.
 *
 * Der In-Memory-Cache lässt sich nicht gezielt nach user_id leeren (er ist
 * nach Token-Klartext indiziert), deshalb wird er ganz verworfen — er baut
 * sich innerhalb weniger Requests wieder auf.
 *
 * @param {number} userId
 * @returns {Promise<void>}
 */
/**
 * Alle offenen BROWSER-SITZUNGEN eines Kontos beenden.
 *
 * ── Woher das kommt ─────────────────────────────────────────────────────────
 * Der Admin-Reset suchte die Sitzungen in einer Tabelle namens `session` und
 * sprang über den Schritt, wenn es sie nicht gibt. Sie gibt es nie: Der
 * Session-Store läuft auf `user_sessions` (server.ts, tableName). Der
 * to_regclass-Test lieferte also immer NULL, das DELETE lief nie — ein
 * Administrator konnte das Passwort eines übernommenen Kontos zurücksetzen,
 * und die offene Sitzung des Angreifers lief weiter. Nachgestellt mit echtem
 * Store: 1 Zeile in user_sessions, to_regclass('public.session') = NULL.
 *
 * Der Reset-per-E-Mail-Pfad traf die richtige Tabelle, nutzte aber einen
 * anderen Ausdruck für dieselbe Frage. Beides steht jetzt hier, an einer
 * Stelle — wie revokeAllTokens für die Bearer-Tokens.
 *
 * `sess::jsonb->>'userId'` statt `(sess -> 'userId')::text`: Beide treffen
 * eine Zahl, aber ->> liefert den blanken Wert, während ::text bei einem
 * STRING die Anführungszeichen mitbringt ('"42"' statt '42') und dann nicht
 * mehr passt. Der Store speichert derzeit eine Zahl; der robustere Ausdruck
 * kostet nichts.
 */
async function revokeAllSessions(userId: number): Promise<void> {
  await db.run("DELETE FROM user_sessions WHERE sess::jsonb->>'userId' = $1", [String(userId)]);
}

async function revokeAllTokens(userId: number): Promise<void> {
  // Ohne .catch(() => {}): Das Verwerfen aller Tokens ist ein Sicherheitsschritt
  // (Passwortwechsel, Zurücksetzen). Scheitert es still, meldet der Aufrufer
  // Erfolg, während die alten Tokens weitergelten — und der geleerte Cache
  // lässt sie beim nächsten Request sogar frisch aus der DB nachladen.
  await db.run('DELETE FROM api_tokens WHERE user_id = $1', [userId]);
  _tokenCache.clear();
}

/**
 * Tage ohne Nutzung, nach denen ein Token OHNE Ablaufdatum verfällt.
 * 0 schaltet die Regel ab (dann gilt wieder: unbegrenzt).
 *
 * ── Warum es diese Regel gibt ───────────────────────────────────────────────
 * Die Tokens der Android-App und des QR-Logins werden bewusst ohne
 * Ablaufdatum angelegt: Wer die App öffnet, soll nicht ständig sein Passwort
 * eintippen müssen. Der Preis war, dass ein Token auf einem verlorenen oder
 * verkauften Telefon unbegrenzt weitergilt — und es gibt keinen Weg, ihn
 * loszuwerden, ausser das Passwort zu ändern (was seit Nachtrag 3 alle Tokens
 * verwirft).
 *
 * „Ungenutzt" ist dabei das richtige Mass, nicht „alt": Ein Telefon, das
 * täglich synchronisiert, wird nie ausgesperrt, egal wie lange es das Konto
 * schon hat. Ausgesperrt wird nur, was ohnehin niemand mehr benutzt — und dort
 * ist eine erneute Anmeldung zumutbar.
 *
 * last_used wird bei jeder Anfrage gepflegt (gedrosselt auf alle fünf Minuten,
 * siehe _touchLastUsed), taugt also genau dafür.
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
 *
 * Ohne das wächst api_tokens monoton: Jeder Login legt eine webapp-session-Zeile
 * mit sieben Tagen Laufzeit an, und niemand hat sie je entfernt — auch nicht
 * nach Ablauf, weil validateToken() abgelaufene Zeilen nur ignoriert.
 * Wird beim Start und danach stündlich vom Primary-Worker aufgerufen.
 *
 * Ein gelöschter Token wirkt spätestens nach TOKEN_TTL_MS (eine Minute), so
 * lange kann ihn ein Worker noch aus seinem Cache bedienen. Für eine
 * Aufräumregel nach Monaten ist das ohne Belang.
 *
 * COALESCE(last_used, created_at): Zeilen aus der Zeit vor der last_used-Spalte
 * hätten dort NULL, und NULL < NOW() ist unbekannt — sie wären damit für immer
 * ausgenommen, also ausgerechnet die ältesten.
 *
 * ── Zur Rückgabe ────────────────────────────────────────────────────────────
 * Hier stand `r?.rowCount`. db.run() liefert aber `{ changes, lastID }` (siehe
 * db/database.ts) — die Zahl war deshalb IMMER 0, und die Meldung
 * „n abgelaufene Token entfernt" im Aufräumjob ist nie erschienen. Aufgeräumt
 * wurde trotzdem; man sah es nur nicht.
 *
 * @returns {Promise<number>} Anzahl gelöschter Zeilen
 */
async function purgeExpiredTokens() {
  let entfernt = 0;
  const abgelaufen = await db.run(
    'DELETE FROM api_tokens WHERE expires_at IS NOT NULL AND expires_at < NOW()'
  ).catch(e => { console.warn('[tokens] Aufräumen abgelaufener Tokens:', e?.message || e); return null; });
  entfernt += abgelaufen?.changes || 0;

  if (TOKEN_IDLE_DAYS > 0) {
    const ungenutzt = await db.run(
      `DELETE FROM api_tokens
        WHERE expires_at IS NULL
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
  validateToken, invalidateToken, resolveUserId, requireLoginOrToken, hashToken, deleteToken,
  verifiziereEmailToken,
  revokeAllTokens, revokeAllSessions, purgeExpiredTokens, loginOrTokenGuard, TOKEN_IDLE_DAYS,
  assertLoginAllowed, pruefeAnmeldedaten, createToken, escapeLike, establishSession, BCRYPT_ROUNDS, USERNAME_RE,
  EMAIL_RE, isValidLoginIdentifier,
};
