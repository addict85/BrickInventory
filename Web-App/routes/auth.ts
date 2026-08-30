
import express from 'express';
const router  = express.Router();
import bcrypt from 'bcryptjs';
import * as db from '../db/database';
import { handleRouteError, logAndContinue, meldeUndWeiter } from '../utils/httpError';
import { hashToken, verifiziereEmailToken, assertLoginAllowed, establishSession, revokeAllTokens, revokeAllSessions, deleteToken, BCRYPT_ROUNDS, USERNAME_RE, EMAIL_RE, isValidLoginIdentifier } from '../utils/auth';
import { checkLoginAllowed, recordLoginFailure, recordLoginSuccess, ipThrottle } from '../utils/loginLimiter';
import crypto from 'crypto';
import { strictBool } from '../utils/validate';
import { sendPasswordResetMail, sendVerificationMail } from './mailer';
import type { Request, Response, NextFunction } from 'express';

/**
 * Fester bcrypt-Hash für Logins mit unbekanntem Benutzernamen.
 *
 * Der Klartext dazu ist bedeutungslos — der Hash wird nur benutzt, damit
 * bcrypt.compare() im Fehlerfall dieselbe Zeit verbraucht wie bei einem
 * existierenden Konto (siehe POST /login). Einmal beim Start erzeugt, mit
 * denselben Runden wie echte Passwörter.
 */
const DUMMY_HASH = bcrypt.hashSync('nonexistent-account-placeholder', BCRYPT_ROUNDS);

function requireLogin(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) return res.status(401).json({ success: false, error: 'Nicht angemeldet' });
  next();
}
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) return res.status(401).json({ success: false, error: 'Nicht angemeldet' });
  if (!req.session?.isAdmin && req.session?.isAdmin !== true) return res.status(403).json({ success: false, error: 'Nur Admins' });
  next();
}

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, error: 'Benutzername und Passwort erforderlich' });
  // Benutzername ODER E-Mail — so steht es über dem Feld, und so sucht die
  // Abfrage unten. Der Wächter liess vorher nur das Benutzernamen-Muster zu.
  if (!isValidLoginIdentifier(username))
    return res.status(400).json({ success: false, error: 'Bitte Benutzername oder E-Mail-Adresse eingeben.' });
  // Brute-Force-Schutz: max. 5 Fehlversuche pro IP+Username, dann 15 Min Sperre
  const locked = await checkLoginAllowed(req, username);
  if (locked) return res.status(429).json({ success: false, error: locked });
  try {
    const user = await db.get('SELECT * FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1)', [username]);
    // bcrypt.compare (async) statt compareSync — blockiert den Event-Loop nicht (~100ms/Login)
    //
    // Auch bei UNBEKANNTEM Benutzernamen wird gehasht. Vorher sprang der Code
    // bei `!user` sofort zur Fehlerantwort — ohne die ~100 ms bcrypt. Der
    // Laufzeitunterschied zwischen "Benutzer existiert nicht" (schnell) und
    // "Passwort falsch" (langsam) ist von aussen sauber messbar und verrät,
    // welche Konten es gibt. Der Vergleich gegen einen festen Dummy-Hash
    // kostet dieselbe Zeit und macht beide Fälle ununterscheidbar.
    const compareTarget = user?.password_hash || DUMMY_HASH;
    const passwordOk = await bcrypt.compare(password, compareTarget);
    if (!user || !passwordOk) {
      await recordLoginFailure(req, username);
      return res.status(401).json({ success: false, error: 'Ungültige Anmeldedaten' });
    }
    await recordLoginSuccess(req, username);
    // Vorbedingungen zentral (utils/auth.ts) — identisch im v1-Login
    const blocked = assertLoginAllowed(user);
    if (blocked) return res.status(blocked.status).json({ success: false, error: blocked.error, ...(blocked.unverified ? { unverified: true } : {}) });
    // Session-ID erneuern (gegen Session Fixation) und erst dann füllen.
    await establishSession(req, {
      userId:   parseInt(user.id),   // always int
      username: user.username,
      isAdmin:  user.is_admin == 1 || user.is_admin === true,
    });
    // Web-Token, damit andere Tabs den CSV-Status per Bearer abfragen können.
    //
    // Scheitert das INSERT, wird der Token NICHT mitgeschickt. Vorher stand
    // hier .catch(() => {}) — die Anmeldung galt als erfolgreich, der Client
    // legte einen Token in den sessionStorage, den die Datenbank nie gesehen
    // hatte, und der SSE-Kanal (`?token=…`, EventSource kann keine Header
    // setzen) lief in ein 401. Ohne Token fällt der Client auf die
    // Cookie-Session zurück — der Weg funktioniert ohnehin und ist genau der
    // für Alt-Clients vorgesehene.
    let webToken: string | null = crypto.randomBytes(24).toString('hex');
    try {
      await db.run(
        "INSERT INTO api_tokens (token, user_id, label, expires_at) VALUES ($1,$2,'webapp-session', NOW() + INTERVAL '7 days') ON CONFLICT DO NOTHING",
        [hashToken(webToken), user.id]  // DB speichert nur den Hash
      );
    } catch (e) {
      console.warn('[login] Web-Token konnte nicht gespeichert werden, Anmeldung läuft über die Session:', e?.message || e);
      webToken = null;
    }
    res.json({ success: true, ...(webToken ? { webToken } : {}), user: { id: user.id, username: user.username, isAdmin: req.session.isAdmin,
      // Nur beim automatisch generierten Default-Admin-Passwort gesetzt (siehe
      // db/database.ts) — Frontend kann das nutzen, um zur Passwortänderung
      // aufzufordern. Wird durch POST /change-password wieder gelöscht.
      mustChangePassword: !!(user.must_change_password === 1 || user.must_change_password === true) } });
  } catch (e) { handleRouteError(res, e); }
});

