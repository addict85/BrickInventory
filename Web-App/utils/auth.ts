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
import { checkLoginAllowed, recordLoginFailure, recordLoginSuccess } from './loginLimiter';
import { sendeFehler } from './fehlerTexte';
import type { FehlerCode } from './fehlerTexte';

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
    SELECT t.user_id, t.expires_at, t.last_used, t.sliding, u.username, u.is_admin
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
  // ── Die stille Erneuerung ─────────────────────────────────────────────────
  //
  // Hier wird nicht nur vermerkt, DASS der Token benutzt wurde, sondern die
  // Frist gleich mit nach vorn geschoben. Genau das macht sie zur gleitenden:
  // Ein Telefon, das taeglich synchronisiert, laeuft nie ab; eines, das in
  // einer Schublade liegt, nach TOKEN_IDLE_DAYS.
  //
  // Die App merkt davon nichts und muss nichts dafuer tun — kein zweiter
  // Endpunkt, kein Erneuerungstanz, keine Fassung der App, die das koennen
  // muss. Der Aufruf laeuft ohnehin schon bei jeder Anfrage (gedrosselt auf
  // alle fuenf Minuten, ohne await im Anfrageweg).
  //
  // `sliding AND expires_at IS NOT NULL` im CASE: Der Sieben-Tage-Token des
  // Browsers darf nicht mitgleiten (siehe createToken), und eine Zeile ohne
  // Ablauf soll auch keinen bekommen, nur weil sie benutzt wird.
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
 * Beim Logout/Token-Löschen aufrufen, damit der Token sofort ungültig wird.
 * @param {string|null|undefined} token
 */
function invalidateToken(token: string | null | undefined): void { if (token) _tokenCache.delete(token); }

/**
 * Den ganzen Token-Cache verwerfen.
 *
 * Für den Fall, dass eine Zeile ohne ihren KLARTEXT gelöscht wird — etwa aus
 * der Token-Verwaltung, die nur den Hash-Anfang kennt. Gezielt geht dort
 * nichts: Der Cache ist nach dem Klartext indiziert, und den hat der Server
 * nach der Ausgabe nie wieder gesehen.
 *
 * Er baut sich innerhalb weniger Anfragen wieder auf. Im Cluster wirkt das
 * nur im eigenen Arbeitsprozess; die übrigen bedienen den gelöschten Token
 * noch bis zu TOKEN_TTL_MS. Dieselbe Einschränkung wie bei revokeAllTokens,
 * und aus demselben Grund vertretbar.
 */
function leereTokenCache(): void { _tokenCache.clear(); }

/**
 * Ist diese Datenbank-Flagge gesetzt?
 *
 * ── Warum es das braucht ────────────────────────────────────────────────────
 * `is_admin` kam in routes/auth.ts in DREI Schreibweisen vor —
 * `== 1 || === true`, `=== 1 || === true` und `!!wert` —, sechsmal insgesamt.
 * Alle drei bedeuten dasselbe; die Vielfalt entstand, weil die Spalte je nach
 * Alter der Installation INTEGER (0/1) oder BOOLEAN ist und jeder Autor sich
 * eigens dagegen gewappnet hat.
 *
 * Gebraucht wird sie jetzt an einer siebten Stelle: Beim Rechtewechsel muss
 * der ALTE Wert mit dem neuen verglichen werden. Eine siebte Schreibweise
 * dafuer waere die Fortsetzung genau des Musters, das in dieser Reihe schon
 * mehrfach zu auseinanderlaufendem Verhalten gefuehrt hat.
 *
 * `== 1` statt `=== 1`: Ein Treiber, der die Spalte als Zeichenkette liefert
 * ('1'), soll nicht als „nicht gesetzt" gelten — das war der Grund fuer die
 * lose Gleichheit in der aeltesten der drei Fassungen, und er gilt weiter.
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

/**
 * Wie kurz ein Passwort hoechstens sein darf.
 *
 * ── Warum das eine Konstante ist ────────────────────────────────────────────
 * Sechs Routen setzen ein Passwort. VIER pruefen die Laenge, und zwar in zwei
 * Schreibweisen (`password.length < 8` und `String(password).length < 8`),
 * jede von Hand hingeschrieben:
 *
 *   POST /register                    prueft
 *   POST /reset-password              prueft
 *   POST /users                       prueft
 *   PUT  /users/:id/password          prueft
 *   PUT  /profile                     PRUEFTE NICHT
 *   POST /change-password             PRUEFTE NICHT
 *
 * Ausgefallen war sie also genau an den zwei Wegen, die einem BEREITS
 * ANGEMELDETEN Konto offenstehen — und damit war die Regel wirkungslos: Man
 * meldet sich mit acht Zeichen an und aendert danach auf eines.
 *
 * Der Grund fuer die Luecke ist die fehlende Konstante. Wo eine Regel an jeder
 * Stelle neu getippt wird, gibt es keine Stelle, die man vergessen KOENNTE —
 * es gibt nur Stellen, an denen sie nie stand.
 */
