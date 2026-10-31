/**
 * Zentrale Auth-Helfer: Session ODER Bearer-Token (Android-App).
 * Ausführlich: docs/begruendungen/src/konto/auth.ts.md#abschnitt
 */

import { konfig } from '../infra/konfig';
import * as db from '../../db/database';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import type { Request, Response, NextFunction } from 'express';
import { checkLoginAllowed, gibAnmeldeplatzFrei, recordLoginFailure, recordLoginSuccess } from './loginLimiter';
import { sendeFehler } from '../infra/fehlerTexte';
import { meldeUndLiefere } from '../infra/httpError';
import * as zf from './zweiterFaktor';
import * as passkeys from './passkeys';
import { ausTabelle } from '../infra/validate';
import type { FehlerCode } from '../infra/fehlerTexte';

/**
 * Warum diese Typen hier stehen
 * Diese Datei hatte 20 implizite `any` — mehr als jede andere sicherheitsnahe
 * Stelle im Baum. Das ist die schlechteste Stelle dafuer: Wer hier einen
 * Feldnamen vertippt (`user.is_activ`), bekommt `undefined`, und `undefined` …
 * Ausführlich: docs/begruendungen/src/konto/auth.ts.md#tokenbenutzer
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
  sliding?: boolean;
  never_expires?: boolean;
  scope?: TokenScope;
  rotiert_am?: string | Date | null;
  vorgaenger?: string | null;
  [k: string]: unknown;
}

/** Was der In-Memory-Cache je Token haelt. */
interface CacheEintrag {
  user: TokenBenutzer;
  cachedAt: number;
  dbKey: string;
  /** Ein Schreibvorgang läuft schon; ein zweiter wäre derselbe. */
  schreibt?: boolean;
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
 * Ausführlich: docs/begruendungen/src/konto/auth.ts.md#verifiziereemailtoken
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

const TOKEN_TTL_MS = 60 * 1000;       // Cache-Gültigkeit
const TAG_MS = 86_400_000;

/** Geltungsbereich eines Tokens: `app` nie mit Verwalterrechten, `voll` wie das Konto. */
export type TokenScope = 'app' | 'voll';

/**
 * Rotation: Ab 30 Tagen seit dem letzten Tausch sagt jede Antwort
 * `X-Token-Rotation: faellig`. Ein unbegrenzter Token gilt nach 60 Tagen ohne
 * Tausch nur noch für den Tausch selbst — so stirbt eine gestohlene Kopie,
 * sobald das echte Gerät tauscht, und ein Gerät, das nie tauscht, fällt auf.
 */
export const ROTATION_FAELLIG_TAGE = 30;
export const ROTATION_PFLICHT_TAGE = 60;
/** So lange gilt der alte Token nach dem Tausch noch, falls die Antwort verloren geht. */
export const UEBERLAPPUNG_MS = 5 * 60 * 1000;

// token → { user, cachedAt }
const _tokenCache = new Map<string, CacheEintrag>();

// Cache klein halten — bei einer Handvoll Nutzern reichen 200 Einträge locker.
function _pruneCache() {
  if (_tokenCache.size <= 200) return;
  const cutoff = Date.now() - TOKEN_TTL_MS;
  for (const [k, v] of _tokenCache) {
    if (v.cachedAt < cutoff) _tokenCache.delete(k);
  }
}

/**
 * Ist dieser Zeitpunkt erreicht? `null`/leer heisst „keine Frist", also nein.
 * `null` bedeutet hier „unbegrenzt" und nicht „sofort abgelaufen".
 */
function fristErreicht(zeitpunkt: string | Date | null | undefined, jetzt: number): boolean {
  return !!zeitpunkt && new Date(zeitpunkt).getTime() <= jetzt;
}

const tageSeit = (zeitpunkt: string | Date | null | undefined, jetzt: number): number =>
  zeitpunkt ? (jetzt - new Date(zeitpunkt).getTime()) / TAG_MS : 0;

/** Sollte dieser Token getauscht werden? (Nur Hinweis, keine Sperre.) */
function rotationFaellig(u: TokenBenutzer, jetzt = Date.now()): boolean {
  return tageSeit(u.rotiert_am, jetzt) >= ROTATION_FAELLIG_TAGE;
}

/** Gilt dieser Token nur noch für den Tausch? Betrifft allein „unbegrenzt". */
function rotationPflicht(u: TokenBenutzer, jetzt = Date.now()): boolean {
  return flaggeGesetzt(u.never_expires) && tageSeit(u.rotiert_am, jetzt) >= ROTATION_PFLICHT_TAGE;
}

/**
 * Der grobe Adressbereich für die Geräteliste: IPv4 als /24, IPv6 als /48.
 * Genug, um ein fremdes Netz zu erkennen; die genaue Adresse wird nicht gespeichert.
 */
function ipBereich(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/i.exec(ip);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  if (!ip.includes(':')) return null;
  const [kopf = '', rest] = ip.split('::');
  const teile = kopf ? kopf.split(':') : [];
  // „a::b“ hat links weniger als drei Gruppen: die fehlenden sind Nullen.
  while (teile.length < 3 && rest !== undefined) teile.push('0');
  if (teile.length < 3 || teile.slice(0, 3).some(g => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return `${teile.slice(0, 3).map(g => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':')}::/48`;
}

/** Was eine Prüfung ergibt: der Nutzer, oder warum nicht. */
export interface TokenPruefung { nutzer: TokenBenutzer | null; grund?: 'token_rotation_noetig' }

/**
 * Validiert einen Bearer-Token. Nutzt den In-Memory-Cache; DB nur bei Miss.
 * `zweck: 'rotation'` lässt einen unbegrenzten Token auch nach der Pflichtfrist
 * durch — nur der Tausch selbst darf ihn dann noch benutzen.
 */
async function pruefeToken(token: string | null | undefined,
                           o: { ip?: string | null | undefined; zweck?: 'nutzung' | 'rotation' } = {}): Promise<TokenPruefung> {
  if (!token) return { nutzer: null };
  const now = Date.now();
  const ergebnis = (u: TokenBenutzer): TokenPruefung =>
    o.zweck !== 'rotation' && rotationPflicht(u, now)
      ? { nutzer: null, grund: 'token_rotation_noetig' } : { nutzer: u };

  const hit = _tokenCache.get(token);
  if (hit && now - hit.cachedAt < TOKEN_TTL_MS) {
    // Beide Fristen auch hier: Dieser Zweig fragt die Datenbank nicht.
    if (fristErreicht(hit.user.expires_at, now) || fristErreicht(hit.user.hard_expires_at, now)) {
      _tokenCache.delete(token);
      return { nutzer: null };
    }
    _touchLastUsed(hit, o.ip);
    return ergebnis(hit.user);
  }

  const hashed = hashToken(token);
  const row = await db.get<TokenBenutzer>(`
    SELECT t.user_id, t.expires_at, t.hard_expires_at, t.last_used, t.sliding, t.never_expires,
           t.scope, t.rotiert_am, t.vorgaenger, t.label, t.ip_bereich,
           u.username, u.is_admin AS konto_is_admin
    FROM api_tokens t JOIN users u ON u.id = t.user_id
    WHERE t.token = $1
      AND (t.expires_at      IS NULL OR t.expires_at      > NOW())
      AND (t.hard_expires_at IS NULL OR t.hard_expires_at > NOW())`, [hashed]);
  if (!row) { _tokenCache.delete(token); return { nutzer: null }; }
  // Verwalterrecht nur mit Scope `voll`: An dieser einen Stelle entschieden,
  // sehen es alle Wächter (requireApiAdmin, istVerwalter, Kontingent) gleich.
  row.is_admin = flaggeGesetzt(row.konto_is_admin) && row.scope === 'voll' ? 1 : 0;
  // Die erste Nutzung des Nachfolgers beendet die Überlappung sofort.
  if (row.vorgaenger) {
    await db.run('DELETE FROM api_tokens WHERE token = $1 AND ersetzt_durch = $2', [row.vorgaenger, hashed]);
    await db.run('UPDATE api_tokens SET vorgaenger = NULL WHERE token = $1', [hashed]);
    row.vorgaenger = null;
    leereTokenCache();
  }

  const entry: CacheEintrag = { user: row, cachedAt: now, dbKey: hashed };
  _tokenCache.set(token, entry);
  _pruneCache();
  _touchLastUsed(entry, o.ip);
  return ergebnis(row);
}

async function validateToken(token: string | null | undefined,
                             o: { ip?: string | null | undefined; zweck?: 'nutzung' | 'rotation' } = {}): Promise<TokenBenutzer | null> {
  return (await pruefeToken(token, o)).nutzer;
}

/**
 * Letzte Nutzung, Adressbereich und Gleitfrist schreiben — höchstens einmal je
 * Tag und Token, und ohne den Anfrageweg aufzuhalten. Die Entscheidung fällt
 * am gelesenen Datensatz, nicht an einem Zähler je Prozess: so gilt der Tag
 * auch über mehrere Worker, und die WHERE-Klausel fängt den Wettlauf.
 */
function _touchLastUsed(entry: CacheEintrag, ip?: string | null): void {
  const jetzt = Date.now();
  const u = entry.user;
  const zuletzt = u.last_used ? new Date(u.last_used).getTime() : 0;
  const ziel = jetzt + TOKEN_IDLE_DAYS * TAG_MS;
  const fristHinkt = flaggeGesetzt(u.sliding) && !!u.expires_at
    && new Date(u.expires_at).getTime() < ziel - TAG_MS;
  if ((jetzt - zuletzt < TAG_MS && !fristHinkt) || entry.schreibt) return;
  entry.schreibt = true;
  db.run(
    `UPDATE api_tokens
        SET last_used = NOW(),
            ip_bereich = COALESCE($3, ip_bereich),
            expires_at = CASE WHEN sliding AND expires_at IS NOT NULL
                              THEN NOW() + make_interval(days => $2) ELSE expires_at END
      WHERE token = $1
        AND (last_used IS NULL OR last_used < NOW() - INTERVAL '1 day'
             OR (sliding AND expires_at < NOW() + make_interval(days => $2) - INTERVAL '1 day'))`,
    [entry.dbKey, TOKEN_IDLE_DAYS, ipBereich(ip)])
    .then(() => {
      // Den Cache mitziehen, sonst wiese der Treffer-Zweig einen gerade
      // erneuerten Token am alten Fristende einmal ab.
      u.last_used = new Date(jetzt);
      if (fristHinkt || (flaggeGesetzt(u.sliding) && u.expires_at)) u.expires_at = new Date(ziel);
    })
    .catch(e => console.warn('[auth] last_used konnte nicht geschrieben werden:', e?.message || e))
    .finally(() => { entry.schreibt = false; });
}

/** Beim Logout/Token-Löschen aufrufen, damit der Token sofort ungültig wird. */
function invalidateToken(token: string | null | undefined): void {
  if (!token) return;
  _tokenCache.delete(token);
}

/**
 * Den ganzen Token-Cache verwerfen — für Löschungen ohne Klartext (die
 * Token-Verwaltung kennt nur den Hash-Anfang). Den Cache hält nur der
 * Web-Prozess, und widerrufen wird nur dort; ein Signal an andere Prozesse
 * braucht es nicht (der Job-Prozess löscht nur abgelaufene Tokens).
 */
function leereTokenCache(): void {
  _tokenCache.clear();
}

/**
 * Ist diese Datenbank-Flagge gesetzt?
 * Ausführlich: docs/begruendungen/src/konto/auth.ts.md#flaggegesetzt
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
 * Ausführlich: docs/begruendungen/src/konto/auth.ts.md#establishsession
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
 * Ausführlich: docs/begruendungen/src/konto/auth.ts.md#passwort-min-zeichen
 */
const PASSWORT_MIN_ZEICHEN = 8;

/**
 * Ist dieses Passwort zu kurz?
 * Ausführlich: docs/begruendungen/src/konto/auth.ts.md#passwortzukurz
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
 * Ausführlich: docs/begruendungen/src/konto/auth.ts.md#isvalidloginidentifier
 */
function isValidLoginIdentifier(value: unknown): boolean {
  const v = String(value || '');
  return USERNAME_RE.test(v) || (v.length <= 254 && EMAIL_RE.test(v));
}

/**
 * Prüft die Konto-Vorbedingungen NACH erfolgreicher Passwortprüfung.
 * Die Absage kommt als CODE zurueck, nicht als Satz: Dieser
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
   * Der Grund als SCHLUESSEL, nicht als Satz.
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
  /** Das Konto hat Passkeys: Statt des Codes geht auch eine Passkey-Antwort. */
  passkey?: boolean;
}

/** Ergebnis von pruefeAnmeldedaten(): entweder die Konto-Zeile oder eine Absage. */
export type AnmeldeErgebnis =
  | { ok: true; user: Record<string, any> }
  | { ok: false; absage: AnmeldeAbsage };

/**
 * Anmeldedaten prüfen — die einzige Stelle im Baum, an der das passiert.
 * Ausführlich: docs/begruendungen/src/konto/auth.ts.md#pruefeanmeldedaten
 * @param req      Für den Brute-Force-Zähler (IP) gebraucht.
 * @param username Benutzername ODER E-Mail-Adresse.
 * @param password Klartext-Passwort aus dem Request.
 * @param code     Einmal- oder Wiederherstellungscode (src/konto/zweiterFaktor.ts).
 */
async function pruefeAnmeldedaten(req: Request, username: unknown, password: unknown, code?: unknown,
                                  passkeyAntwort?: unknown): Promise<AnmeldeErgebnis> {
  // Die Absage traegt einen CODE und keinen Satz: Welche
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
    // Ein Passkey ersetzt den Code — gebunden an DIESES Konto, dessen Passwort stimmte.
    const mitPasskey = passkeyAntwort !== undefined && passkeyAntwort !== null;
    const hatPasskey = await passkeys.hatPasskeys(user.id);
    const ergaenzt = (e: AnmeldeErgebnis) => { if (!e.ok && hatPasskey) e.absage.passkey = true; return e; };
    if (!mitPasskey && !String(code ?? '').trim()) {
      // Das Passwort stimmte; nur der Code fehlt noch — kein Fehlversuch.
      await gibAnmeldeplatzFrei(req, name);
      return ergaenzt(absage(401, 'zweiter_faktor_noetig', undefined, false, true));
    }
    const gilt = mitPasskey
      ? await passkeys.anmeldungPruefen(passkeyAntwort, 'zweiter_faktor', user.id) === user.id
      : await zf.pruefeCode(user.id, code);
    if (!gilt) {
      await recordLoginFailure(req, name);
      return ergaenzt(absage(401, 'zweiter_faktor_falsch', undefined, false, true));
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
 * Ausführlich: docs/begruendungen/src/konto/auth.ts.md#abschnitt-2
 */

/**
 * Ermittelt die userId aus Session oder Bearer-Token.
 * Ausführlich: docs/begruendungen/src/konto/auth.ts.md#resolveuserid
 * @param req Express-Request
 * @returns {Promise<number|null>} null wenn nicht authentifiziert
 */
async function resolveUserId(req: Request): Promise<number | null> {
  if (req.session?.userId) return req.session.userId;
  const auth = req.headers.authorization || '';
  const token: string | null = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const pruefung = await pruefeToken(token, { ip: req.ip })
    .catch(meldeUndLiefere<TokenPruefung>('auth:validateToken', { nutzer: null }));
  const user = pruefung.nutzer;
  if (pruefung.grund) req.tokenAbsage = pruefung.grund;
  // Der Hinweis reist mit jeder Antwort; die App tauscht dann von selbst.
  if (user && rotationFaellig(user)) req.res?.setHeader('X-Token-Rotation', 'faellig');
  // Der ganze Nutzer wird abgelegt, nicht nur seine Kennung: Sonst wuesste ein
  // Handler hinter requireLoginOrToken zwar WER fragt, aber nicht, ob es ein
  // Verwalter ist — `req.session.isAdmin` ist bei einer Token-Anfrage immer
  // undefined. Das faellt nicht als Fehler auf, sondern liefert stillschweigend …
  // Ausführlich: docs/begruendungen/src/konto/auth.ts.md#resolveuserid-2
  if (user) req.apiUser = { ...user, is_admin: user.is_admin ? 1 : 0 };
  return user ? user.user_id : null;
}

/**
 * Express-Middleware: Session ODER Bearer-Token, setzt req.tokenUserId.
 * Ausführlich: docs/begruendungen/src/konto/auth.ts.md#loginortokenguard
 * @param opts.timeoutMs Antwortet nach dieser Zeit mit 503, statt zu warten.
 */
function loginOrTokenGuard(opts: { timeoutMs?: number } = {}) {
  return async function requireLoginOrToken(req: Request, res: Response, next: NextFunction) {
    if (req.session?.userId || req.tokenUserId) return next();
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
    return sendeFehler(req, res, 401, req.tokenAbsage ?? 'nicht_angemeldet');
  };
}

const requireLoginOrToken = loginOrTokenGuard();

/**
 * Wer fragt hier? — Sitzung ODER Bearer-Token, EINE Antwort.
 * Ausführlich: docs/begruendungen/src/konto/auth.ts.md#nutzerid
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
 * Ausführlich: docs/begruendungen/src/konto/auth.ts.md#abschnitt-3
 */
/**
 * Wie [nutzerId], aber fuer Handler, die HINTER einem Waechter stehen.
 * Ausführlich: docs/begruendungen/src/konto/auth.ts.md#angemeldetenutzerid
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
 * Ausführlich: docs/begruendungen/src/konto/auth.ts.md#nutzername
 */
function nutzerName(req: Request): string | null {
  return req.session?.username ?? (req as any).apiUser?.username ?? null;
}

/** Kam die Anfrage mit einer Browser-Sitzung (nicht mit einem Token)? Für Schritte, die nur dort gehen. */
function perSitzung(req: Request): boolean {
  return !!req.session?.userId;
}

function istVerwalter(req: Request): boolean {
  if (req.session?.isAdmin) return true;
  return !!(req as any).apiUser?.is_admin;
}

/**
 * Der Wert, mit dem „unbegrenzt" in der Tageszahl steht.
 * Ausführlich: docs/begruendungen/src/konto/auth.ts.md#unbegrenzt
 */
const UNBEGRENZT = 0;

/**
 * Die WAEHLBAREN festen Laufzeiten eines QR-Zugangs, in Tagen.
 * Ausführlich: docs/begruendungen/src/konto/auth.ts.md#token-laufzeiten
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
 * Ausführlich: docs/begruendungen/src/konto/auth.ts.md#laufzeittage
 * @returns Tage, oder null fuer „keine feste Frist" (nichts gewaehlt, oder
 */
function laufzeitTage(wahl: unknown): number | null {
  if (wahl === undefined || wahl === null || wahl === '') return null;
  return ausTabelle(TOKEN_LAUFZEITEN, String(wahl)) ?? null;
}

/** Zusätzliche Angaben zu einem neuen Token. */
export interface TokenOptionen {
  /** Vorgabe `app`: Verwalterrechte gibt es nur auf ausdrücklichen Wunsch. */
  scope?: TokenScope;
  /** Adresse der ausstellenden Anfrage, für die Geräteliste. */
  ip?: string | null | undefined;
}

/**
 * Einen Bearer-Token ausstellen.
 * @param dauerhaft  true = Gerätezugang mit Gleitfrist (App, QR); false = sieben feste Tage.
 * @param festeTage  feste Höchstdauer; `UNBEGRENZT` (0) = ohne Ablauf, nur über HTTPS erlaubt
 *                   (prüft die Route) und dann mit Rotationspflicht.
 */
async function createToken(userId: number, label = 'Android App', dauerhaft = false,
                           festeTage: number | null = null, o: TokenOptionen = {}): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  const scope: TokenScope = o.scope === 'voll' ? 'voll' : 'app';
  const ip = ipBereich(o.ip);
  if (dauerhaft && festeTage === UNBEGRENZT) {
    await db.run(
      `INSERT INTO api_tokens (token, user_id, label, expires_at, sliding, hard_expires_at, never_expires, scope, ip_bereich)
       VALUES ($1,$2,$3,NULL,FALSE,NULL,TRUE,$4,$5) ON CONFLICT DO NOTHING`,
      [hashToken(token), userId, label, scope, ip]);
  } else if (dauerhaft) {
    const fest = festeTage && festeTage > 0 ? festeTage : null;
    await db.run(
      `INSERT INTO api_tokens (token, user_id, label, expires_at, sliding, hard_expires_at, scope, ip_bereich)
       VALUES ($1,$2,$3, NOW() + make_interval(days => $4), TRUE,
               CASE WHEN $5::int IS NULL THEN NULL ELSE NOW() + make_interval(days => $5::int) END, $6, $7)
       ON CONFLICT DO NOTHING`,
      [hashToken(token), userId, label, TOKEN_IDLE_DAYS, fest, scope, ip]);
  } else {
    // Ein kurzlebiger Token gleitet nicht: Benutzung durch einen Angreifer
    // soll ihn nicht verlängern.
    await db.run(
      `INSERT INTO api_tokens (token, user_id, label, expires_at, sliding, scope, ip_bereich)
       VALUES ($1,$2,$3, NOW() + INTERVAL '7 days', FALSE, $4, $5) ON CONFLICT DO NOTHING`,
      [hashToken(token), userId, label, scope, ip]);
  }
  return token;
}

/** Ergebnis eines Tauschs. */
export interface Tausch {
  token: string;
  scope: TokenScope;
  expires_at: Date | null;
  hard_expires_at: Date | null;
  never_expires: boolean;
  rotiert_am: Date;
  alt_gueltig_bis: Date;
}

/**
 * Einen Token gegen einen neuen tauschen. Der alte gilt danach höchstens noch
 * UEBERLAPPUNG_MS — bis zur ersten Nutzung des neuen. Ein zweiter Tausch mit
 * dem alten (Antwort verloren) ersetzt den unbenutzten Nachfolger.
 * @returns null, wenn der alte Token nicht (mehr) gilt.
 */
async function rotiereToken(alt: string, ip?: string | null): Promise<Tausch | null> {
  const altHash = hashToken(alt);
  const neu = crypto.randomBytes(32).toString('hex');
  const neuHash = hashToken(neu);
  const ergebnis = await db.transaction(async (tx) => {
    const z = await tx.get<{ user_id: number; label: string | null; scope: TokenScope; sliding: boolean;
                             never_expires: boolean; expires_at: Date | null; hard_expires_at: Date | null;
                             created_at: Date; ersetzt_durch: string | null }>(
      `SELECT user_id, label, scope, sliding, never_expires, expires_at, hard_expires_at, created_at, ersetzt_durch
         FROM api_tokens
        WHERE token = $1
          AND (expires_at      IS NULL OR expires_at      > NOW())
          AND (hard_expires_at IS NULL OR hard_expires_at > NOW())
        FOR UPDATE`, [altHash]);
    if (!z) return null;
    if (z.ersetzt_durch) await tx.run('DELETE FROM api_tokens WHERE token = $1 AND vorgaenger = $2', [z.ersetzt_durch, altHash]);
    const zeile = await tx.get<{ expires_at: Date | null; hard_expires_at: Date | null; rotiert_am: Date }>(
      `INSERT INTO api_tokens (token, user_id, label, created_at, last_used, expires_at, sliding,
                               hard_expires_at, never_expires, scope, ip_bereich, rotiert_am, vorgaenger)
       VALUES ($1, $2, $3, $4, NOW(),
               CASE WHEN $5 AND $6::timestamptz IS NOT NULL THEN NOW() + make_interval(days => $7) ELSE $6::timestamptz END,
               $5, $8, $9, $10, $11, NOW(), $12)
       RETURNING expires_at, hard_expires_at, rotiert_am`,
      [neuHash, z.user_id, z.label, z.created_at, z.sliding, z.expires_at, TOKEN_IDLE_DAYS,
       z.hard_expires_at, z.never_expires, z.scope, ipBereich(ip), altHash]);
    const alt = await tx.get<{ expires_at: Date }>(
      `UPDATE api_tokens
          SET ersetzt_durch = $2, sliding = FALSE, never_expires = FALSE,
              expires_at = LEAST(COALESCE(expires_at, 'infinity'::timestamptz), NOW() + make_interval(secs => $3))
        WHERE token = $1 RETURNING expires_at`, [altHash, neuHash, UEBERLAPPUNG_MS / 1000]);
    return { token: neu, scope: z.scope, expires_at: zeile!.expires_at, hard_expires_at: zeile!.hard_expires_at,
             never_expires: flaggeGesetzt(z.never_expires), rotiert_am: zeile!.rotiert_am,
             alt_gueltig_bis: alt!.expires_at };
  });
  if (ergebnis) leereTokenCache();
  return ergebnis;
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
 * Ausführlich: docs/begruendungen/src/konto/auth.ts.md#abschnitt-5
 * @param {number} userId
 * @returns {Promise<void>}
 */
/**
 * Alle offenen BROWSER-SITZUNGEN eines Kontos beenden.
 * Ausführlich: docs/begruendungen/src/konto/auth.ts.md#revokeallsessions
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
 * Tage ohne Nutzung, nach denen ein Gerätezugang verfällt (mindestens 1).
 * Ohne Ablauf gibt es nur die ausdrückliche Wahl „unbegrenzt“ je Gerät.
 * Ausführlich: docs/begruendungen/src/konto/auth.ts.md#token-idle-days
 */
const TOKEN_IDLE_DAYS = konfig().tokenLeerlaufTage;

/**
 * Tokens aufräumen: abgelaufene, und solche, die zu lange ungenutzt sind.
 * Ausführlich: docs/begruendungen/src/konto/auth.ts.md#purgeexpiredtokens
 * @returns {Promise<number>} Anzahl gelöschter Zeilen
 */
async function purgeExpiredTokens() {
  let entfernt = 0;

  // Altzeilen nachziehen, BEVOR geloescht wird
  // Auf einer gewachsenen Datenbank stehen App- und QR-Token noch ohne
  // Ablaufdatum. Ihre Frist lief bisher ueber COALESCE(last_used, created_at)
  // — genau diese Rechnung wird hier einmal in die Spalte geschrieben. Damit …
  // Ausführlich: docs/begruendungen/src/konto/auth.ts.md#purgeexpiredtokens-2
  {
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
  // Ausführlich: docs/begruendungen/src/konto/auth.ts.md#purgeexpiredtokens-3
  {
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
  validateToken, invalidateToken, leereTokenCache, flaggeGesetzt, resolveUserId, requireLoginOrToken, nutzerId, angemeldeteNutzerId, istVerwalter, nutzerName, hashToken, deleteToken,
  verifiziereEmailToken, perSitzung,
  revokeAllTokens, revokeAllSessions, beendeAndereZugaenge, purgeExpiredTokens, loginOrTokenGuard, TOKEN_IDLE_DAYS,
  pruefeToken, rotiereToken, rotationFaellig, rotationPflicht, ipBereich, UNBEGRENZT,
  laufzeitTage,
  assertLoginAllowed, pruefeAnmeldedaten, createToken, escapeLike, establishSession, BCRYPT_ROUNDS, USERNAME_RE,
  PASSWORT_MIN_ZEICHEN, passwortZuKurz,
  EMAIL_RE, isValidLoginIdentifier,
};