router.post('/logout', async (req, res) => {
  // Den beim Login ausgegebenen webToken mit entwerten.
  //
  // Vorher blieb er nach dem Abmelden volle sieben Tage gültig. Er liegt im
  // sessionStorage des Browsers, ist also per XSS auslesbar — ein Token, das
  // eine bewusste Abmeldung überlebt, ist genau das, was man dabei nicht will.
  // Der Client schickt ihn im Authorization-Header mit; fehlt er, wird nur die
  // Session zerstört (unverändertes Verhalten für Alt-Clients).
  const auth = String(req.headers.authorization || '');
  // Fehler hier nur loggen: Die Abmeldung darf nicht daran scheitern, dass der
  // Token nicht entsorgt werden konnte — aber schweigend übergangen hiess, dass
  // genau der Fall unbemerkt bleibt, den der Absatz oben verhindern soll (ein
  // Token, der die bewusste Abmeldung überlebt).
  if (auth.startsWith('Bearer ')) await deleteToken(auth.slice(7)).catch(logAndContinue('logout:token entsorgen'));
  req.session.destroy(() => res.json({ success: true }));
});

router.get('/me', async (req, res) => {
  if (!req.session?.userId) return res.json({ loggedIn: false });
  try {
    const user = await db.get('SELECT id, username, is_admin FROM users WHERE id = $1', [req.session.userId]);
    if (!user) return res.json({ loggedIn: false });
    res.json({ loggedIn: true, id: user.id, username: user.username, isAdmin: user.is_admin == 1 || user.is_admin === true });
  } catch (e) { res.json({ loggedIn: false }); }
});

// GET /api/auth/profile — get current user profile
router.get('/profile', async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ success: false });
  try {
    const user = await db.get(
      'SELECT id, username, email, first_name, last_name, email_verified FROM users WHERE id=$1',
      [req.session.userId]
    );
    if (!user) return res.status(404).json({ success: false });
    res.json({ success: true, user });
  } catch (e) { handleRouteError(res, e); }
});

