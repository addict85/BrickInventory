
import express from 'express';
const router  = express.Router();
import bcrypt from 'bcryptjs';
import * as db from '../db/database';
import { handleRouteError, logAndContinue, meldeUndWeiter, fehlerCode, fehlertext, pfadParam } from '../utils/httpError';
import { hashToken, pruefeAnmeldedaten, createToken, validateToken, assertLoginAllowed, establishSession, revokeAllTokens, revokeAllSessions, deleteToken, BCRYPT_ROUNDS, USERNAME_RE, EMAIL_RE, requireLoginOrToken, nutzerId, angemeldeteNutzerId, appTokenOhneAblauf, passwortZuKurz, flaggeGesetzt, leereTokenCache } from '../utils/auth';
import { ipThrottle } from '../utils/loginLimiter';
import crypto from 'crypto';
import { strictBool } from '../utils/validate';
import { sendPasswordResetMail, sendVerificationMail } from './mailer';
import type { Request } from 'express';
import { getGlobalSetting } from '../utils/settings';
import { requireApiAdmin } from './api_v1/middleware';
import { sendeFehler, fehlerText, antwortSprache } from '../utils/fehlerTexte';

// ── „Angemeldet" gibt es nur noch in EINER Fassung ──────────────────────────
//
// Hier standen zwei eigene Waechter, die AUSSCHLIESSLICH die Sitzung kannten.
// Die Android-App hat keine Sitzung — sie weist sich mit einem Bearer-Token
// aus. Sie war damit von einundzwanzig Routen ausgesperrt, und zwar von genau
// denen, deren Fehlen an der App aufgefallen war:
//
//     CSV-Import fuer Teile und Minifiguren   routes/parts.ts, routes/minifigs.ts
//     Anleitungen hochladen und loeschen      routes/sets.ts
//     Sicherung exportieren/einspielen        routes/settings.ts
//     Profil, Passwort aendern                hier
//     Nutzerverwaltung                        hier
//
// Sechs vermeintlich fehlende Funktionen, EINE Ursache: dieselbe Regel in zwei
// Schreibweisen, und die App konnte nur die eine erfuellen. server.ts sagt an
// der Stelle, wo diese Router eingehaengt werden, seit jeher voraus, was zu tun
// ist: „Wer diese Routen auch fuer die App oeffnen will, stellt requireLogin
// auf requireToken um — ein eigener Schritt." Das ist dieser Schritt.
//
// Die Namen bleiben, damit die Aufrufer unveraendert bleiben; was sich aendert,
// ist die BEDEUTUNG — und die ist jetzt dieselbe wie ueberall sonst im Baum.
//
// Kein CSRF-Zuwachs: Der Schutz haengt am Cookie (SameSite=lax, server.ts).
// Einen Authorization-Header schickt ein Browser NIE von selbst mit; ein
// zusaetzlich akzeptierter Bearer-Token vergroessert die Angriffsflaeche
// deshalb nicht.
const requireLogin = requireLoginOrToken;
const requireAdmin = requireApiAdmin;

/**
 * POST /api/v1/auth/login — die EINE Anmeldung, fuer Webapp und App.
 *
 * ── Warum es davon nur noch eine gibt ───────────────────────────────────────
 * Es gab zwei: diese hier (Sitzung, Cookie) und /api/v1/auth/login (Token).
 * Sie beantworten dieselbe Frage und unterschieden sich nur darin, WAS sie
 * zurueckgeben — und genau das hat sie zweimal auseinanderlaufen lassen (siehe
 * pruefeAnmeldedaten in utils/auth.ts).
 *
 * Zusammenlegen geht, weil der Sitzungs-Login SCHON IMMER auch einen Token
 * ausgestellt hat: Die Webapp braucht ihn fuer EventSource, das keine
 * Kopfzeilen setzen kann. Beide Clients bekommen jetzt beides; der Browser
 * benutzt die Sitzung und legt den Token daneben, die App ignoriert das
 * Cookie und benutzt den Token.
 *
 * Der einzige echte Unterschied ist die LAUFZEIT des Tokens, und die steht
 * jetzt ausdruecklich in der Anfrage (`never_expires`) statt implizit in der
 * Adresse. Begruendung siehe createToken().
 */