const PASSWORT_MIN_ZEICHEN = 8;

/**
 * Ist dieses Passwort zu kurz?
 *
 * `String(...)` statt eines Typs: Der Rumpf einer Anfrage kann alles
 * enthalten, auch eine Zahl oder `null`. Zwei der vier alten Pruefungen
 * schrieben deshalb `String(password).length`, die anderen zwei nicht —
 * `(123456789).length` ist `undefined`, und `undefined < 8` ist FALSCH. Ein
 * Passwort als JSON-Zahl kam damit an der kuerzeren Fassung vorbei.
 *
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
  // Die Absage traegt einen CODE und keinen Satz (Nachtrag 130): Welche
  // Sprache der Anfragende sieht, weiss die Route.
  const absage = (status: number, code: FehlerCode,
                  vars?: Record<string, string | number>, unverified?: boolean): AnmeldeErgebnis =>
    ({ ok: false, absage: { status, code, ...(vars ? { vars } : {}),
                            ...(unverified ? { unverified: true } : {}) } });

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
  await recordLoginSuccess(req, name);

  const blockiert = assertLoginAllowed(user);
  if (blockiert) return absage(blockiert.status, blockiert.code, undefined, blockiert.unverified);
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
 *
 * Ein Token in der Adresszeile landet im Referer fremder Seiten, im
 * Browserverlauf, in Reverse-Proxy-Protokollen und in jedem Fehlerbericht, der
 * die URL mitschickt. Er verschwindet dort auch nicht wieder. Bis hierher war
 * es der SITZUNGSTOKEN, der das ganze Konto oeffnet — bei der App einer ohne
 * Ablauf.
 *
 * An dieser Stelle stand deshalb eine kurze Ausnahmeliste mit der Begruendung,
 * <img src>, <iframe src>, window.open() und EventSource koennten keine
 * Kopfzeilen setzen. Das stimmt — nur hatte KEINER der drei Eintraege noch
 * einen Nutzer. Nachgezaehlt im Baum, alle drei Erzeuger von `?token=`:
 *
 *   • public/js/01-core.js und public/js/02-gallery.js haengten ihn an den
 *     SSE-Strom des CSV-Imports. Beide oeffnen den Kanal mit
 *     `withCredentials: true`, und `webToken` entsteht ueberhaupt erst NACH
 *     einer erfolgreichen Anmeldung — die das Sitzungs-Cookie setzt. Einen
 *     Browser, der den Token hat und das Cookie nicht, gibt es nicht. Der
 *     Kommentar an der Aufrufstelle sagte das selbst: „Cookie-Session
 *     funktioniert ohnehin".
 *   • Die App haengte ihn an die Anleitung (SetDetailSections.kt). Die Datei
 *     holt aber der In-App-Betrachter ueber den geteilten OkHttp-Client, und
 *     dessen Interceptor setzt den Authorization-Kopf fuer JEDE Adresse
 *     unseres Servers (di/AppModule.kt). Der Token in der Adresse war doppelt
 *     gemoppelt — und wurde nebenbei als Text unter der Anleitung ANGEZEIGT
 *     und als Navigationsargument im Backstack abgelegt.
 *   • Der Polling-Rueckfall (/import/csv/status) und die Token-Verwaltung
 *     benutzen `fetch` und setzen den Kopf richtig. Der Bild-Proxy hatte gar
 *     keinen Aufrufer; imgUrl() liefert nackte Pfade, Bilder weisen sich im
 *     Browser ueber das Cookie aus.
 *
 * Es blieb also eine Erlaubnis ohne Nutzen — und eine Erlaubnis ohne Nutzen
 * ist reine Angriffsflaeche. Sie ist ersatzlos weg; das ist strenger als
 * kurzlebige Ersatztoken und braucht keine zweite Tabelle.
 *
 * Rueckwaerts vertraeglich: Wer eine aeltere App oder altes, zwischengespeichertes
 * Javascript benutzt, haengt den Token weiter an. Der Server sieht ihn nicht mehr
 * an — aber Kopfzeile bzw. Cookie tragen die Anfrage ohnehin, wie oben gezeigt.
 *
 * Kommt je eine Stelle dazu, die WIRKLICH keine Kopfzeile setzen kann, gehoert
 * dorthin ein eigener, kurzlebiger Token — nicht der Sitzungstoken und nicht
 * wieder eine Ausnahme fuer diesen hier.
 */