// PUT /api/auth/profile — update current user profile
router.put('/profile', async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ success: false });
  const { username, email, first_name, last_name, password, password_current } = req.body;
  try {
    const user = await db.get('SELECT * FROM users WHERE id=$1', [req.session.userId]);
    if (!user) return res.status(404).json({ success: false });

    // If changing password, verify current password
    if (password) {
      if (!password_current) return res.status(400).json({ success: false, error: 'Aktuelles Passwort erforderlich' });
      const valid = await bcrypt.compare(password_current, user.password_hash);
      if (!valid) return res.status(400).json({ success: false, error: 'Aktuelles Passwort falsch' });
    }

    // Benutzername: dieselbe Regex wie Login/Register — das Profil-Update hat
    // sie vorher NICHT erzwungen. Ohne sie konnte man Leerzeichen setzen oder
    // (schlimmer) die E-Mail-Adresse eines anderen Nutzers als Benutzernamen
    // eintragen, weil der Login "username ODER email" case-insensitiv sucht.
    if (username !== undefined && !USERNAME_RE.test(String(username || '')))
      return res.status(400).json({ success: false, error: 'Benutzername darf nur Buchstaben, Zahlen und _.- enthalten (3–32 Zeichen).' });

    // Eindeutigkeit case-INsensitiv prüfen (der Login vergleicht mit LOWER()) —
    // vorher konnten "Marco" und "marco" nebeneinander existieren und welcher
    // beim Login trifft, war ohne ORDER BY undefiniert. Zusätzlich wird gegen
    // die E-Mail-Spalte geprüft, weil der Login beide Felder akzeptiert.
    if (username && username.toLowerCase() !== String(user.username || '').toLowerCase()) {
      const existing = await db.get(
        'SELECT id FROM users WHERE (LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1)) AND id != $2',
        [username, user.id]);
      if (existing) return res.status(400).json({ success: false, error: 'Benutzername bereits vergeben' });
    }

    // Check email uniqueness
    const emailChanged = email && email.toLowerCase() !== String(user.email || '').toLowerCase();
    if (emailChanged) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return res.status(400).json({ success: false, error: 'Ungültige E-Mail-Adresse.' });
      const existing = await db.get(
        'SELECT id FROM users WHERE (LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($1)) AND id != $2',
        [email, user.id]);
      if (existing) return res.status(400).json({ success: false, error: 'E-Mail bereits vergeben' });
    }

    // Build update
    const updates: any[] = [];
    const params: any[] = [];
    let pi = 1;
    if (username)    { updates.push(`username=$${pi++}`);   params.push(username); }
    if (first_name !== undefined) { updates.push(`first_name=$${pi++}`); params.push(first_name || null); }
    if (last_name  !== undefined) { updates.push(`last_name=$${pi++}`);  params.push(last_name  || null); }
    if (password) {
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
  } catch (e) { handleRouteError(res, e); }
});

// Admin: list users
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const users = await db.all('SELECT id, username, is_admin, created_at FROM users ORDER BY id');
    res.json({ success: true, users });
  } catch (e) { handleRouteError(res, e); }
});

// Admin: create user
router.post('/users', requireAdmin, async (req, res) => {
  const { username, password, isAdmin = false } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, error: 'Benutzername und Passwort erforderlich' });
  if (!USERNAME_RE.test(String(username)))
    return res.status(400).json({ success: false, error: 'Benutzername darf nur Buchstaben, Zahlen und _.- enthalten (3–32 Zeichen).' });
  if (String(password).length < 8)
    return res.status(400).json({ success: false, error: 'Passwort muss mindestens 8 Zeichen lang sein.' });
  try {
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const r = await db.run('INSERT INTO users (username, password_hash, is_admin) VALUES ($1, $2, $3)',
      [username, hash, isAdmin ? 1 : 0]);
    // Sicherheitsnetz: r.changes === 0 hiesse, das INSERT wurde verschluckt
    // (früher hat die SQL-Kompatschicht genau das global getan und dieser
    //  Endpoint meldete success:true, ohne einen Nutzer anzulegen).
    if (r.changes === 0) return res.status(409).json({ success: false, error: 'Benutzername bereits vergeben' });
    res.json({ success: true });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ success: false, error: 'Benutzername bereits vergeben' });
    handleRouteError(res, e);
  }
});

// Admin: toggle admin role
router.put('/users/:id/admin', requireAdmin, async (req, res) => {
  const targetId = parseInt(req.params.id);
  try {
    // Dieselbe strenge Prüfung wie auf der v1-Route — die Zeichenkette "false"
    // ist in JavaScript wahr und meldete hier Erfolg, ohne Rechte zu entziehen.
    const soll = strictBool(req.body.is_admin, 'is_admin');
    if (targetId === req.session.userId && !soll)
      return res.status(400).json({ success: false, error: 'Eigene Admin-Rolle kann nicht entfernt werden' });
    const r = await db.run('UPDATE users SET is_admin = $1 WHERE id = $2', [soll ? 1 : 0, targetId]);
    if (r.changes === 0) return res.status(404).json({ success: false, error: 'Benutzer nicht gefunden' });
    res.json({ success: true });
  } catch (e) { handleRouteError(res, e); }
});

