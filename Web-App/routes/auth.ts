
import { protokolliere } from '../utils/verwaltungsprotokoll';
import express from 'express';
const router  = express.Router();
import bcrypt from 'bcryptjs';
import * as K from '../utils/konten';
import { meldeHaushaltsaenderung } from '../utils/household';
import { handleRouteError, logAndContinue, meldeUndWeiter, fehlerCode, fehlertext, pfadParam } from '../utils/httpError';
import { hashToken, pruefeAnmeldedaten, createToken, validateToken, assertLoginAllowed, establishSession, revokeAllTokens, revokeAllSessions, beendeAndereZugaenge, deleteToken, BCRYPT_ROUNDS, USERNAME_RE, EMAIL_RE, requireLoginOrToken, nutzerId, angemeldeteNutzerId, appTokenOhneAblauf, passwortZuKurz, flaggeGesetzt, leereTokenCache, laufzeitTage } from '../utils/auth';
import { ipThrottle, bestaetigungGesperrt, bestaetigungFehlgeschlagen, bestaetigungGelungen } from '../utils/loginLimiter';
import { bestaetigePasswort } from '../utils/passwortBestaetigung';
import crypto from 'crypto';
import { strictBool } from '../utils/validate';
import { sendEmailGeaendertMail, sendPasswordResetMail, sendVerificationMail } from '../utils/mailer';
import type { Request, Response } from 'express';
import { getGlobalSetting, getSetting, setUserSetting } from '../utils/settings';
import { requireApiAdmin } from './api_v1/middleware';
import { sendeFehler, fehlerText, antwortSprache } from '../utils/fehlerTexte';
import { basisUrl, hinweisOhneBasisUrl } from '../utils/basisUrl';
import * as zf from '../utils/zweiterFaktor';

// „Angemeldet" gibt es nur noch in EINER Fassung
// Sechs vermeintlich fehlende Funktionen, EINE Ursache: dieselbe Regel in zwei
// Schreibweisen, und die App konnte nur die eine erfuellen. server.ts sagt an
// der Stelle, wo diese Router eingehaengt werden, seit jeher voraus, was zu tun …
// Ausführlich: docs/begruendungen/routes/auth.ts.md#requirelogin
const requireLogin = requireLoginOrToken;
const requireAdmin = requireApiAdmin;

/** Längstes Token-Label: Es steht in der Geräteliste, ein Name passt bequem hinein. */
const LABEL_MAX = 100;

/**
 * Das Label eines neuen Tokens aus der Anfrage. Ohne Grenze legte jede
 * Anmeldung beliebig lange Zeilen in api_tokens ab, und die Geräteliste zeigte
 * sie ungekürzt; Nicht-Text (Objekt, Liste) fällt auf die Vorgabe zurück.
 */
function tokenLabel(roh: unknown, vorgabe: string): string {
  const text = typeof roh === 'string' ? roh.trim() : '';
  return text ? Array.from(text).slice(0, LABEL_MAX).join('') : vorgabe;
}

/**
 * POST /api/v1/auth/login — die EINE Anmeldung, fuer Webapp und App.
 * Ausführlich: docs/begruendungen/routes/auth.ts.md#post-login
 */