/**
 * Ermittelt die userId aus Session oder Bearer-Token.
 *
 * ?token= wird NICHT mehr ausgewertet — auf jeder Route zählt ausschliesslich
 * der Authorization-Header (oder die Sitzung). Warum die Ausnahmeliste weg
 * ist, steht im Block darüber.
 *
 * @param req Express-Request
 * @returns {Promise<number|null>} null wenn nicht authentifiziert
 */
async function resolveUserId(req: Request): Promise<number | null> {
  if (req.session?.userId) return req.session.userId;
  const auth = req.headers.authorization || '';
  const token: string | null = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const user = await validateToken(token).catch(() => null);
  // Vorher stand hier parseInt(user.user_id). Das war schon immer wirkungslos:
  // Die Spalte ist INTEGER, der Treiber liefert eine Zahl, und parseInt haette
  // sie erst in einen String verwandelt. Aufgefallen ist es erst, als der Typ
  // dastand.
  //
  // Der ganze Nutzer wird abgelegt, nicht nur seine Kennung: Sonst wuesste ein
  // Handler hinter requireLoginOrToken zwar WER fragt, aber nicht, ob es ein
  // Verwalter ist — `req.session.isAdmin` ist bei einer Token-Anfrage immer
  // undefined. Das faellt nicht als Fehler auf, sondern liefert stillschweigend
  // die Ansicht eines Nicht-Verwalters (siehe istVerwalter). requireApiAdmin
  // legt dasselbe Feld ab; damit gibt es EINEN Ort, an dem es steht.
  // `is_admin` kommt je nach Treiber als 0/1 oder als Wahrheitswert; das Feld
  // auf Express.Request ist als Zahl deklariert. Hier einmal vereinheitlichen
  // ist richtiger, als jeden Leser beide Formen kennen zu lassen.
  if (user) req.apiUser = { ...user, is_admin: user.is_admin ? 1 : 0 };
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
 *
 * ── Warum es diesen Helfer gibt (Nachtrag 127) ──────────────────────────────
 *
 * Dieselbe Frage stand an vier Stellen und in ZWEI Reihenfolgen:
 *
 *     routes/settings.ts   req.session?.userId || req.tokenUserId
 *     routes/sets.ts       req.tokenUserId || Number(req.session.userId)
 *
 * Der Unterschied ist nicht bloss Geschmack: Die eine Fassung wandelt in eine
 * Zahl, die andere nicht — und wer sie falsch herum abschreibt, bekommt bei
 * einer Anfrage MIT Sitzung UND Token einen anderen Nutzer als der Nachbarcode.
 *
 * Und es gibt eine DRITTE Schreibweise: requireApiAdmin in
 * routes/api_v1/middleware.ts legt `req.apiUser` ab, nicht `req.tokenUserId`.
 * Dieser Helfer liest alle drei, damit ein Handler nicht wissen muss, welcher
 * Waechter vor ihm stand.
 *
 * Reihenfolge: Die SITZUNG zuerst. Wer im Browser angemeldet ist und dabei
 * versehentlich einen fremden Token mitschickt, bleibt der, als der er sich
 * angemeldet hat.
 *
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
 *
 * Das Gegenstueck zu [nutzerId] und aus demselben Anlass: `req.session.isAdmin`
 * stand an sechs Stellen in routes/settings.ts und ist bei einer Anfrage MIT
 * Token immer `undefined`. Die Folge waere nicht ein Fehler, sondern etwas
 * Schlimmeres: Die App bekaeme stillschweigend die Ansicht eines Nicht-
 * Verwalters — beim Sichern der Einstellungen etwa ohne die globalen Werte,
 * ohne dass irgendwo etwas schiefginge.
 *
 * `apiUser.is_admin` ist eine 0/1-Zahl aus der Datenbank, `session.isAdmin` ein
 * Wahrheitswert. Beides wird hier auf einen Wahrheitswert gebracht, damit der
 * Aufrufer den Unterschied nicht kennen muss.
 */
/**
 * Wie [nutzerId], aber fuer Handler, die HINTER einem Waechter stehen.
 *
 * Dort ist die Kennung zugesichert, und `number | null` zwingt jeden Aufrufer
 * zu einer Behandlung des Falls, den es nicht gibt. Die naheliegende Antwort
 * waere ueberall `nutzerId(req)!` — genau die Antwort, die types/augmentations
 * .d.ts fuer `req.session.userId` schon einmal verworfen hat: Das Ausrufezeichen
 * beseitigt die Meldung UND die Pruefung; rutscht die Route eines Tages VOR den
 * Waechter, sagt niemand mehr etwas.
 *
 * Hier wirft es stattdessen. Das ist laut, faellt im Test sofort auf und kann
 * nie stillschweigend mit `undefined` weiterrechnen.
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
 *
 * Die dritte Eigenschaft nach [nutzerId] und [istVerwalter], und sie stand
 * genauso einseitig da: `req.session.username` in der Sicherung
 * (routes/settings.ts) ist bei einer Token-Anfrage `undefined`. Das faellt
 * nicht als Fehler auf — die exportierte Datei traegt dann `exported_by: null`,
 * und wer sie spaeter ansieht, weiss nicht mehr, von welchem Konto sie stammt.
 *
 * `null`, wenn niemand angemeldet ist. Ein Anzeigename ist nichts, worauf eine
 * Berechtigung fussen darf — dafuer gibt es [nutzerId].
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
  if (dauerhaft) {
    // Gleitende Frist statt gar keiner. Bis hierher stand hier NULL, und die
    // 90 Tage aus TOKEN_IDLE_DAYS setzte allein der stuendliche Aufraeumjob
    // durch — per DELETE. Lief der Job nicht (kein Primary-Worker, Absturz,
    // ein Neustart zur falschen Stunde), galt der Token weiter, denn die
    // WHERE-Klausel in validateToken() laesst `expires_at IS NULL` immer
    // durch. Die Frist stand im Job, nicht im Anfrageweg.
    //
    // Jetzt steht sie in der Zeile. `sliding` merkt sich, dass dieses Datum
    // bei jeder Benutzung nachrueckt (_touchLastUsed) — dieselbe Bedeutung
    // wie vorher („90 Tage ohne Nutzung"), nur an der Stelle durchgesetzt, an
    // der jede Anfrage ohnehin vorbeikommt.
    //
    // TOKEN_IDLE_DAYS === 0 schaltet die Regel ab; dann bleibt es bei NULL,
    // wie es die Beschreibung der Variablen zusagt.
    await db.run(
      TOKEN_IDLE_DAYS > 0
        ? `INSERT INTO api_tokens (token, user_id, label, expires_at, sliding)
           VALUES ($1,$2,$3, NOW() + make_interval(days => $4), TRUE) ON CONFLICT DO NOTHING`
        : 'INSERT INTO api_tokens (token, user_id, label, expires_at, sliding) VALUES ($1,$2,$3,NULL,TRUE) ON CONFLICT DO NOTHING',
      TOKEN_IDLE_DAYS > 0
        ? [hashToken(token), userId, label, TOKEN_IDLE_DAYS]
        : [hashToken(token), userId, label]
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

  // ── Altzeilen nachziehen, BEVOR geloescht wird ────────────────────────────
  //
  // Auf einer gewachsenen Datenbank stehen App- und QR-Token noch ohne
  // Ablaufdatum. Ihre Frist lief bisher ueber COALESCE(last_used, created_at)
  // — genau diese Rechnung wird hier einmal in die Spalte geschrieben. Damit
  // gilt fuer sie ab sofort dieselbe Pruefung wie fuer neue Zeilen, ohne dass
  // sich an ihrer LAUFZEIT irgendetwas aendert.
  //
  // Vor dem Loeschen, nicht danach: Sonst traegt dieser Lauf Daten ein, die
  // teils schon in der Vergangenheit liegen, und erst der naechste raeumt sie
  // weg — eine Stunde spaeter. Gueltig sind sie in der Zwischenzeit ohnehin
  // nicht mehr (validateToken prueft das Datum), aber die Tabelle soll nicht
  // eine Runde lang Zeilen tragen, die dieser Lauf haette entfernen koennen.
  //
  // Steht in dieser Datei und nicht in db/database.ts: Die Frist heisst
  // TOKEN_IDLE_DAYS und wird hier gelesen. Ein zweiter Ort mit derselben
  // Rechnung waere die naechste Stelle, an der eine Regel still auseinander
  // laeuft.
  if (TOKEN_IDLE_DAYS > 0) {
    const nachgezogen = await db.run(
      `UPDATE api_tokens
          SET sliding = TRUE,
              expires_at = COALESCE(last_used, created_at) + make_interval(days => $1)
        WHERE expires_at IS NULL`,
      [TOKEN_IDLE_DAYS]
    ).catch(e => { console.warn('[tokens] Altzeilen nachziehen:', e?.message || e); return null; });
    const m = nachgezogen?.changes || 0;
    if (m) console.log(`[tokens] ${m} Token ohne Ablaufdatum auf die Gleitfrist von ${TOKEN_IDLE_DAYS} Tagen gesetzt`);
  }

  const abgelaufen = await db.run(
    'DELETE FROM api_tokens WHERE expires_at IS NOT NULL AND expires_at < NOW()'
  ).catch(e => { console.warn('[tokens] Aufräumen abgelaufener Tokens:', e?.message || e); return null; });
  entfernt += abgelaufen?.changes || 0;

  // Diese zweite Regel trifft seit der Umstellung oben kaum noch etwas: Nach
  // dem Nachziehen hat jede Zeile ein Ablaufdatum. Sie bleibt trotzdem stehen
  // — fuer den Server, der eine Weile mit TOKEN_IDLE_DAYS=0 lief (dort
  // entstehen weiter Zeilen ohne Datum) und die Regel dann einschaltet. Der
  // Lauf davor zieht sie zwar schon nach; diese Zeile ist der Rueckhalt, falls
  // das UPDATE scheitert. Zwei billige DELETEs auf einer kleinen Tabelle sind
  // der Preis dafuer, dass kein Token durchrutscht.
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
  validateToken, invalidateToken, leereTokenCache, flaggeGesetzt, resolveUserId, requireLoginOrToken, nutzerId, angemeldeteNutzerId, istVerwalter, nutzerName, hashToken, deleteToken,
  verifiziereEmailToken,
  revokeAllTokens, revokeAllSessions, purgeExpiredTokens, loginOrTokenGuard, TOKEN_IDLE_DAYS, appTokenOhneAblauf,
  assertLoginAllowed, pruefeAnmeldedaten, createToken, escapeLike, establishSession, BCRYPT_ROUNDS, USERNAME_RE,
  PASSWORT_MIN_ZEICHEN, passwortZuKurz,
  EMAIL_RE, isValidLoginIdentifier,
};