// Admin: delete user
/**
 * PUT /api/auth/users/:id/password — Passwort eines anderen Nutzers setzen.
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
  const targetId = parseInt(req.params.id);

  if (!password || String(password).length < 8)
    return res.status(400).json({ success: false, error: 'Passwort muss mindestens 8 Zeichen lang sein.' });
  if (!targetId || targetId === Number(req.session.userId))
    return res.status(400).json({ success: false, error: 'Für das eigene Konto bitte „Passwort ändern" benutzen.' });

  try {
    const hash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
    const r = await db.run('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, targetId]);
    if (!r.changes) return res.status(404).json({ success: false, error: 'Benutzer nicht gefunden' });

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
  } catch (e) { handleRouteError(res, e); }
});

router.delete('/users/:id', requireAdmin, async (req, res) => {
  try {
    const r = await db.run('DELETE FROM users WHERE id = $1 AND id != $2',
      [req.params.id, req.session.userId]);
    if (r.changes === 0) return res.status(404).json({ success: false, error: 'Benutzer nicht gefunden oder eigener Account' });
    res.json({ success: true });
  } catch (e) { handleRouteError(res, e); }
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
  if (!current || !newPassword) return res.status(400).json({ success: false, error: 'Alle Felder erforderlich' });
  try {
    const user = await db.get('SELECT * FROM users WHERE id = $1', [req.session.userId]);
    if (!(await bcrypt.compare(current, user.password_hash)))
      return res.status(401).json({ success: false, error: 'Aktuelles Passwort falsch' });
    const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    // must_change_password mit löschen — sonst fragt der Login nach jedem
    // Login des Default-Admins weiter danach, auch nach der Änderung.
    await db.run('UPDATE users SET password_hash = $1, must_change_password = 0 WHERE id = $2', [hash, req.session.userId]);
    // Alle Bearer-Tokens des Kontos verwerfen — siehe revokeAllTokens().
    await revokeAllTokens(req.session.userId);
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
    const _self = { userId: req.session.userId, username: req.session.username, isAdmin: req.session.isAdmin };
    await revokeAllSessions(_self.userId);
    await establishSession(req, _self);
    res.json({ success: true });
  } catch (e) { handleRouteError(res, e); }
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

async function ensureQrTable() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS qr_login_tokens (
      token      TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at    TIMESTAMPTZ
    )
  `);
}

// POST /api/auth/qr-token — Nonce erzeugen (nur für die eigene Session)
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
router.post('/qr-token', async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ success: false });
  try {
    await ensureQrTable();
    // Abgelaufene/verbrauchte Nonces mitentsorgen — die Tabelle bleibt so klein.
    await db.run(`DELETE FROM qr_login_tokens WHERE expires_at < NOW() - INTERVAL '1 hour'`)
      .catch(logAndContinue('qr-token:aufräumen'));
    const nonce = crypto.randomBytes(32).toString('base64url');
    await db.run(
      'INSERT INTO qr_login_tokens (token, user_id, expires_at) VALUES ($1,$2,$3)',
      [hashToken(nonce), req.session.userId, new Date(Date.now() + QR_TTL_MS)]
    );
    res.json({ success: true, token: `bim:${nonce}`, expires_in: QR_TTL_MS / 1000 });
  } catch (e) { handleRouteError(res, e); }
});

// POST /api/auth/qr-login — Nonce einlösen
//
// ipThrottle wie bei register/forgot/reset: Der Endpunkt schreibt ohne
// Anmeldung in die Datenbank. Die 32-Byte-Nonce ist nicht zu erraten, aber es
// gab keinen Grund, ausgerechnet hier auf die Drossel zu verzichten — 30
// Versuche pro Stunde reichen für jeden echten Anmeldevorgang.
router.post('/qr-login', ipThrottle('qr-login', 30, 60 * 60 * 1000), async (req, res) => {
  const { token } = req.body;
  if (typeof token !== 'string' || !token.startsWith('bim:'))
    return res.status(400).json({ success: false, error: 'Ungültiger Token' });
  try {
    await ensureQrTable();
    // Atomar entwerten: Nur die erste Anfrage bekommt eine Zeile zurück, alle
    // weiteren laufen ins Leere — kein Race zwischen zwei Geräten möglich.
    const claimed = await db.get(
      `UPDATE qr_login_tokens SET used_at = NOW()
       WHERE token = $1 AND used_at IS NULL AND expires_at > NOW()
       RETURNING user_id`,
      [hashToken(token.slice(4))]
    );
    if (!claimed) return res.status(401).json({ success: false, error: 'Ungültiger oder abgelaufener Token' });

    const user = await db.get('SELECT * FROM users WHERE id=$1', [claimed.user_id]);
    if (!user) return res.status(401).json({ success: false, error: 'Ungültiger Token' });
    const blocked = assertLoginAllowed(user);
    if (blocked) return res.status(blocked.status).json({ success: false, error: blocked.error });

    await establishSession(req, {
      userId:   parseInt(user.id),
      username: user.username,
      isAdmin:  !!user.is_admin,
    });
    // Bearer-Token für die Android-App (DB speichert nur den Hash)
    const bearerToken = crypto.randomBytes(32).toString('hex');
    await db.run(
      "INSERT INTO api_tokens (token, user_id, label, expires_at) VALUES ($1,$2,'qr-login',NULL)",
      [hashToken(bearerToken), user.id]
    );
    res.json({ success: true, token: bearerToken, username: user.username, isAdmin: !!user.is_admin, userId: user.id,
      user: { id: user.id, username: user.username } });
  } catch (e) { handleRouteError(res, e); }
});

// ── GET /api/auth/registration-status — public, no auth required ─────────────
router.get('/registration-status', async (req, res) => {
  try {
    const row = await db.get("SELECT value FROM global_settings WHERE key='registration_enabled'");
    res.json({ enabled: row?.value === '1' });
  } catch(_) { res.json({ enabled: false }); }
});

// ── POST /api/auth/register ───────────────────────────────────────────────────
router.post('/register', ipThrottle('register', 5, 60 * 60 * 1000), async (req, res) => {
  const { username, email, first_name, last_name, password, language } = req.body;
  const lang = ['de', 'en'].includes(language) ? language : 'de';

  // Check if registration is enabled
  const regEnabled = (await db.get("SELECT value FROM global_settings WHERE key='registration_enabled'"))?.value;
  if (regEnabled === '0') return res.status(403).json({ success: false, error: 'Registrierung ist deaktiviert.' });

  if (!username || !email || !password)
    return res.status(400).json({ success: false, error: 'Benutzername, E-Mail und Passwort sind erforderlich.' });
  if (password.length < 8)
    return res.status(400).json({ success: false, error: 'Passwort muss mindestens 8 Zeichen lang sein.' });
  // Dieselben Muster wie überall sonst (utils/auth.ts) — hier standen zwei
  // wortgleiche Kopien, und die E-Mail-Regex gab es damit dreimal im Projekt.
  //
  // Beim REGISTRIEREN gilt weiterhin nur das Benutzernamen-Muster: Sonst
  // könnte jemand die E-Mail-Adresse eines anderen als Benutzernamen eintragen
  // und dessen Anmeldung an sich ziehen — der Login sucht in beiden Spalten.
  if (!EMAIL_RE.test(email))
    return res.status(400).json({ success: false, error: 'Ungültige E-Mail-Adresse.' });
  if (!USERNAME_RE.test(username))
    return res.status(400).json({ success: false, error: 'Benutzername darf nur Buchstaben, Zahlen und _.- enthalten (3–32 Zeichen).' });

  try {
    const existing = await db.get('SELECT id FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($2)', [username, email]);
    if (existing) return res.status(409).json({ success: false, error: 'Benutzername oder E-Mail bereits vergeben.' });

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
      ).catch(() => {});
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
    if (e.code === '23505') return res.status(409).json({ success: false, error: 'Benutzername oder E-Mail bereits vergeben.' });
    handleRouteError(res, e);
  }
});

// ── GET /api/auth/verify?token=... ────────────────────────────────────────────
router.get('/verify', async (req, res) => {
  // Die Logik steht seit Nachtrag 154 in utils/auth.verifiziereEmailToken() —
  // vorher wortgleich hier UND in server.ts.
  //
  // ── Antwortform berichtigt (Nachtrag 154) ─────────────────────────────────
  // Diese Route hat vorher auf dem Erfolgs- und dem Ungültig-Pfad
  // `res.redirect('/?verified=…')` geschickt und nur bei fehlendem Token JSON.
  // Eine Route unter /api, die mit 302 auf eine HTML-Seite verweist, ist für
  // jeden Programm-Aufrufer unbrauchbar: fetch() folgt der Weiterleitung und
  // bekommt die ~189 KB index.html statt einer Antwort — dieselbe Falle, die
  // weiter unten schon einmal als 404-Regel für /api behoben wurde.
  //
  // Gefahrlos umzustellen, weil die Route KEINEN Aufrufer hat: Der Link in der
  // Verifikationsmail zeigt auf /verify (routes/mailer.ts), das Frontend ruft
  // sie nicht auf und die Android-App auch nicht. Wer sie künftig benutzt,
  // bekommt jetzt das, was eine API liefern muss.
  try {
    const e = await verifiziereEmailToken(req.query.token);
    if (e.ok) return res.json({ success: true });
    return res.status(e.grund === 'fehlt' ? 400 : 410).json({
      success: false,
      error: e.grund === 'fehlt' ? 'Token fehlt.' : 'Token ungültig oder abgelaufen.',
    });
  } catch (e) { handleRouteError(res, e); }
});

// ── POST /api/auth/forgot-password ───────────────────────────────────────────
router.post('/forgot-password', ipThrottle('forgot-password', 5, 60 * 60 * 1000), async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, error: 'E-Mail erforderlich.' });
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
  } catch (e) { handleRouteError(res, e); }
});

// ── POST /api/auth/reset-password ────────────────────────────────────────────
router.post('/reset-password', ipThrottle('reset-password', 10, 60 * 60 * 1000), async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ success: false, error: 'Token und Passwort erforderlich.' });
  if (password.length < 8) return res.status(400).json({ success: false, error: 'Passwort muss mindestens 8 Zeichen lang sein.' });
  try {
    const user = await db.get(
      "SELECT id FROM users WHERE reset_token = $1 AND reset_token_expires > NOW()",
      [hashToken(token)]
    );
    if (!user) return res.status(400).json({ success: false, error: 'Ungültiger oder abgelaufener Token.' });
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await db.run('UPDATE users SET password_hash=$1, reset_token=NULL, reset_token_expires=NULL WHERE id=$2', [hash, user.id]);
    // Ein Reset ist der Moment, in dem man einen fremden Zugang loswerden will.
    // Ohne das Folgende überlebt er ihn: Bearer-Tokens laufen sieben Tage weiter
    // und die Session-Zeile in user_sessions bleibt ebenfalls gültig.
    await revokeAllTokens(user.id);
    await revokeAllSessions(user.id);
    res.json({ success: true, message: 'Passwort erfolgreich geändert.' });
  } catch (e) { handleRouteError(res, e); }
});

// ── GET /api/auth/check-token ─────────────────────────────────────────────────
router.get('/check-token', ipThrottle('check-token', 30, 60 * 60 * 1000), async (req, res) => {
  const { token, type } = req.query;
  if (!token) return res.json({ valid: false });
  try {
    if (type === 'reset') {
      const u = await db.get("SELECT id FROM users WHERE reset_token=$1 AND reset_token_expires > NOW()", [hashToken(String(token))]);
      return res.json({ valid: !!u });
    }
    const u = await db.get("SELECT id FROM users WHERE verification_token=$1 AND token_expires > NOW()", [hashToken(String(token))]);
    res.json({ valid: !!u });
  } catch (_) { res.json({ valid: false }); }
});

// CJS-kompatibler Export: module.exports bleibt der Router selbst,
// mit den intern/von jobs/ genutzten Funktionen als Properties (wie zuvor).
export = Object.assign(router, { requireLogin, requireAdmin });