router.post('/login', async (req, res) => {
  const { username, password, label, never_expires } = req.body;
  try {
    // Form des Namens, Brute-Force-Sperre, Passwortvergleich und die
    // Konto-Vorbedingungen stehen in utils/auth.ts.
    const pruefung = await pruefeAnmeldedaten(req, username, password);
    if (!pruefung.ok) {
      const { status, code, vars, unverified } = pruefung.absage;
      // `unverified` haengt zusaetzlich dran — die Oberflaeche blendet daran
      // das „E-Mail erneut senden?" ein. sendeFehler kennt das Feld nicht, es
      // gehoert zu genau diesem einen Fall.
      if (unverified) {
        return res.status(status).json({
          success: false, code, unverified: true,
          error: fehlerText(code, antwortSprache(req), vars),
        });
      }
      return sendeFehler(req, res, status, code, vars);
    }
    const user = pruefung.user;
    // Session-ID erneuern (gegen Session Fixation) und erst dann fuellen.
    // Auch fuer die App: Sie schickt das Cookie nie zurueck, die Zeile
    // verfaellt von selbst — und einen Sonderfall weniger gibt es hier.
    await establishSession(req, {
      userId:   parseInt(user.id),   // always int
      username: user.username,
      isAdmin:  flaggeGesetzt(user.is_admin),
    });
    // Scheitert das INSERT, wird der Token NICHT mitgeschickt. Vorher stand
    // hier .catch(() => {}) — die Anmeldung galt als erfolgreich, der Client
    // legte einen Token in den sessionStorage, den die Datenbank nie gesehen
    // hatte, und der SSE-Kanal (`?token=…`) lief in ein 401. Ohne Token faellt
    // der Browser auf die Cookie-Sitzung zurueck; die App kann ohne Token
    // nichts anfangen und bekommt deshalb einen Fehler statt eines halben
    // Erfolgs.
    const dauerhaft = never_expires === true;
    let token: string | null = null;
    try {
      token = await createToken(user.id, label || 'webapp-session', dauerhaft);
    } catch (e) {
      console.warn('[login] Token konnte nicht gespeichert werden:', fehlertext(e));
      if (dauerhaft)
        return sendeFehler(req, res, 500, 'token_nicht_ausgestellt');
    }
    // `never_expires` sagt jetzt die Wahrheit statt der Absicht. Hier stand
    // schlicht `dauerhaft` — also das, was der Client VERLANGT hatte. Seit der
    // App-Token eine gleitende Frist traegt, ist das nur noch dann ein Token
    // ohne Ablauf, wenn die Frist ganz abgeschaltet ist. Die Regel dafuer
    // steht in utils/auth.ts, nicht hier.
    res.json({ success: true, ...(token ? { token } : {}), never_expires: dauerhaft && appTokenOhneAblauf(),
      user: { id: user.id, username: user.username, is_admin: flaggeGesetzt(user.is_admin),
      // Nur beim automatisch generierten Default-Admin-Passwort gesetzt (siehe
      // db/database.ts) — der Client fordert dann zur Passwortaenderung auf.
      // Wird durch POST /change-password wieder geloescht.
      mustChangePassword: !!(user.must_change_password === 1 || user.must_change_password === true) } });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

/**
 * POST /api/v1/auth/logout — Sitzung beenden UND den Token entwerten.
 *
 * Auch hiervon gab es zwei Fassungen: Die eine zerstoerte die Sitzung, die
 * andere loeschte den Token. Wer beides hat — und seit dem Zusammenlegen des
 * Logins hat das JEDER angemeldete Client —, musste beide aufrufen, um
 * wirklich abgemeldet zu sein.
 *
 * Ohne Anmeldung erreichbar (kein requireToken davor): Abmelden ist nichts,
 * woran man scheitern koennen soll. Wer weder Sitzung noch Token schickt,
 * bekommt success — es gibt schlicht nichts zu tun.
 *
 * Der Token muss im Authorization-Header stehen; sonst kann der Server nicht
 * wissen, welcher es war. Fehlt er, wird nur die Sitzung zerstoert. Er liegt
 * im sessionStorage des Browsers und ist damit per XSS auslesbar — ein Token,
 * der eine bewusste Abmeldung ueberlebt, ist genau das, was man dabei nicht
 * will.
 */
router.post('/logout', async (req, res) => {
  const auth = String(req.headers.authorization || '');
  // Fehler hier nur loggen: Die Abmeldung darf nicht daran scheitern, dass der
  // Token nicht entsorgt werden konnte — aber schweigend uebergangen hiesse,
  // dass genau der Fall unbemerkt bleibt, den der Absatz oben verhindern soll.
  if (auth.startsWith('Bearer ')) await deleteToken(auth.slice(7)).catch(logAndContinue('logout:token entsorgen'));
  // req.session.destroy gibt es nur mit Sitzungs-Middleware davor; die App
  // ruft dieselbe Adresse ohne Cookie auf.
  if (req.session?.destroy) return req.session.destroy(() => res.json({ success: true }));
  res.json({ success: true });
});

/**
 * GET /api/v1/auth/me — wer bin ich? Sitzung ODER Token.
 *
 * ── Die eine Stelle, an der die beiden Fassungen wirklich verschieden waren ─
 * Die Sitzungs-Fassung antwortete `{loggedIn:false}` mit 200, die
 * Token-Fassung mit 401. Beides ist fuer sich richtig, und zwar aus
 * verschiedenen Gruenden:
 *
 *  * Der Browser fragt das VOR jeder Anmeldung, ganz ohne Ausweis. Ein 401
 *    waere dort die normale Antwort auf eine normale Frage — die Webapp
 *    muesste ihn eigens ausnehmen (und tat das auch).
 *  * Die App fragt es MIT einem Token, den sie fuer gueltig haelt. Ein 200
 *    waere dort eine verpasste Gelegenheit: Ihr OkHttp-Interceptor macht aus
 *    jedem 401 „Sitzung abgelaufen" und fuehrt zurueck zur Anmeldung
 *    (RepoBasis.kt: `response.code() == 401 -> Fehlerart.SITZUNG_ABGELAUFEN`).
 *
 * Die Regel, die beide Faelle richtig bedient, unterscheidet nicht nach
 * CLIENT, sondern nach dem, was tatsaechlich mitgeschickt wurde:
 *
 *     kein Ausweis dabei        -> 200 { loggedIn: false }
 *     Ausweis dabei, ungueltig  -> 401
 *
 * „Du hast mir nichts gegeben" ist eben etwas anderes als „was du mir gegeben
 * hast, gilt nicht".
 *
 * `token_expires`/`token_last_used` stehen nur bei einer Token-Anmeldung drin.
 */
router.get('/me', async (req, res) => {
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  try {
    if (req.session?.userId) {
      const user = await db.get('SELECT id, username, is_admin FROM users WHERE id = $1', [req.session.userId]);
      if (user) return res.json({ success: true, loggedIn: true,
        user: { id: user.id, username: user.username, is_admin: flaggeGesetzt(user.is_admin) } });
    }
    const u = token ? await validateToken(token) : null;
    if (u) return res.json({ success: true, loggedIn: true,
      user: { id: u.user_id, username: u.username, is_admin: flaggeGesetzt(u.is_admin) },
      token_expires: u.expires_at, token_last_used: u.last_used });
    if (token) return res.status(401).json({ success: false, loggedIn: false, user: null,
      code: 'token_ungueltig', error: fehlerText('token_ungueltig', antwortSprache(req)) });
    res.json({ success: true, loggedIn: false, user: null });
  } catch (e) {
    // Wer hier scheitert, ist eben nicht angemeldet — die Anmeldemaske ist die
    // richtige Antwort, keine Fehlerseite. Mit vorgelegtem Token gilt aber
    // dasselbe wie oben: Die App soll es merken.
    meldeUndWeiter('auth:me', e);
    if (token) return res.status(401).json({ success: false, loggedIn: false, user: null,
      code: 'token_ungueltig', error: fehlerText('token_ungueltig', antwortSprache(req)) });
    res.json({ success: true, loggedIn: false, user: null });
  }
});

/**
 * POST /api/v1/auth/token-create — einen zusaetzlichen Token ausstellen.
 *
 * Fuer den Fall, dass ein bereits angemeldeter Client einen zweiten Ausweis
 * braucht (die App holt sich so einen nach der QR-Anmeldung). Sitzung ODER
 * Token genuegt als Nachweis — wer schon drin ist, darf sich einen weiteren
 * Schluessel machen.
 */
router.post('/token-create', requireLogin, async (req, res) => {
  try {
    // Hier stand die VIERTE Schreibweise von „wer fragt hier": Der Header wurde
    // von Hand zerlegt, der Token selbst geprueft und das Ergebnis mit der
    // Sitzung verodert — wortgleich zu dem, was requireLoginOrToken ohnehin
    // tut. Jetzt steht der Waechter in der Kette und die Antwort kommt aus dem
    // einen Helfer.
    const userId = angemeldeteNutzerId(req);
    const label = req.body?.label || 'Android App';
    const neu = await createToken(userId, label, true);
    res.json({ success: true, token: neu, label, never_expires: appTokenOhneAblauf() });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// GET /api/v1/auth/profile — get current user profile
router.get('/profile', requireLogin, async (req, res) => {
  try {
    const user = await db.get(
      'SELECT id, username, email, first_name, last_name, email_verified FROM users WHERE id=$1',
      [nutzerId(req)]
    );
    if (!user) return res.status(404).json({ success: false });
    res.json({ success: true, user });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// PUT /api/v1/auth/profile — update current user profile
router.put('/profile', requireLogin, async (req, res) => {
  const { username, email, first_name, last_name, password, password_current } = req.body;
  try {
    const user = await db.get('SELECT * FROM users WHERE id=$1', [nutzerId(req)]);
    if (!user) return res.status(404).json({ success: false });

    // If changing password, verify current password
    if (password) {
      if (!password_current) return sendeFehler(req, res, 400, 'aktuelles_passwort_erforderlich');
      const valid = await bcrypt.compare(password_current, user.password_hash);
      if (!valid) return sendeFehler(req, res, 400, 'aktuelles_passwort_falsch');
    }

    // Benutzername: dieselbe Regex wie Login/Register — das Profil-Update hat
    // sie vorher NICHT erzwungen. Ohne sie konnte man Leerzeichen setzen oder
    // (schlimmer) die E-Mail-Adresse eines anderen Nutzers als Benutzernamen
    // eintragen, weil der Login "username ODER email" case-insensitiv sucht.
    if (username !== undefined && !USERNAME_RE.test(String(username || '')))
      return sendeFehler(req, res, 400, 'benutzername_ungueltig');

    // Eindeutigkeit case-INsensitiv prüfen (der Login vergleicht mit LOWER()) —
    // vorher konnten "Marco" und "marco" nebeneinander existieren und welcher
    // beim Login trifft, war ohne ORDER BY undefiniert. Zusätzlich wird gegen
    // die E-Mail-Spalte geprüft, weil der Login beide Felder akzeptiert.
    if (username && username.toLowerCase() !== String(user.username || '').toLowerCase()) {
      const existing = await db.get(
        'SELECT id FROM users WHERE (LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1)) AND id != $2',
        [username, user.id]);
      if (existing) return sendeFehler(req, res, 400, 'benutzername_vergeben');
    }

    // Check email uniqueness
    const emailChanged = email && email.toLowerCase() !== String(user.email || '').toLowerCase();
    if (emailChanged) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return sendeFehler(req, res, 400, 'email_ungueltig');
      const existing = await db.get(
        'SELECT id FROM users WHERE (LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($1)) AND id != $2',
        [email, user.id]);
      if (existing) return sendeFehler(req, res, 400, 'email_vergeben');
    }

    // Build update
    const updates: any[] = [];
    const params: any[] = [];
    let pi = 1;
    if (username)    { updates.push(`username=$${pi++}`);   params.push(username); }
    if (first_name !== undefined) { updates.push(`first_name=$${pi++}`); params.push(first_name || null); }
    if (last_name  !== undefined) { updates.push(`last_name=$${pi++}`);  params.push(last_name  || null); }
    if (password) {
      // Hier fehlte die Laengenpruefung. Register, Reset und die beiden
      // Verwalter-Routen verlangten acht Zeichen, dieser Weg nicht — und damit
      // war die Regel wirkungslos: acht Zeichen bei der Anmeldung, danach eines.
      if (passwortZuKurz(password)) return sendeFehler(req, res, 400, 'passwort_zu_kurz');
      const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      updates.push(`password_hash=$${pi++}`); params.push(hash);
    }
    if (emailChanged) {
      const token   = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 24*60*60*1000);
      updates.push(`email=$${pi++}`);               params.push(email);
      updates.push(`email_verified=$${pi++}`);       params.push(user.is_admin ? 1 : 0);
      // Nur der Hash landet in der DB — der Klartext geht ausschliesslich per Mail raus
      updates.push(`verification_token=$${pi++}`);   params.push(hashToken(token));
      updates.push(`token_expires=$${pi++}`);        params.push(expires);
      await db.run(
        `UPDATE users SET ${updates.join(',')} WHERE id=$${pi}`,
        [...params, user.id]
      );
      // Send verification mail to new email
      let emailSent = false;
      try {
        emailSent = (await sendVerificationMail(email, first_name || username || user.username, token, getBaseUrl(req))).success;
      } catch (e) { meldeUndWeiter('anmeldung:bestaetigungsmail', e); }
      return res.json({ success: true, emailChanged: true, emailSent });
    }

    if (!updates.length) return res.json({ success: true });
    await db.run(`UPDATE users SET ${updates.join(',')} WHERE id=$${pi}`, [...params, user.id]);
    res.json({ success: true });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// Admin: list users
router.get('/users', requireAdmin, async (_req, res) => {
  try {
    const users = await db.all('SELECT id, username, is_admin, created_at FROM users ORDER BY id');
    res.json({ success: true, users });
  } catch (e) { handleRouteError(res, e, undefined, _req); }
});

// Admin: create user
router.post('/users', requireAdmin, async (req, res) => {
  const { username, password, isAdmin = false } = req.body;
  if (!username || !password) return sendeFehler(req, res, 400, 'benutzername_passwort');
  if (!USERNAME_RE.test(String(username)))
    return sendeFehler(req, res, 400, 'benutzername_ungueltig');
  if (passwortZuKurz(password))
    return sendeFehler(req, res, 400, 'passwort_zu_kurz');
  try {
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const r = await db.run('INSERT INTO users (username, password_hash, is_admin) VALUES ($1, $2, $3)',
      [username, hash, isAdmin ? 1 : 0]);
    // Sicherheitsnetz: r.changes === 0 hiesse, das INSERT wurde verschluckt
    // (früher hat die SQL-Kompatschicht genau das global getan und dieser
    //  Endpoint meldete success:true, ohne einen Nutzer anzulegen).
    if (r.changes === 0) return sendeFehler(req, res, 409, 'benutzername_vergeben');
    res.json({ success: true });
  } catch (e) {
    if (fehlerCode(e) === '23505') return sendeFehler(req, res, 409, 'benutzername_vergeben');
    handleRouteError(res, e, undefined, req);
  }
});

// Admin: toggle admin role
router.put('/users/:id/admin', requireAdmin, async (req, res) => {
  const targetId = parseInt(pfadParam(req, 'id'));
  try {
    // Dieselbe strenge Prüfung wie auf der v1-Route — die Zeichenkette "false"
    // ist in JavaScript wahr und meldete hier Erfolg, ohne Rechte zu entziehen.
    const soll = strictBool(req.body.is_admin, 'is_admin');
    if (targetId === nutzerId(req) && !soll)
      return sendeFehler(req, res, 400, 'eigene_adminrolle');
    // Den ALTEN Wert holen — daran haengt unten, ob Sitzungen enden muessen.
    //
    // Die Existenzpruefung wandert damit vom UPDATE hierher. Das ist eine
    // Aufraeumung, keine Behebung: Hier stand zuerst als Begruendung, ein
    // wertgleiches UPDATE melde „je nach Treiber 0 Aenderungen". Nachgemessen
    // stimmt das fuer PostgreSQL NICHT — rowCount zaehlt BETROFFENE Zeilen,
    // nicht geaenderte, und die Gegenprobe zur alten Reihenfolge blieb prompt
    // gruen. Der einzige echte Grund fuer das vorgezogene SELECT ist, dass der
    // alte Wert gebraucht wird; dass die 404-Antwort dabei frueher faellt, ist
    // die Folge und nicht der Anlass.
    const vorher = await db.get('SELECT is_admin FROM users WHERE id = $1', [targetId]);
    if (!vorher) return sendeFehler(req, res, 404, 'benutzer_nicht_gefunden');
    const warAdmin = flaggeGesetzt(vorher.is_admin);
    await db.run('UPDATE users SET is_admin = $1 WHERE id = $2', [soll ? 1 : 0, targetId]);

    // ── Warum die Sitzungen enden muessen ──────────────────────────────────
    //
    // istVerwalter() (utils/auth.ts) fragt ZUERST `req.session.isAdmin`. Das
    // steht seit dem Anmelden fest und wird nie nachgefuehrt. Ein Entzug wirkte
    // damit auf den BROWSER gar nicht: Wer sein Fenster offen liess, blieb
    // Verwalter — das Sitzungs-Cookie hat kein maxAge, gilt also bis zum
    // Schliessen des Browsers.
    //
    // Fuer die APP griff der Entzug, weil validateToken() `u.is_admin` per JOIN
    // frisch liest; nur der Cache hielt bis zu 60 Sekunden am alten Wert fest.
    // Also dieselbe Regel, die an zwei Ausweisen verschieden wirkte — und die
    // Haelfte, an der sie nicht wirkte, war die gefaehrlichere.
    //
    // In BEIDE Richtungen und nicht nur beim Entzug: Eine fremde Sitzung laesst
    // sich nicht umschreiben, nur beenden. Wer Rechte BEKOMMT, saehe sie sonst
    // bis zur naechsten Anmeldung nicht — eine Vergabe, die aussieht, als haette
    // sie nicht gewirkt. Eine Regel ohne Fallunterscheidung.
    //
    // Nur bei echter AENDERUNG: Sonst wuerde ein Verwalter, der sich selbst
    // erneut zum Verwalter macht, seine eigene Sitzung beenden.
    if (warAdmin !== soll) {
      await revokeAllSessions(targetId);
      // Der Token-Cache haelt is_admin bis zu 60 Sekunden. Geleert, nicht
      // verworfen: revokeAllTokens() wuerde die App ABMELDEN, und das ist bei
      // einem Rollenwechsel zu viel — sie soll nur die neue Rolle sehen.
      leereTokenCache();
    }
    res.json({ success: true });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// Admin: delete user
/**
 * PUT /api/v1/auth/users/:id/password — Passwort eines anderen Nutzers setzen.
 *
 * Der Dialog in den Einstellungen rief diesen Endpunkt schon immer auf, es gab
 * ihn nur nicht: „API-Endpunkt nicht gefunden" beim Speichern.
 *
 * Anders als /change-password wird KEIN aktuelles Passwort verlangt — ein
 * Administrator kennt es nicht. Genau deshalb ist die Route auf requireAdmin
 * beschränkt und schliesst das eigene Konto aus: Für sich selbst führt der Weg
 * über /change-password, wo das alte Passwort geprüft wird. Sonst genügte eine
 * übernommene Sitzung, um das eigene Passwort ohne Kenntnis des alten zu
 * ändern und den rechtmässigen Besitzer auszusperren.
 */
router.put('/users/:id/password', requireAdmin, async (req, res) => {
  const { password } = req.body || {};
  const targetId = parseInt(pfadParam(req, 'id'));

  if (!password || passwortZuKurz(password))
    return sendeFehler(req, res, 400, 'passwort_zu_kurz');
  if (!targetId || targetId === nutzerId(req))
    return sendeFehler(req, res, 400, 'eigenes_konto_passwort');

  try {
    const hash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
    const r = await db.run('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, targetId]);
    if (!r.changes) return sendeFehler(req, res, 404, 'benutzer_nicht_gefunden');

    // Offene Zugänge des Kontos beenden — ein zurückgesetztes Passwort soll
    // auch bestehende Sitzungen und Token schliessen.
    //
    // Hier stand ein Test auf eine Tabelle `session`, die es nie gibt: Der
    // Store läuft auf `user_sessions` (server.ts, tableName). to_regclass
    // lieferte damit immer NULL und das DELETE lief NIE — ein Administrator
    // konnte das Passwort eines übernommenen Kontos zurücksetzen, und die
    // offene Sitzung des Angreifers blieb bestehen. Beide Schritte laufen
    // jetzt über die zentralen Helfer in utils/auth.ts, ohne Rückfall.
    await revokeAllSessions(targetId);
    await revokeAllTokens(targetId);

    res.json({ success: true });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

router.delete('/users/:id', requireAdmin, async (req, res) => {
  try {
    const targetId = parseInt(pfadParam(req, 'id'));
    const r = await db.run('DELETE FROM users WHERE id = $1 AND id != $2',
      [targetId, nutzerId(req)]);
    if (r.changes === 0) return sendeFehler(req, res, 404, 'benutzer_nicht_gefunden_oder_eigenes');
    // ── Die Zeile ist weg, der Zugang war es nicht ─────────────────────────
    //
    // Die Bearer-Tokens gehen per ON DELETE CASCADE mit (siehe db/schema.sql).
    // user_sessions dagegen ist der Tabellenraum des Session-Stores und hat
    // KEINEN Fremdschluessel auf users — die offene Sitzung des geloeschten
    // Kontos lief weiter, und war es ein Verwalter, blieb es einer.
    //
    // Derselbe Aufruf steht schon beim Admin-Passwortreset, bei
    // /change-password und bei /reset-password. Er fehlte ausgerechnet dort,
    // wo das Konto ganz verschwindet.
    await revokeAllSessions(targetId);
    // Und der Token-Cache, der die geloeschten Zeilen sonst noch bis zu 60
    // Sekunden bedient.
    leereTokenCache();
    res.json({ success: true });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// Change password
// req als LoggedInRequest: Die Route haengt hinter requireLogin, also IST
// session.userId gesetzt. Ohne diese Angabe meldete TypeScript an drei Stellen
// "number | undefined ist nicht number" — und die naheliegende Antwort waere
// dreimal `req.session.userId!` gewesen. Das haette die Meldung beseitigt und
// die Pruefung gleich mit: Rutschte die Route eines Tages VOR requireLogin,
// sagte niemand mehr etwas. Der Typ bindet die Zusicherung an die Middleware,
// nicht an die Erinnerung des Naechsten. Begruendung: types/augmentations.d.ts.
router.post('/change-password', requireLogin, async (req: LoggedInRequest, res) => {
  const { current, newPassword } = req.body;
  if (!current || !newPassword) return sendeFehler(req, res, 400, 'alle_felder_erforderlich');
  // Die Kennung kommt aus dem gemeinsamen Helfer, nicht mehr aus der Sitzung:
  // Seit der Waechter beide Ausweise nimmt, kann hier auch die App stehen.
  const uid = nutzerId(req);
  if (uid == null) return sendeFehler(req, res, 401, 'nicht_angemeldet');
  try {
    const user = await db.get('SELECT * FROM users WHERE id = $1', [uid]);
    if (!(await bcrypt.compare(current, user.password_hash)))
      return sendeFehler(req, res, 401, 'aktuelles_passwort_falsch');
    // NACH der Pruefung des alten Passworts: Wer das aktuelle nicht kennt, soll
    // ueber das neue auch nichts erfahren — die Antwort fuer einen Fremden
    // bleibt dieselbe.
    //
    // Auch hier fehlte die Pruefung ganz. Zusammen mit PUT /profile waren das
    // die zwei Wege eines ANGEMELDETEN Kontos — also genau die, auf denen ein
    // uebernommenes Konto dauerhaft schwach gemacht werden kann.
    if (passwortZuKurz(newPassword)) return sendeFehler(req, res, 400, 'passwort_zu_kurz');
    const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    // must_change_password mit löschen — sonst fragt der Login nach jedem
    // Login des Default-Admins weiter danach, auch nach der Änderung.
    await db.run('UPDATE users SET password_hash = $1, must_change_password = 0 WHERE id = $2', [hash, uid]);
    // Alle Bearer-Tokens des Kontos verwerfen — siehe revokeAllTokens().
    //
    // Fuer die APP heisst das: Sie verwirft mit diesem Aufruf ihren EIGENEN
    // Zugang und muss sich danach neu anmelden. Das ist die richtige Antwort
    // und keine Unachtsamkeit — wer sein Passwort aendert, will alle
    // bestehenden Zugaenge loswerden, und eine Ausnahme fuer den gerade
    // benutzten waere genau die Luecke. Die App sagt es dem Nutzer vorher.
    await revokeAllTokens(uid);
    // ── Und die übrigen Browser-Sitzungen ─────────────────────────────────
    //
    // Wer sein Passwort ändert, will in aller Regel einen fremden Zugang
    // loswerden. Die Tokens waren abgedeckt, die Sitzungen nicht: Ein
    // übernommenes Fenster blieb angemeldet, obwohl das Passwort neu ist.
    //
    // revokeAllSessions trifft auch die eigene Zeile — deshalb danach eine
    // frische Sitzung mit neuer ID herstellen, sonst wäre man aus dem eigenen
    // Tab geflogen. Der Nebeneffekt ist erwünscht: neue ID nach einem
    // Passwortwechsel ist ohnehin die richtige Antwort auf Session Fixation.
    //
    // NUR wenn es ueberhaupt eine Sitzung gibt: Kommt die Anfrage aus der App,
    // ist keine da, und `establishSession` legte eine an, die niemand je
    // benutzt — ein Eintrag im Sitzungsspeicher fuer einen Client, der gar
    // keine Cookies fuehrt.
    await revokeAllSessions(uid);
    if (req.session?.userId) {
      const _self = { userId: uid, username: req.session.username, isAdmin: req.session.isAdmin };
      await establishSession(req, _self);
    }
    res.json({ success: true });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});


// ── Helper: get base URL from request ────────────────────────────────────────
//
// VORHER: proto/host kamen ungeprüft aus X-Forwarded-Host bzw. Host. Diese
// Funktion baut Links für Verifizierungs- und Passwort-Reset-Mails — ein
// Angreifer, der bei POST /forgot-password einen fremden Host-Header mitgibt
// (z.B. per curl direkt gegen den Node-Prozess, oder wenn der Reverse-Proxy
// ihn durchreicht), bekommt eine ECHTE, vom Server verschickte Mail mit einem
// Link, dessen Domain er kontrolliert. Klickt das Opfer, geht der Reset-Token
// an den Angreifer. Ein Header darf für sicherheitsrelevante Ausgaben nie als
// vertrauenswürdig gelten, egal was der Proxy normalerweise setzt.
//
// Fix: APP_BASE_URL aus der Umgebung, wenn gesetzt — dann zählt NUR das.
// Ohne die Variable fällt die Funktion auf den alten (unsicheren) Header-Pfad
// zurück, damit bestehende Installationen ohne Konfiguration weiterlaufen;
// ein einmaliger Log-Hinweis in Produktion macht auf die Lücke aufmerksam.
let _baseUrlWarned = false;
function getBaseUrl(req: Request): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/+$/, '');
  if (process.env.NODE_ENV === 'production' && !_baseUrlWarned) {
    _baseUrlWarned = true;
    console.warn('⚠️  [auth] APP_BASE_URL ist nicht gesetzt — Links in E-Mails übernehmen den Host-Header ungeprüft (Host-Header-Injection möglich). Bitte APP_BASE_URL setzen.');
  }
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host  = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  return `${proto}://${host}`;
}

// ── QR-Login ──────────────────────────────────────────────────────────────────
// VORHER: Der QR-Code enthielt den bcrypt-Hash des Nutzers (`h: password_hash`)
// in einem base64-Payload, HMAC-signiert mit dem SESSION_SECRET. Der Kommentar
// dort sagte „safe to include (can't reverse to plaintext)" — das stimmt fürs
// Reversieren, nicht fürs Knacken: Wer den Code fotografiert, über die Schulter
// scannt oder den Screenshot findet, hat den Hash offline und unbegrenzt zum
// Durchprobieren, und derselbe Hash ist der Webapp-Login. Zusätzlich war der
// Code 30 Minuten lang beliebig oft einlösbar.
//
// JETZT: Der QR-Code enthält nur noch eine zufällige, einmalig einlösbare
// Nonce. Sie steht (als SHA-256) in qr_login_tokens, läuft nach 5 Minuten ab
// und wird beim Einlösen atomar entwertet. Kein Geheimnis im Code, keine
// HMAC-Signatur nötig, keine Zweitverwendung des SESSION_SECRET.
const QR_TTL_MS = 5 * 60 * 1000;

// qr_login_tokens wird beim Start in db/database.ts angelegt, nicht hier. An
// dieser Stelle stand bis zuletzt ein zweites, zeichengleiches CREATE TABLE IF
// NOT EXISTS, aufgerufen bei JEDER Token-Erzeugung und JEDER Einlösung — obwohl
// der zentrale Kommentar dort das Gegenteil behauptet. Siehe die ausführliche
// Begründung in routes/sets.ts an derselben Stelle.

// POST /api/v1/auth/qr-token — Nonce erzeugen (nur für die eigene Session)
// ── POST statt GET (Nachtrag 154) ────────────────────────────────────────────
// Diese Route LEGT ETWAS AN: eine QR-Login-Nonce, die fünf Minuten lang ein
// Konto öffnet. Als GET war sie die einzige zustandsändernde Route im Baum,
// die an der Session hängt — und genau die Lücke, die SameSite=lax offen
// lässt: Bei einer Navigation von einer fremden Seite (window.open, ein Link,
// location=) schickt der Browser das Sitzungs-Cookie mit, und der Server legt
// eine Nonce an.
//
// Lesen konnte ein Angreifer die Antwort nicht — eine Navigation quer über
// Ursprünge hinweg gibt ihm keinen Zugriff auf den Rumpf. Erzwingen konnte er
// sie aber, und dasselbe tun Link-Vorschauen, Virenscanner und die
// Vorab-Ladelogik der Browser: alles, was ein GET für gefahrlos hält, weil GET
// gefahrlos sein SOLL.
//
// Mit POST ist es unabhängig von jeder CSRF-Entscheidung erledigt: SameSite=lax
// schickt bei einem fremden POST kein Cookie mit. Einziger Aufrufer war
// public/js/05-settings.js — dort mitgeändert.
router.post('/qr-token', requireLogin, async (req, res) => {
  // Die eigene Sitzungspruefung stand im Rumpf; der Waechter steht jetzt in
  // der Kette und kennt beide Ausweise — siehe den Block ueber requireLogin.
  try {
    // Abgelaufene/verbrauchte Nonces mitentsorgen — die Tabelle bleibt so klein.
    await db.run(`DELETE FROM qr_login_tokens WHERE expires_at < NOW() - INTERVAL '1 hour'`)
      .catch(logAndContinue('qr-token:aufräumen'));
    const nonce = crypto.randomBytes(32).toString('base64url');
    await db.run(
      'INSERT INTO qr_login_tokens (token, user_id, expires_at) VALUES ($1,$2,$3)',
      [hashToken(nonce), nutzerId(req), new Date(Date.now() + QR_TTL_MS)]
    );
    res.json({ success: true, token: `bim:${nonce}`, expires_in: QR_TTL_MS / 1000 });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// POST /api/v1/auth/qr-login — Nonce einlösen
//
// ipThrottle wie bei register/forgot/reset: Der Endpunkt schreibt ohne
// Anmeldung in die Datenbank. Die 32-Byte-Nonce ist nicht zu erraten, aber es
// gab keinen Grund, ausgerechnet hier auf die Drossel zu verzichten — 30
// Versuche pro Stunde reichen für jeden echten Anmeldevorgang.
router.post('/qr-login', ipThrottle('qr-login', 30, 60 * 60 * 1000), async (req, res) => {
  const { token } = req.body;
  if (typeof token !== 'string' || !token.startsWith('bim:'))
    return sendeFehler(req, res, 400, 'token_ungueltig');
  try {
    // Atomar entwerten: Nur die erste Anfrage bekommt eine Zeile zurück, alle
    // weiteren laufen ins Leere — kein Race zwischen zwei Geräten möglich.
    const claimed = await db.get(
      `UPDATE qr_login_tokens SET used_at = NOW()
       WHERE token = $1 AND used_at IS NULL AND expires_at > NOW()
       RETURNING user_id`,
      [hashToken(token.slice(4))]
    );
    if (!claimed) return sendeFehler(req, res, 401, 'token_ungueltig');

    const user = await db.get('SELECT * FROM users WHERE id=$1', [claimed.user_id]);
    if (!user) return sendeFehler(req, res, 401, 'token_ungueltig');
    const blocked = assertLoginAllowed(user);
    if (blocked) return sendeFehler(req, res, blocked.status, blocked.code);

    await establishSession(req, {
      userId:   parseInt(user.id),
      username: user.username,
      isAdmin:  flaggeGesetzt(user.is_admin),
    });
    // Bearer-Token für die Android-App — dauerhaft, wie bei der Anmeldung
    // per Passwort aus der App. Dasselbe INSERT stand hier von Hand.
    const bearerToken = await createToken(user.id, 'qr-login', true);
    res.json({ success: true, token: bearerToken, username: user.username, isAdmin: flaggeGesetzt(user.is_admin), userId: user.id,
      user: { id: user.id, username: user.username } });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// ── GET /api/v1/auth/registration-status — public, no auth required ─────────────
router.get('/registration-status', async (_req, res) => {
  try {
    res.json({ enabled: await getGlobalSetting('registration_enabled') === '1' });
  } catch(_) { res.json({ enabled: false }); }
});

// ── POST /api/v1/auth/register ───────────────────────────────────────────────────
router.post('/register', ipThrottle('register', 5, 60 * 60 * 1000), async (req, res) => {
  const { username, email, first_name, last_name, password, language } = req.body;
  const lang = ['de', 'en'].includes(language) ? language : 'de';

  // Check if registration is enabled
  const regEnabled = await getGlobalSetting('registration_enabled');
  if (regEnabled === '0') return sendeFehler(req, res, 403, 'registrierung_deaktiviert');

  if (!username || !email || !password)
    return sendeFehler(req, res, 400, 'registrierung_felder');
  if (passwortZuKurz(password))
    return sendeFehler(req, res, 400, 'passwort_zu_kurz');
  // Dieselben Muster wie überall sonst (utils/auth.ts) — hier standen zwei
  // wortgleiche Kopien, und die E-Mail-Regex gab es damit dreimal im Projekt.
  //
  // Beim REGISTRIEREN gilt weiterhin nur das Benutzernamen-Muster: Sonst
  // könnte jemand die E-Mail-Adresse eines anderen als Benutzernamen eintragen
  // und dessen Anmeldung an sich ziehen — der Login sucht in beiden Spalten.
  if (!EMAIL_RE.test(email))
    return sendeFehler(req, res, 400, 'email_ungueltig');
  if (!USERNAME_RE.test(username))
    return sendeFehler(req, res, 400, 'benutzername_ungueltig');

  try {
    const existing = await db.get('SELECT id FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($2)', [username, email]);
    if (existing) return sendeFehler(req, res, 409, 'benutzername_oder_email_vergeben');

    const token  = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const hash   = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // verification_token wird — wie api_tokens — nur als SHA-256 gespeichert.
    // Vorher lag er im Klartext in der users-Tabelle; bei einem DB-Leak war
    // damit jeder ausstehende Bestätigungslink direkt einlösbar.
    await db.run(
      'INSERT INTO users (username, email, first_name, last_name, password_hash, is_admin, is_active, email_verified, verification_token, token_expires) VALUES ($1,$2,$3,$4,$5,0,1,0,$6,$7)',
      [username, email, first_name || null, last_name || null, hash, hashToken(token), expires]
    );
    // Gewählte Sprache als Benutzereinstellung speichern (steuert UI + E-Mails).
    // Hinweis: kein "INSERT … RETURNING" verwenden — die SQL-Kompatschicht hängt
    // an INSERTs ohne ON CONFLICT automatisch "ON CONFLICT DO NOTHING" an, was
    // nach einem RETURNING zu einem Syntaxfehler führen würde. Daher separater SELECT.
    const newUser = await db.get('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username]).catch(() => null);
    if (newUser?.id) {
      await db.run(
        "INSERT INTO user_settings (user_id, key, value) VALUES ($1,'language',$2) ON CONFLICT (user_id, key) DO UPDATE SET value=$2",
        [newUser.id, lang]
      // Ohne Protokoll bleibt unklar, warum ein frisch angelegtes Konto in der
      // falschen Sprache startet.
      ).catch(logAndContinue(`registrierung:sprache ${newUser.id}`));
    }

    const result = await sendVerificationMail(email, first_name || username, token, getBaseUrl(req), lang);

    res.json({
      success: true,
      message: result.mode === 'console'
        ? 'Konto erstellt. Da SMTP nicht konfiguriert ist, steht der Bestätigungslink in der Server-Konsole.'
        : 'Konto erstellt. Bitte bestätige deine E-Mail-Adresse.',
      email_sent: result.success,
      console_mode: result.mode === 'console',
    });
  } catch (e) {
    if (fehlerCode(e) === '23505') return sendeFehler(req, res, 409, 'benutzername_oder_email_vergeben');
    handleRouteError(res, e, undefined, req);
  }
});

// ── GET /api/v1/auth/verify ist ENTFERNT ────────────────────────────────────────
//
// Sie hatte keinen Aufrufer, und das stand seit Nachtrag 154 als Kommentar
// genau hier: „Gefahrlos umzustellen, weil die Route KEINEN Aufrufer hat: Der
// Link in der Verifikationsmail zeigt auf /verify (routes/mailer.ts), das
// Frontend ruft sie nicht auf und die Android-App auch nicht."
//
// Damals wurde ihre Antwortform berichtigt und sie stehengelassen. Das ist
// genau der Fall, den DeadCodeTest in der App beschreibt: Entweder fehlt die
// Anzeige dazu — oder sie ist nie gebraucht worden und blieb liegen. Hier das
// zweite: Die Bestaetigung laeuft ueber die Frontend-Seite /verify, die
// utils/auth.verifiziereEmailToken() aufruft. Diese Funktion bleibt.

// ── POST /api/v1/auth/forgot-password ───────────────────────────────────────────
router.post('/forgot-password', ipThrottle('forgot-password', 5, 60 * 60 * 1000), async (req, res) => {
  const { email } = req.body;
  if (!email) return sendeFehler(req, res, 400, 'email_erforderlich');
  try {
    // LOWER auf beiden Seiten wie an JEDER anderen E-Mail-Suche (Login,
    // Registrierung, Profil). Hier stand der einzige case-SENSITIVE Vergleich:
    // Wer sich als "Marco@Example.CH" registriert hatte und im Formular
    // "marco@example.ch" tippte, bekam "Falls die E-Mail existiert…" — und nie
    // eine Mail. Durch die Anti-Enumeration-Antwort war das von aussen nicht
    // von Erfolg zu unterscheiden; der Nutzer ist dauerhaft ausgesperrt.
    const user = await db.get('SELECT * FROM users WHERE LOWER(email) = LOWER($1) AND is_active = 1', [email]);
    // Always return success to prevent email enumeration
    if (!user) return res.json({ success: true, message: 'Falls die E-Mail existiert, wurde ein Link gesendet.' });

    const token   = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    // Nur der Hash in die DB — der Klartext geht ausschliesslich per Mail raus.
    await db.run('UPDATE users SET reset_token=$1, reset_token_expires=$2 WHERE id=$3', [hashToken(token), expires, user.id]);

    // NICHT awaiten: Die Antwort ist in beiden Fällen wortgleich, aber das
    // await machte sie messbar ungleich SCHNELL — bei unbekannter E-Mail kam
    // sie sofort, bei bekannter erst nach dem SMTP-Versand (bis zu ~10 s laut
    // den Timeouts in getTransporter). Damit liess sich trotz der neutralen
    // Meldung über die Antwortzeit prüfen, welche Adressen ein Konto haben.
    // Die Antwort hängt inhaltlich nicht vom Versandergebnis ab (sendMail
    // fängt Fehler selbst und loggt sie) — es gibt keinen Grund zu warten.
    sendPasswordResetMail(email, user.first_name || user.username, token, getBaseUrl(req))
      .catch((e: any) => console.error('[forgot-password] Mailversand fehlgeschlagen:', e?.message));

    res.json({ success: true, message: 'Falls die E-Mail existiert, wurde ein Link gesendet.' });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// ── POST /api/v1/auth/reset-password ────────────────────────────────────────────
router.post('/reset-password', ipThrottle('reset-password', 10, 60 * 60 * 1000), async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return sendeFehler(req, res, 400, 'token_passwort_erforderlich');
  if (passwortZuKurz(password)) return sendeFehler(req, res, 400, 'passwort_zu_kurz');
  try {
    const user = await db.get(
      "SELECT id FROM users WHERE reset_token = $1 AND reset_token_expires > NOW()",
      [hashToken(token)]
    );
    if (!user) return sendeFehler(req, res, 400, 'token_ungueltig');
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await db.run('UPDATE users SET password_hash=$1, reset_token=NULL, reset_token_expires=NULL WHERE id=$2', [hash, user.id]);
    // Ein Reset ist der Moment, in dem man einen fremden Zugang loswerden will.
    // Ohne das Folgende überlebt er ihn: Bearer-Tokens laufen sieben Tage weiter
    // und die Session-Zeile in user_sessions bleibt ebenfalls gültig.
    await revokeAllTokens(user.id);
    await revokeAllSessions(user.id);
    res.json({ success: true, message: 'Passwort erfolgreich geändert.' });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// ── GET /api/v1/auth/check-token ist ENTFERNT ───────────────────────────────────
//
// Sie sagte, ob ein Reset- oder Verifikations-Token noch gilt. Kein Aufrufer:
// Die Reset-Seite schickt das neue Passwort direkt und wertet die Antwort aus,
// statt vorher zu fragen. Nachgemessen ueber alle 169 Dateien beider Apps —
// weder Webapp noch Android nennen sie.


// CJS-kompatibler Export: module.exports bleibt der Router selbst,
// mit den intern/von jobs/ genutzten Funktionen als Properties (wie zuvor).
export = Object.assign(router, { requireLogin, requireAdmin });