router.post('/login', async (req, res) => {
  const { username, password, label, never_expires, code: zweiterCode, ohne_token } = req.body;
  try {
    // Form des Namens, Brute-Force-Sperre, Passwortvergleich, die
    // Konto-Vorbedingungen und der zweite Faktor stehen in utils/auth.ts.
    const pruefung = await pruefeAnmeldedaten(req, username, password, zweiterCode);
    if (!pruefung.ok) {
      const { status, code, vars, unverified, zweiterFaktor } = pruefung.absage;
      // `zweiter_faktor` sagt dem Client: Codefeld zeigen und erneut senden.
      if (zweiterFaktor) {
        return res.status(status).json({
          success: false, code, zweiter_faktor: true,
          error: fehlerText(code, antwortSprache(req), vars),
        });
      }
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
    // Die Webapp arbeitet nur mit dem httpOnly-Cookie: Ein Token im Browser
    // wäre per eingeschleustem Skript auslesbar und gälte über die Sitzung hinaus.
    if (ohne_token !== true) try {
      token = await createToken(user.id, tokenLabel(label, 'webapp-session'), dauerhaft);
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
 * Ausführlich: docs/begruendungen/routes/auth.ts.md#post-logout
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
 * Ausführlich: docs/begruendungen/routes/auth.ts.md#get-me
 */
router.get('/me', async (req, res) => {
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  try {
    if (req.session?.userId) {
      const user = await K.kontoKurz(req.session.userId);
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
 * Nur aus einer Sitzung und mit dem Passwort: Sonst koennte sich ein erbeuteter
 * Token beliebig viele dauerhafte Nachfolger praegen, die einen Passwortwechsel
 * ueberleben muessten. Keiner der beiden Clients ruft das heute auf.
 */
router.post('/token-create', requireLogin, async (req, res) => {
  try {
    if (!req.session?.userId) return sendeFehler(req, res, 403, 'nur_mit_sitzung');
    const userId = angemeldeteNutzerId(req);
    if (!await bestaetigePasswort(req, res, userId, req.body?.password)) return;
    const label = tokenLabel(req.body?.label, 'Android App');
    const neu = await createToken(userId, label, true);
    res.json({ success: true, token: neu, label, never_expires: appTokenOhneAblauf() });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// GET /api/v1/auth/profile — get current user profile
router.get('/profile', requireLogin, async (req, res) => {
  try {
    const user = await K.profil(nutzerId(req)!);
    if (!user) return res.status(404).json({ success: false });
    res.json({ success: true, user });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// PUT /api/v1/auth/profile — update current user profile
router.put('/profile', requireLogin, async (req, res) => {
  const { username, email, first_name, last_name, password, password_current } = req.body;
  try {
    const user = await K.kontoVoll(nutzerId(req)!);
    if (!user) return res.status(404).json({ success: false });

    // Das Passwort nur über /change-password: Nur dort werden danach alle
    // übrigen Sitzungen und Token verworfen.
    if (password) return sendeFehler(req, res, 400, 'passwort_ueber_change_password');

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
      if (await K.nameVergeben(username, user.id)) return sendeFehler(req, res, 400, 'benutzername_vergeben');
    }

    // Check email uniqueness
    const emailChanged = email && email.toLowerCase() !== String(user.email || '').toLowerCase();
    if (emailChanged) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return sendeFehler(req, res, 400, 'email_ungueltig');
      if (await K.emailVergeben(email, user.id)) return sendeFehler(req, res, 400, 'email_vergeben');
      // Über die neue Adresse liesse sich danach das Passwort zurücksetzen —
      // wer kurz eine fremde Sitzung hat, übernähme so das Konto.
      if (!password_current) return sendeFehler(req, res, 400, 'aktuelles_passwort_erforderlich');
      if (!await bestaetigePasswort(req, res, user.id, String(password_current))) return;
    }

    const felder: Record<string, unknown> = {};
    if (username) felder.username = username;
    if (first_name !== undefined) felder.first_name = first_name || null;
    if (last_name  !== undefined) felder.last_name  = last_name  || null;
    if (emailChanged) {
      const token   = crypto.randomBytes(32).toString('hex');
      felder.email = email;
      felder.email_verified = user.is_admin ? 1 : 0;
      // Nur der Hash landet in der DB — der Klartext geht ausschliesslich per Mail raus
      felder.verification_token = hashToken(token);
      felder.token_expires = new Date(Date.now() + 24*60*60*1000);
      await K.aendereProfil(user.id, felder);
      // Send verification mail to new email
      // Ausführlich: docs/begruendungen/routes/auth.ts.md#put-profile-emailsent
      let emailSent = false;
      const lang = String(await getSetting(user.id, 'language', 'de').catch(() => 'de'));
      const basis = getBaseUrl(req);
      try {
        if (basis) emailSent = (await sendVerificationMail(email, first_name || username || user.username,
                                                           token, basis, lang)).success;
      } catch (e) { meldeUndWeiter('anmeldung:bestaetigungsmail', e); }
      // Die alte Adresse erfährt davon — war es nicht der Inhaber, merkt er es so.
      if (user.email) await sendEmailGeaendertMail(user.email, user.username, email, lang)
        .catch((e: unknown) => meldeUndWeiter('anmeldung:hinweis-alte-adresse', e));
      return res.json({ success: true, emailChanged: true, emailSent });
    }

    await K.aendereProfil(user.id, felder);
    res.json({ success: true });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// Admin: list users
router.get('/users', requireAdmin, async (_req, res) => {
  try {
    const users = await K.kontenListe();
    res.json({ success: true, users });
  } catch (e) { handleRouteError(res, e, undefined, _req); }
});

// Admin: create user
router.post('/users', requireAdmin, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return sendeFehler(req, res, 400, 'benutzername_passwort');
  if (!USERNAME_RE.test(String(username)))
    return sendeFehler(req, res, 400, 'benutzername_ungueltig');
  if (passwortZuKurz(password))
    return sendeFehler(req, res, 400, 'passwort_zu_kurz');
  try {
    // Streng wie bei PUT /users/:id/admin: Die Zeichenkette "false" ist in
    // JavaScript wahr und legte einen Verwalter an. Die Weboberfläche schickt
    // is_admin; isAdmin bleibt für ältere Aufrufer lesbar.
    const roh = req.body.is_admin ?? req.body.isAdmin;
    const alsVerwalter = roh === undefined ? false : strictBool(roh, 'is_admin');
    // Wie jede andere Verwalteraktion an fremden Konten: Passwort bestätigen
    // und protokollieren — eine erbeutete Sitzung soll keinen Verwalter anlegen.
    const verwalter = angemeldeteNutzerId(req);
    if (!await bestaetigePasswort(req, res, verwalter, req.body?.admin_password)) return;
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const neu = await K.legeKontoAn(username, hash, alsVerwalter);
    if (neu === null) return sendeFehler(req, res, 409, 'benutzername_vergeben');
    await protokolliere(verwalter, neu, 'konto_angelegt');
    if (alsVerwalter) await protokolliere(verwalter, neu, 'verwalter_ernannt');
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
    // Ausführlich: docs/begruendungen/routes/auth.ts.md#put-users-id-admin-vorher
    const vorher = await K.verwalterVorher(targetId);
    if (!vorher) return sendeFehler(req, res, 404, 'benutzer_nicht_gefunden');
    if (!await bestaetigePasswort(req, res, angemeldeteNutzerId(req), req.body?.admin_password)) return;
    const warAdmin = flaggeGesetzt(vorher.is_admin);
    await K.setzeVerwalter(targetId, soll);
    if (warAdmin !== soll) await protokolliere(angemeldeteNutzerId(req), targetId, soll ? 'verwalter_ernannt' : 'verwalter_entzogen');

    // Warum die Sitzungen enden muessen
    // istVerwalter() (utils/auth.ts) fragt ZUERST `req.session.isAdmin`. Das
    // steht seit dem Anmelden fest und wird nie nachgefuehrt. Ein Entzug wirkte
    // damit auf den BROWSER gar nicht: Wer sein Fenster offen liess, blieb …
    // Ausführlich: docs/begruendungen/routes/auth.ts.md#put-users-id-admin
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
 * Ausführlich: docs/begruendungen/routes/auth.ts.md#put-users-id-password
 */
router.put('/users/:id/password', requireAdmin, async (req, res) => {
  const { password } = req.body || {};
  const targetId = parseInt(pfadParam(req, 'id'));

  if (!password || passwortZuKurz(password))
    return sendeFehler(req, res, 400, 'passwort_zu_kurz');
  if (!targetId || targetId === nutzerId(req))
    return sendeFehler(req, res, 400, 'eigenes_konto_passwort');

  try {
    // Mit dem Passwort eines anderen Kontos lässt sich dieses übernehmen —
    // eine offene Verwaltersitzung allein genügt dafür nicht.
    if (!await bestaetigePasswort(req, res, angemeldeteNutzerId(req), req.body?.admin_password)) return;
    const hash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
    if (!await K.setzePasswortHash(targetId, hash)) return sendeFehler(req, res, 404, 'benutzer_nicht_gefunden');
    await protokolliere(angemeldeteNutzerId(req), targetId, 'passwort_gesetzt');

    // Offene Zugänge des Kontos beenden — ein zurückgesetztes Passwort soll
    // auch bestehende Sitzungen und Token schliessen.
    // Ausführlich: docs/begruendungen/routes/auth.ts.md#put-users-id-password-2
    await revokeAllSessions(targetId);
    await revokeAllTokens(targetId);

    res.json({ success: true });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

router.delete('/users/:id', requireAdmin, async (req, res) => {
  try {
    const targetId = parseInt(pfadParam(req, 'id'));
    if (!await bestaetigePasswort(req, res, angemeldeteNutzerId(req), req.body?.admin_password)) return;
    if (targetId !== nutzerId(req) && await K.kontoExistiert(targetId))
      await protokolliere(angemeldeteNutzerId(req), targetId, 'konto_geloescht');
    if (!await K.loescheKonto(targetId, nutzerId(req))) return sendeFehler(req, res, 404, 'benutzer_nicht_gefunden_oder_eigenes');
    // Die Zeile ist weg, der Zugang war es nicht
    // Die Bearer-Tokens gehen per ON DELETE CASCADE mit (Fremdschlüssel in db/basis.sql).
    // user_sessions dagegen ist der Tabellenraum des Session-Stores und hat
    // KEINEN Fremdschluessel auf users — die offene Sitzung des geloeschten …
    // Ausführlich: docs/begruendungen/routes/auth.ts.md#delete-users-id
    await revokeAllSessions(targetId);
    // Und der Token-Cache, der die geloeschten Zeilen sonst noch bis zu 60
    // Sekunden bedient.
    leereTokenCache();
    // Dasselbe fuer das Blickfeld: account_links haengt per ON DELETE CASCADE
    // an users, die Zeilen sind also mit dem Konto verschwunden — OHNE dass
    // utils/household.ts davon erfaehrt, denn hier laeuft kein unlink().
    // Ohne diesen Aufruf zeigte ein Hauptkonto sein geloeschtes Unterkonto
    // noch bis zu fuenf Minuten im Blickfeld.
    meldeHaushaltsaenderung();
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
    if (!await bestaetigePasswort(req, res, uid, String(current))) return;
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
    await K.setzeEigenesPasswort(uid, hash);
    // Alle Bearer-Tokens des Kontos verwerfen — siehe revokeAllTokens().
    //
    // Fuer die APP heisst das: Sie verwirft mit diesem Aufruf ihren EIGENEN
    // Zugang und muss sich danach neu anmelden. Das ist die richtige Antwort
    // und keine Unachtsamkeit — wer sein Passwort aendert, will alle
    // bestehenden Zugaenge loswerden, und eine Ausnahme fuer den gerade
    // benutzten waere genau die Luecke. Die App sagt es dem Nutzer vorher.
    await revokeAllTokens(uid);
    // Und die übrigen Browser-Sitzungen
    // Wer sein Passwort ändert, will in aller Regel einen fremden Zugang
    // loswerden. Die Tokens waren abgedeckt, die Sitzungen nicht: Ein
    // übernommenes Fenster blieb angemeldet, obwohl das Passwort neu ist.
    // Ausführlich: docs/begruendungen/routes/auth.ts.md#post-change-password
    await revokeAllSessions(uid);
    if (req.session?.userId) {
      const _self = { userId: uid, username: req.session.username, isAdmin: req.session.isAdmin };
      await establishSession(req, _self);
    }
    res.json({ success: true });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});


/**
 * Die Adresse für Links in E-Mails. APP_BASE_URL zählt allein; ohne sie in
 * Produktion gibt es KEINE (null) — ein Link aus dem Host-Kopf liesse sich von
 * aussen auf eine fremde Seite lenken. Ausserhalb des Betriebs bleibt der Kopf
 * erlaubt, dort gibt es keinen Angreifer.
 */
function getBaseUrl(req: Request): string | null {
  const basis = basisUrl();
  if (basis) return basis;
  if (process.env.NODE_ENV === 'production') {
    hinweisOhneBasisUrl('auth', 'Links in E-Mails werden nicht verschickt.');
    return null;
  }
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host  = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  return `${proto}://${host}`;
}

/** Reset-Links nur mit APP_BASE_URL — ausser ausserhalb des Betriebs, wo es keinen Angreifer gibt. */
function resetLinkMoeglich(): boolean {
  return !!basisUrl() || process.env.NODE_ENV !== 'production';
}

//  QR-Login
// VORHER: Der QR-Code enthielt den bcrypt-Hash des Nutzers (`h: password_hash`)
// in einem base64-Payload, HMAC-signiert mit dem SESSION_SECRET. Der Kommentar
// dort sagte „safe to include (can't reverse to plaintext)" — das stimmt fürs …
// Ausführlich: docs/begruendungen/routes/auth.ts.md#qr-ttl-ms
const QR_TTL_MS = 5 * 60 * 1000;

// qr_login_tokens wird beim Start in db/database.ts angelegt, nicht hier. An
// dieser Stelle stand bis zuletzt ein zweites, zeichengleiches CREATE TABLE IF
// NOT EXISTS, aufgerufen bei JEDER Token-Erzeugung und JEDER Einlösung — obwohl
// der zentrale Kommentar dort das Gegenteil behauptet. Siehe die ausführliche
// Begründung in routes/sets.ts an derselben Stelle.

// ── Zweiter Faktor (utils/zweiterFaktor.ts) ─────────────────────────────────
//
// Einrichten und Abschalten verlangen das Passwort: Wer nur eine offene
// Sitzung erbeutet, soll das Konto weder aussperren noch den Schutz abbauen.

/** Nur der Code des zweiten Faktors — mit derselben Bremse wie das Passwort. */
async function bestaetigeCode(req: Request, res: Response, uid: number, code: unknown): Promise<boolean> {
  const gesperrt = await bestaetigungGesperrt(uid);
  if (gesperrt) { sendeFehler(req, res, 429, gesperrt.code, gesperrt.vars); return false; }
  if (!await zf.pruefeCode(uid, code)) {
    await bestaetigungFehlgeschlagen(uid);
    sendeFehler(req, res, 400, 'zweiter_faktor_falsch');
    return false;
  }
  await bestaetigungGelungen(uid);
  return true;
}

router.get('/zweiter-faktor', requireLogin, async (req, res) => {
  try {
    res.json({ success: true, ...(await zf.stand(angemeldeteNutzerId(req))) });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

router.post('/zweiter-faktor/einrichten', requireLogin, async (req, res) => {
  try {
    const uid = angemeldeteNutzerId(req);
    if (!await bestaetigePasswort(req, res, uid, req.body?.password)) return;
    const geheimnis = await zf.beginneEinrichtung(uid);
    if (!geheimnis) return sendeFehler(req, res, 409, 'zweiter_faktor_schon_aktiv');
    const u = await K.kontoKurz(uid);
    res.json({ success: true, geheimnis, otpauth: zf.otpauthAdresse(geheimnis, u?.username ?? String(uid)) });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

router.post('/zweiter-faktor/bestaetigen', requireLogin, async (req, res) => {
  try {
    const uid = angemeldeteNutzerId(req);
    const codes = await zf.bestaetigeEinrichtung(uid, String(req.body?.code ?? ''));
    if (!codes) return sendeFehler(req, res, 400, 'zweiter_faktor_falsch');
    const kopf = String(req.headers.authorization || '');
    await beendeAndereZugaenge(uid, kopf.startsWith('Bearer ') ? kopf.slice(7) : null,
      req.session?.userId ? req.sessionID : null);
    res.json({ success: true, codes });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

router.post('/zweiter-faktor/abschalten', requireLogin, async (req, res) => {
  try {
    const uid = angemeldeteNutzerId(req);
    if (!await zf.istAktiv(uid)) return sendeFehler(req, res, 409, 'zweiter_faktor_nicht_aktiv');
    if (!await bestaetigePasswort(req, res, uid, req.body?.password, { zweiterFaktor: req.body?.code })) return;
    await zf.schalteAb(uid);
    res.json({ success: true });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

router.post('/zweiter-faktor/codes', requireLogin, async (req, res) => {
  try {
    const uid = angemeldeteNutzerId(req);
    if (!await zf.istAktiv(uid)) return sendeFehler(req, res, 409, 'zweiter_faktor_nicht_aktiv');
    if (!await bestaetigeCode(req, res, uid, req.body?.code)) return;
    res.json({ success: true, codes: await zf.erneuereCodes(uid) });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// Notausgang, wenn Telefon UND Wiederherstellungscodes weg sind.
router.delete('/users/:id/zweiter-faktor', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(pfadParam(req, 'id'));
    if (!Number.isInteger(id)) return sendeFehler(req, res, 400, 'id_ungueltig');
    if (!await bestaetigePasswort(req, res, angemeldeteNutzerId(req), req.body?.admin_password)) return;
    await zf.schalteAb(id);
    await protokolliere(angemeldeteNutzerId(req), id, 'zweiter_faktor_entfernt');
    res.json({ success: true });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// POST /api/v1/auth/qr-token — Nonce erzeugen (nur für die eigene Session)
//  POST statt GET
// Diese Route LEGT ETWAS AN: eine QR-Login-Nonce, die fünf Minuten lang ein
// Konto öffnet. Als GET war sie die einzige zustandsändernde Route im Baum, …
// Ausführlich: docs/begruendungen/routes/auth.ts.md#post-qr-token
router.post('/qr-token', requireLogin, async (req, res) => {
  try {
    // Wie /token-create: Ein QR-Code eröffnet einen neuen, langlebigen Geräte-
    // zugang. Mit einem erbeuteten Token allein darf das nicht gehen.
    if (!req.session?.userId) return sendeFehler(req, res, 403, 'nur_mit_sitzung');
    if (!await bestaetigePasswort(req, res, angemeldeteNutzerId(req), req.body?.password)) return;
    // Ohne Adresse kein Code
    // Verweigern und nicht raten: Der QR-Code ist der einzige Ort im Baum, an
    // dem eine falsche Adresse SPAETER auffaellt und nicht sofort. Er laesst
    // sich scannen, die App verbindet sich im WLAN — und findet den Server …
    // Ausführlich: docs/begruendungen/routes/auth.ts.md#post-qr-token-basis
    const basis = basisUrl();
    if (!basis) {
      // Der Nutzer sieht die Absage in der Oberflaeche; der BETREIBER sieht
      // sie sonst nirgends — eine abgelehnte Anfrage steht in keinem Protokoll.
      hinweisOhneBasisUrl('auth:qr',
        'der QR-Code zur Verknuepfung der App laesst sich nicht erzeugen.');
      return sendeFehler(req, res, 503, 'qr_ohne_basis_url');
    }
    // Abgelaufene/verbrauchte Nonces mitentsorgen — die Tabelle bleibt so klein.
    await K.raeumeQrTokensAuf().catch(logAndContinue('qr-token:aufräumen'));
    // Wie lange soll der ZUGANG gelten, den dieser Code eroeffnet?
    // Ein unbekannter Wert wird nicht abgewiesen, sondern zu „keine feste
    // Frist" — dann gilt wie bisher allein die Gleitfrist. Ein aelterer
    // Client, der das Feld gar nicht kennt, verhaelt sich damit unveraendert.
    // Ausführlich: docs/begruendungen/routes/auth.ts.md#post-qr-token-tage
    const tage = laufzeitTage(req.body?.gueltigkeit);
    const nonce = crypto.randomBytes(32).toString('base64url');
    await K.legeQrTokenAn(hashToken(nonce), nutzerId(req), new Date(Date.now() + QR_TTL_MS), tage);
    // `token_days`: was tatsaechlich gespeichert wurde, nicht was gewuenscht
    // war. Ein unbekannter Wert wird zu null, und die Oberflaeche soll die
    // Frist nennen koennen, die wirklich gilt.
    // Ausführlich: docs/begruendungen/routes/auth.ts.md#post-qr-token-2
    res.json({ success: true, token: `bim:${nonce}`, expires_in: QR_TTL_MS / 1000,
      token_days: tage, url: basis });
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
    const claimed = await K.loeseQrTokenEin(hashToken(token.slice(4)));
    if (!claimed) return sendeFehler(req, res, 401, 'token_ungueltig');

    const user = await K.kontoVoll(claimed.user_id);
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
    // Die Laufzeit kommt aus der ZEILE, nicht aus der Anfrage — siehe
    // /qr-token oben. `token_days` ist NULL, wenn nichts gewaehlt wurde oder
    // die Nonce von einem aelteren Stand stammt; dann bleibt es bei der
    // Gleitfrist.
    const bearerToken = await createToken(user.id, 'qr-login', true, claimed.token_days ?? null);
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
    if (await K.nameOderEmailVergeben(username, email)) return sendeFehler(req, res, 409, 'benutzername_oder_email_vergeben');

    const token  = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const hash   = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // verification_token wird — wie api_tokens — nur als SHA-256 gespeichert:
    // Bei einem Datenbank-Leak wäre ein ausstehender Bestätigungslink sonst einlösbar.
    const neuId = await K.registriereKonto({ username, email, first_name, last_name, hash,
      tokenHash: hashToken(token), bis: expires });
    // Die gewählte Sprache steuert Oberfläche und E-Mails; ohne Protokoll bliebe
    // unklar, warum ein frisches Konto in der falschen Sprache startet.
    if (neuId) await setUserSetting(neuId, 'language', lang).catch(logAndContinue(`registrierung:sprache ${neuId}`));

    const basis = getBaseUrl(req);
    const result = basis
      ? await sendVerificationMail(email, first_name || username, token, basis, lang)
      : { success: false, mode: 'ohne_basis' as const };

    res.json({
      success: true,
      message: result.mode === 'ohne_basis'
        ? 'Konto erstellt. Eine Bestätigung per E-Mail ist auf diesem Server nicht eingerichtet (APP_BASE_URL fehlt) — bitte den Verwalter fragen.'
        : result.mode === 'console'
        ? 'Konto erstellt. Der Server verschickt keine E-Mails (SMTP nicht eingerichtet) – bitte den Verwalter fragen.'
        : 'Konto erstellt. Bitte bestätige deine E-Mail-Adresse.',
      email_sent: result.success,
      console_mode: result.mode === 'console',
    });
  } catch (e) {
    if (fehlerCode(e) === '23505') return sendeFehler(req, res, 409, 'benutzername_oder_email_vergeben');
    handleRouteError(res, e, undefined, req);
  }
});

// GET /api/v1/auth/verify ist ENTFERNT
// Sie hatte keinen Aufrufer, und das stand als Kommentar
// genau hier: „Gefahrlos umzustellen, weil die Route KEINEN Aufrufer hat: Der
// Link in der Verifikationsmail zeigt auf /verify (utils/mailer.ts), das …
// Ausführlich: docs/begruendungen/routes/auth.ts.md#post-forgot-password

// ── POST /api/v1/auth/forgot-password ───────────────────────────────────────────
router.post('/forgot-password', ipThrottle('forgot-password', 5, 60 * 60 * 1000), async (req, res) => {
  const { email } = req.body;
  if (!email) return sendeFehler(req, res, 400, 'email_erforderlich');
  // Ohne feste Adresse käme der Link aus dem Host-Header — wer den fälscht,
  // bekäme den Reset-Code des Opfers zugeschickt. Vor der Nutzersuche, damit
  // die Antwort nichts über die E-Mail verrät.
  if (!resetLinkMoeglich()) {
    hinweisOhneBasisUrl('passwort-reset', 'Passwort-vergessen-Mails werden nicht versendet.');
    return sendeFehler(req, res, 503, 'passwort_reset_nicht_eingerichtet');
  }
  try {
    // LOWER auf beiden Seiten wie an JEDER anderen E-Mail-Suche (Login,
    // Registrierung, Profil). Hier stand der einzige case-SENSITIVE Vergleich:
    // Wer sich als "Marco@Example.CH" registriert hatte und im Formular
    // "marco@example.ch" tippte, bekam "Falls die E-Mail existiert…" — und nie
    // eine Mail. Durch die Anti-Enumeration-Antwort war das von aussen nicht
    // von Erfolg zu unterscheiden; der Nutzer ist dauerhaft ausgesperrt.
    const user = await K.aktivesKontoNachEmail(email);
    // Always return success to prevent email enumeration
    if (!user) return res.json({ success: true, message: 'Falls die E-Mail existiert, wurde ein Link gesendet.' });

    const token   = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    // Nur der Hash in die DB — der Klartext geht ausschliesslich per Mail raus.
    await K.setzeRuecksetzToken(user.id, hashToken(token), expires);

    // NICHT awaiten: Die Antwort ist in beiden Fällen wortgleich, aber das
    // await machte sie messbar ungleich SCHNELL — bei unbekannter E-Mail kam
    // sie sofort, bei bekannter erst nach dem SMTP-Versand (bis zu ~10 s laut
    // den Timeouts in getTransporter). Damit liess sich trotz der neutralen …
    // Ausführlich: docs/begruendungen/routes/auth.ts.md#post-forgot-password-2
    getSetting(user.id, 'language', 'de')
      .catch(() => 'de')
      .then((lang: unknown) => sendPasswordResetMail(
        // An die GESPEICHERTE Adresse: Die eingegebene passt per LOWER() auch
        // als Unicode-Variante (Kelvin-K, „İ“) und kann ein fremdes Postfach sein.
        user.email, user.first_name || user.username, token, getBaseUrl(req)!, String(lang ?? 'de')))
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
    const user = await K.kontoNachRuecksetzToken(hashToken(token));
    if (!user) return sendeFehler(req, res, 400, 'token_ungueltig');
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await K.setzePasswortNachRuecksetzen(user.id, hash);
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


// Die App fragt das vor jedem Klartext-Zugang in einem neuen Netz: Im fremden
// WLAN kann "http://nas:3000" auf einen anderen Rechner zeigen, und der
// bekäme sonst den Token. Nur der echte Server kennt den Hash des Tokens und
// kann die Zufallszahl damit unterschreiben; die Kennung (16 Stellen des
// Hashs) verrät über den Token nichts.
router.post('/serverbeweis', ipThrottle('serverbeweis', 120, 60 * 60 * 1000), async (req, res) => {
  const { kennung, nonce } = req.body ?? {};
  if (typeof kennung !== 'string' || !/^[0-9a-f]{16}$/.test(kennung)
      || typeof nonce !== 'string' || !/^[0-9a-f]{32,128}$/.test(nonce))
    return sendeFehler(req, res, 400, 'wert_ungueltig');
  try {
    const zeile = await K.tokenNachKennung(kennung);
    if (!zeile) return sendeFehler(req, res, 404, 'token_ungueltig');
    res.json({ success: true,
      beweis: crypto.createHmac('sha256', zeile.token).update(nonce).digest('hex') });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// CJS-kompatibler Export: module.exports bleibt der Router selbst,
// mit den intern/von jobs/ genutzten Funktionen als Properties (wie zuvor).
export = Object.assign(router, { requireLogin, requireAdmin });
