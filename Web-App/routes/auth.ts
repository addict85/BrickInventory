
import { sitzungsKeksName, sitzungsKeksOptionen } from '../src/infra/sitzungsKeks';
import { protokolliere } from '../src/verwaltung/dienst';
const router  = vertragsRouter();
import * as K from '../src/konto/konten';
import { meldeHaushaltsaenderung } from '../src/haushalt/haushalt';
import { fehlerAntwort, logAndContinue, meldeUndWeiter, fehlertext, pfadParam, meldeUndLiefere } from '../src/infra/httpError';
import { hashToken, createToken, pruefeToken, assertLoginAllowed, revokeAllSessions, beendeAndereZugaenge, deleteToken, USERNAME_RE, EMAIL_RE, leereTokenCache, laufzeitTage, rotiereToken, rotationFaellig, UNBEGRENZT, UEBERLAPPUNG_MS, nameGueltig } from '../src/konto/auth';
import { zielGedrosselt } from '../src/konto/zielDrossel';
import { perSitzung, anmelden, establishSession, requireLoginOrToken, nutzerId, angemeldeteNutzerId, ipThrottle, bestaetigePasswort, bestaetigeCode, bestaetigeMitFaktor } from '../src/konto/http/anmeldung';
import type { TokenScope } from '../src/konto/auth';
import { tlsStand } from '../src/infra/tlsWurzel';
import { bestaetigeEinrichtungGebremst } from '../src/konto/passwortBestaetigung';
import { hinweisNebenher } from '../src/konto/kontoHinweis';
import crypto from 'crypto';
import { strictBool } from '../src/infra/validate';
import { passwortMangel } from '../src/infra/passwortRegel';
import { sendEmailGeaendertMail, sendPasswordResetMail, sendVerificationMail, sendRegistrierungsVersuchMail, sendBenutzernameVergebenMail, mailEingerichtet } from '../src/infra/mailer';
import type { Request, Response } from 'express';
import { setUserSetting } from '../src/konto/settings';
import { registrierungOffen } from '../src/konto/settings';
import { getSetting } from '../src/konto/settings';
import { requireApiAdmin } from './api_v1/middleware';
import { sendeFehler, fehlerText, antwortSprache, alsDoppelt } from '../src/infra/fehlerTexte';
import { basisUrl, hinweisOhneBasisUrl } from '../src/infra/basisUrl';
import * as zf from '../src/konto/zweiterFaktor';
import * as P from '../src/konto/passkeys';
import { loescheKontoDateien } from '../src/gutscheine/gutscheinDateien';
import { vertragsRouter } from '../src/infra/vertrag/pruefen';
import type { Antwort } from '../src/infra/vertrag';

// Ein Wächter für Sitzung UND Token: Die App hat keine Sitzung und war mit
// einem reinen Sitzungswächter von Routen ausgesperrt.
// Ausführlich: docs/begruendungen/routes/auth.ts.md#requirelogin
const requireLogin = requireLoginOrToken;
const requireAdmin = requireApiAdmin;
// Feste Obergrenze ab Anmeldung; der Tausch erbt sie (legeNachfolgerAn), die App meldet dann ab.
const APP_HOECHSTDAUER_TAGE = 180;

/** Das Label steht in der Geräteliste; ohne Grenze lägen dort beliebig lange Zeilen. */
const LABEL_MAX = 100;

function tokenLabel(roh: unknown, vorgabe: string): string {
  const text = typeof roh === 'string' ? roh.trim() : '';
  return text ? Array.from(text).slice(0, LABEL_MAX).join('') : vorgabe;
}

function tokenScope(roh: unknown): TokenScope { return roh === 'voll' ? 'voll' : 'app'; }

/** `expires_at` ist die frühere der beiden Fristen, `null` nur bei „unbegrenzt". */
async function tokenAngaben(klartext: string) {
  const z = await K.tokenStand(hashToken(klartext));
  return z ? { scope: z.scope, expires_at: z.expires_at, hard_expires_at: z.hard_expires_at,
               never_expires: z.never_expires, rotiert_am: z.rotiert_am } : null;
}

type Angemeldet = { id: number | string; username: string; is_admin: boolean; must_change_password?: boolean };

/** Sitzung, Token und Antwort — derselbe Weg nach Passwort und Passkey. */
async function angemeldetAntworten(req: Request, res: Response, user: Angemeldet, mitToken: boolean) {
  const { label, never_expires, scope } = req.body ?? {};
  const uid = Number(user.id);
  // Neue Session-ID gegen Session Fixation, auch für die App; die Zeile verfällt.
  await establishSession(req, {
    userId:   uid,
    username: user.username,
    isAdmin:  user.is_admin,
    mussPasswortAendern: user.must_change_password === true,
  });
  // Ein Token, den die Datenbank nie sah, liefe im SSE-Kanal in ein 401.
  const dauerhaft = never_expires === true;
  let token: string | null = null;
  // Die Webapp nur mit httpOnly-Cookie: Ein Token wäre per Skript auslesbar.
  if (mitToken) try {
    token = await createToken(uid, tokenLabel(label, 'webapp-session'), dauerhaft, dauerhaft ? APP_HOECHSTDAUER_TAGE : null,
                              { scope: tokenScope(scope), ip: req.ip });
  } catch (e) {
    console.warn('[login] Token konnte nicht gespeichert werden:', fehlertext(e));
    if (dauerhaft)
      return sendeFehler(req, res, 500, 'token_nicht_ausgestellt');
  }
  // `never_expires` nennt, was gilt: Mit gleitender Frist ist nichts unbegrenzt.
  res.json({ success: true, ...(token ? { token } : {}), ...(token ? { token_info: await tokenAngaben(token) } : {}),
    never_expires: false,
    user: { id: user.id, username: user.username, is_admin: user.is_admin,
    // Nur beim automatisch erzeugten Admin-Passwort gesetzt (db/database.ts).
    mustChangePassword: user.must_change_password } });
}

/** Die EINE Anmeldung für Webapp und App, damit beide dieselben Regeln erfüllen.
 * Ausführlich: docs/begruendungen/routes/auth.ts.md#post-login */
router.post('/login', async (req, res: Antwort<'POST /api/v1/auth/login'>) => {
  const { username, password, code: zweiterCode, ohne_token, passkey } = req.body;
  const pruefung = await anmelden(req, username, password, zweiterCode, passkey);
  if (!pruefung.ok) {
    const { status, code, vars, unverified, zweiterFaktor, passkey: mitPasskey } = pruefung.absage;
    // `zweiter_faktor`: Codefeld zeigen und erneut senden (oder `passkey`).
    if (zweiterFaktor) {
      return res.status(status).json({
        success: false, code, zweiter_faktor: true, ...(mitPasskey ? { passkey: true } : {}),
        error: fehlerText(code, antwortSprache(req), vars),
      });
    }
    // `unverified` blendet „E-Mail erneut senden?" ein; sendeFehler kennt das Feld nicht.
    if (unverified) {
      return res.status(status).json({
        success: false, code, unverified: true,
        error: fehlerText(code, antwortSprache(req), vars),
      });
    }
    return sendeFehler(req, res, status, code, vars);
  }
  await angemeldetAntworten(req, res, pruefung.user as Angemeldet, ohne_token !== true);
});

/** Sitzung beenden UND Token entwerten, damit ein Aufruf beides wegräumt.
 * Ausführlich: docs/begruendungen/routes/auth.ts.md#post-logout */
router.post('/logout', async (req, res: Antwort<'POST /api/v1/auth/logout'>) => {
  const auth = String(req.headers.authorization || '');
  // Nur loggen: Die Abmeldung darf daran nicht scheitern, still bliebe der Fall
  // aber unbemerkt.
  if (auth.startsWith('Bearer ')) await deleteToken(auth.slice(7)).catch(logAndContinue('logout:token entsorgen'));
  // destroy gibt es nur mit Sitzungs-Middleware; die App ruft ohne Cookie auf.
  if (req.session?.destroy) return req.session.destroy(() => {
    res.clearCookie(sitzungsKeksName(), sitzungsKeksOptionen()).json({ success: true });
  });
  res.json({ success: true });
});

/** Sitzung ODER Token; ohne Anmeldung 200 für den Browser, 401 bei Token.
 * Ausführlich: docs/begruendungen/routes/auth.ts.md#get-me */
router.get('/me', async (req, res: Antwort<'GET /api/v1/auth/me'>) => {
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const ungueltig = (code: 'token_ungueltig' | 'token_rotation_noetig') =>
    res.status(401).json({ success: false, loggedIn: false, user: null,
      code, error: fehlerText(code, antwortSprache(req)) });
  try {
    if (req.session?.userId) {
      const user = await K.kontoKurz(req.session.userId);
      if (user) return res.json({ success: true, loggedIn: true,
        user: { id: user.id, username: user.username, is_admin: user.is_admin, mustChangePassword: user.must_change_password } });
    }
    const p = token ? await pruefeToken(token, { ip: req.ip }) : { nutzer: null };
    const u = p.nutzer;
    if (u) {
      const faellig = rotationFaellig(u);
      if (faellig) res.setHeader('X-Token-Rotation', 'faellig');
      // is_admin ist das Recht DIESES Tokens: bei Scope `app` immer false.
      return res.json({ success: true, loggedIn: true,
        user: { id: u.user_id, username: u.username, is_admin: u.is_admin === 1, mustChangePassword: u.muss_passwort_aendern === true },
        token_expires: u.expires_at, token_last_used: u.last_used,
        token_info: { scope: u.scope, expires_at: u.expires_at, hard_expires_at: u.hard_expires_at ?? null,
                      never_expires: u.never_expires === true, rotiert_am: u.rotiert_am,
                      rotation_faellig: faellig } });
    }
    if (token) return ungueltig('grund' in p && p.grund ? p.grund : 'token_ungueltig');
    res.json({ success: true, loggedIn: false, user: null });
  } catch (e) {
    // Ohne Anmeldung ist die Anmeldemaske die richtige Antwort, keine Fehlerseite.
    meldeUndWeiter('auth:me', e);
    if (token) return ungueltig('token_ungueltig');
    res.json({ success: true, loggedIn: false, user: null });
  }
});

/** Öffentlich, weil ein unbegrenzter Token nach der Pflichtfrist nur noch hier
 * gilt; die Prüfung steht deshalb hier. */
router.post('/token-rotieren', ipThrottle('token-rotieren', 120, 60 * 60 * 1000), async (req, res: Antwort<'POST /api/v1/auth/token-rotieren'>) => {
  const auth = String(req.headers.authorization || '');
  const alt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!alt || !(await pruefeToken(alt, { ip: req.ip, zweck: 'rotation' })).nutzer)
    return sendeFehler(req, res, 401, 'token_ungueltig');
  const t = await rotiereToken(alt, req.ip);
  if (!t) return sendeFehler(req, res, 401, 'token_ungueltig');
  res.json({ success: true, token: t.token,
    token_info: { scope: t.scope, expires_at: t.expires_at, hard_expires_at: t.hard_expires_at,
                  never_expires: t.never_expires, rotiert_am: t.rotiert_am, rotation_faellig: false },
    alt_gueltig_bis: t.alt_gueltig_bis, ueberlappung_sek: UEBERLAPPUNG_MS / 1000 });
});

/** Nur aus einer Sitzung und mit Passwort: Sonst prägte ein erbeuteter Token
 * beliebig viele dauerhafte Nachfolger. */
router.post('/token-create', requireLogin, async (req, res: Antwort<'POST /api/v1/auth/token-create'>) => {
  if (!req.session?.userId) return sendeFehler(req, res, 403, 'nur_mit_sitzung');
  const userId = angemeldeteNutzerId(req);
  if (!await bestaetigePasswort(req, res, userId, req.body?.password)) return;
  const label = tokenLabel(req.body?.label, 'Android App');
  const neu = await createToken(userId, label, true, null, { scope: tokenScope(req.body?.scope), ip: req.ip });
  res.json({ success: true, token: neu, label, never_expires: false, token_info: await tokenAngaben(neu) });
});

router.get('/profile', requireLogin, async (req, res: Antwort<'GET /api/v1/auth/profile'>) => {
  const user = await K.profil(nutzerId(req)!);
  if (!user) return res.status(404).json({ success: false });
  res.json({ success: true, user });
});

router.put('/profile', requireLogin, async (req, res: Antwort<'PUT /api/v1/auth/profile'>) => {
  const { username, email, first_name, last_name, password, password_current } = req.body;
  const user = await K.kontoVoll(nutzerId(req)!);
  if (!user) return res.status(404).json({ success: false });

  // Das Passwort nur über /change-password: Nur dort werden danach alle
  // übrigen Sitzungen und Token verworfen.
  if (password) return sendeFehler(req, res, 400, 'passwort_ueber_change_password');

  // Dieselbe Regex wie Login/Register: Sonst liesse sich eine fremde E-Mail als
  // Benutzername eintragen, und der Login sucht „username ODER email".
  if (username !== undefined && !USERNAME_RE.test(String(username || '')))
    return sendeFehler(req, res, 400, 'benutzername_ungueltig');
  if (!nameGueltig(first_name) || !nameGueltig(last_name)) return sendeFehler(req, res, 400, 'name_ungueltig');

  // Case-insensitiv und auch gegen die E-Mail-Spalte, weil der Login mit LOWER()
  // beide Felder vergleicht.
  if (username && username.toLowerCase() !== String(user.username || '').toLowerCase()) {
    if (await K.nameVergeben(username, user.id)) return sendeFehler(req, res, 400, 'benutzername_vergeben');
  }

  const emailChanged = email && email.toLowerCase() !== String(user.email || '').toLowerCase();
  if (emailChanged) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return sendeFehler(req, res, 400, 'email_ungueltig');
    if (await K.emailVergeben(email, user.id)) return sendeFehler(req, res, 400, 'email_vergeben');
    // Über die neue Adresse liesse sich danach das Passwort zurücksetzen —
    // wer kurz eine fremde Sitzung hat, übernähme so das Konto.
    if (!password_current) return sendeFehler(req, res, 400, 'aktuelles_passwort_erforderlich');
    if (!await bestaetigeMitFaktor(req, res, user.id, String(password_current), req.body?.code)) return;
  }

  const felder: Record<string, unknown> = {};
  if (username) felder.username = username;
  if (first_name !== undefined) felder.first_name = first_name || null;
  if (last_name  !== undefined) felder.last_name  = last_name  || null;
  if (emailChanged) {
    const token   = crypto.randomBytes(32).toString('hex');
    felder.email = email;
    // Auch für Verwalter: Ob die Adresse dem Inhaber gehört, zeigt erst der Link.
    felder.email_verified = false;
    // Nur der Hash in die DB, der Klartext geht ausschliesslich per Mail hinaus.
    felder.verification_token = hashToken(token);
    felder.token_expires = new Date(Date.now() + 24*60*60*1000);
    await K.aendereProfil(user.id, felder);
    // In der Sprache des Kontos, nicht in der Vorgabe.
    // Ausführlich: docs/begruendungen/routes/auth.ts.md#put-profile-emailsent
    let emailSent = false;
    const lang = String(await getSetting(user.id, 'language', 'de').catch(() => 'de'));
    const basis = getBaseUrl();
    if (basis) emailSent = await sendVerificationMail(email, token, basis, lang)
      .then(r => r.success, meldeUndLiefere('anmeldung:bestaetigungsmail', false));
    // Die alte Adresse erfährt davon — war es nicht der Inhaber, merkt er es so.
    if (user.email) await sendEmailGeaendertMail(user.email, user.username, email, lang)
      .catch((e: unknown) => meldeUndWeiter('anmeldung:hinweis-alte-adresse', e));
    return res.json({ success: true, emailChanged: true, emailSent });
  }

  await K.aendereProfil(user.id, felder);
  res.json({ success: true });
});

router.get('/users', requireAdmin, async (_req, res: Antwort<'GET /api/v1/auth/users'>) => {
  const users = await K.kontenListe();
  res.json({ success: true, users });
});

router.post('/users', requireAdmin, async (req, res: Antwort<'POST /api/v1/auth/users'>) => {
  const { username, password } = req.body;
  if (!username || !password) return sendeFehler(req, res, 400, 'benutzername_passwort');
  if (!USERNAME_RE.test(String(username)))
    return sendeFehler(req, res, 400, 'benutzername_ungueltig');
  const mangel = passwortMangel(password, username);
  if (mangel) return sendeFehler(req, res, 400, mangel);
  // Streng: Die Zeichenkette "false" ist in JavaScript wahr und legte einen
  // Verwalter an.
  const roh = req.body.is_admin ?? req.body.isAdmin;
  const alsVerwalter = roh === undefined ? false : strictBool(roh, 'is_admin');
  // Passwort bestätigen und protokollieren — eine erbeutete Sitzung soll keinen
  // Verwalter anlegen.
  const verwalter = angemeldeteNutzerId(req);
  if (!await bestaetigePasswort(req, res, verwalter, req.body?.admin_password)) return;
  // Wie bei der Registrierung auch gegen die Adressen: Die Anmeldung sucht in beiden Spalten.
  if (await K.nameVergeben(username, 0)) return sendeFehler(req, res, 409, 'benutzername_vergeben');
  const neu = await K.legeKontoAn(username, password, alsVerwalter).catch(alsDoppelt('benutzername_vergeben'));
  if (neu === null) return sendeFehler(req, res, 409, 'benutzername_vergeben');
  await protokolliere(verwalter, neu, 'konto_angelegt');
  if (alsVerwalter) await protokolliere(verwalter, neu, 'verwalter_ernannt');
  res.json({ success: true });
});

router.put('/users/:id/admin', requireAdmin, async (req, res: Antwort<'PUT /api/v1/auth/users/:id/admin'>) => {
  const targetId = parseInt(pfadParam(req, 'id'));
  // Streng: "false" ist in JavaScript wahr und entzöge sonst keine Rechte.
  const soll = strictBool(req.body.is_admin, 'is_admin');
  if (targetId === nutzerId(req) && !soll)
    return sendeFehler(req, res, 400, 'eigene_adminrolle');
  if (!await K.kontoExistiert(targetId)) return sendeFehler(req, res, 404, 'benutzer_nicht_gefunden');
  if (!await bestaetigePasswort(req, res, angemeldeteNutzerId(req), req.body?.admin_password)) return;
  const r = await K.setzeVerwalterRolle(targetId, soll);
  if (!r) return sendeFehler(req, res, 404, 'benutzer_nicht_gefunden');
  if (r.geaendert) await protokolliere(angemeldeteNutzerId(req), targetId, soll ? 'verwalter_ernannt' : 'verwalter_entzogen');

  // Sitzungen enden, weil istVerwalter() zuerst das nie nachgeführte
  // `req.session.isAdmin` fragt; ein Entzug wirkte sonst im offenen Fenster nicht.
  // Ausführlich: docs/begruendungen/routes/auth.ts.md#put-users-id-admin
  res.json({ success: true });
});

router.put('/users/:id/aktiv', requireAdmin, async (req, res: Antwort<'PUT /api/v1/auth/users/:id/aktiv'>) => {
  const targetId = parseInt(pfadParam(req, 'id'));
  const soll = strictBool(req.body.is_active, 'is_active');
  if (!Number.isInteger(targetId)) return sendeFehler(req, res, 400, 'id_ungueltig');
  if (targetId === nutzerId(req)) return sendeFehler(req, res, 400, 'eigenes_konto_deaktivieren');
  if (!await K.kontoExistiert(targetId)) return sendeFehler(req, res, 404, 'benutzer_nicht_gefunden');
  if (!await bestaetigePasswort(req, res, angemeldeteNutzerId(req), req.body?.admin_password)) return;
  const r = await K.setzeAktiv(targetId, soll);
  if (!r) return sendeFehler(req, res, 404, 'benutzer_nicht_gefunden');
  if (r.geaendert) await protokolliere(angemeldeteNutzerId(req), targetId, soll ? 'konto_reaktiviert' : 'konto_deaktiviert');
  res.json({ success: true, is_active: soll });
});

/** Ohne aktuelles Passwort des Ziels, aber mit dem des Verwalters.
 * Ausführlich: docs/begruendungen/routes/auth.ts.md#put-users-id-password */
router.put('/users/:id/password', requireAdmin, async (req, res: Antwort<'PUT /api/v1/auth/users/:id/password'>) => {
  const { password } = req.body || {};
  const targetId = parseInt(pfadParam(req, 'id'));
  if (!targetId || targetId === nutzerId(req))
    return sendeFehler(req, res, 400, 'eigenes_konto_passwort');
  const mangel = passwortMangel(password, (await K.kontoKurz(targetId))?.username);
  if (mangel) return sendeFehler(req, res, 400, mangel);

  // Mit dem Passwort eines anderen Kontos lässt sich dieses übernehmen —
  // eine offene Verwaltersitzung allein genügt dafür nicht.
  if (!await bestaetigePasswort(req, res, angemeldeteNutzerId(req), req.body?.admin_password)) return;
  if (!await K.setzeFremdesPasswort(targetId, password)) return sendeFehler(req, res, 404, 'benutzer_nicht_gefunden');
  await protokolliere(angemeldeteNutzerId(req), targetId, 'passwort_gesetzt');

  res.json({ success: true });
});

router.delete('/users/:id', requireAdmin, async (req, res: Antwort<'DELETE /api/v1/auth/users/:id'>) => {
  const targetId = parseInt(pfadParam(req, 'id'));
  if (!await bestaetigePasswort(req, res, angemeldeteNutzerId(req), req.body?.admin_password)) return;
  if (targetId !== nutzerId(req) && await K.kontoExistiert(targetId))
    await protokolliere(angemeldeteNutzerId(req), targetId, 'konto_geloescht');
  if (!await K.loescheKonto(targetId, nutzerId(req))) return sendeFehler(req, res, 404, 'benutzer_nicht_gefunden_oder_eigenes');
  // user_sessions hat keinen Fremdschlüssel auf users: Die offene Sitzung des
  // gelöschten Kontos bliebe ohne diesen Aufruf gültig.
  // Ausführlich: docs/begruendungen/routes/auth.ts.md#delete-users-id
  await revokeAllSessions(targetId);
  // Eigene Anleitungen und Gutschein-PDFs gehören zum Konto; liegen blieben sie ohne Besitzer.
  await loescheKontoDateien(targetId);
  // Der Token-Cache bediente gelöschte Zeilen sonst noch bis zu 60 Sekunden.
  leereTokenCache();
  // account_links verschwindet per CASCADE, ohne dass der Haushalt davon
  // erfährt; sonst bliebe das Unterkonto bis zu fünf Minuten im Blickfeld.
  meldeHaushaltsaenderung();
  res.json({ success: true });
});

router.post('/change-password', requireLogin, async (req: LoggedInRequest, res: Antwort<'POST /api/v1/auth/change-password'>) => {
  const { current, newPassword } = req.body;
  if (!current || !newPassword) return sendeFehler(req, res, 400, 'alle_felder_erforderlich');
  const uid = nutzerId(req);
  if (uid == null) return sendeFehler(req, res, 401, 'nicht_angemeldet');
  if (!await bestaetigeMitFaktor(req, res, uid, String(current), req.body?.code)) return;
  // NACH der Prüfung des alten Passworts: Ein Fremder erfährt über das neue nichts.
  // Der Name aus der Tabelle: Mit App-Token gibt es keine Sitzung, die ihn trägt.
  const mangel = passwortMangel(newPassword, (await K.kontoKurz(uid))?.username);
  if (mangel) return sendeFehler(req, res, 400, mangel);
  // Beendet alle Zugänge, auch den eigenen; die Sitzung wird danach neu aufgebaut.
  await K.aendereEigenesPasswort(uid, newPassword, { passkeysWiderrufen: req.body?.passkeys_widerrufen === true });
  hinweisNebenher(uid, 'passwort_geaendert');
  if (req.session?.userId) {
    const _self = { userId: uid, username: req.session.username, isAdmin: req.session.isAdmin, mussPasswortAendern: false };
    await establishSession(req, _self);
  }
  res.json({ success: true });
});


/** Nie aus Kopfzeilen: Ein Link aus Host oder X-Forwarded-Host liesse sich auf
 * eine fremde Seite lenken — auch ein „Testserver" steht oft im Netz. */
function getBaseUrl(): string | null {
  const basis = basisUrl();
  if (!basis) hinweisOhneBasisUrl('auth', 'Links in E-Mails werden nicht verschickt.');
  return basis;
}

// Der QR-Code trägt nur eine einmalige Nonce (SHA-256 in qr_login_tokens),
// kein Geheimnis des Kontos.
// Ausführlich: docs/begruendungen/routes/auth.ts.md#qr-ttl-ms
const QR_TTL_MS = 5 * 60 * 1000;

// ── Zweiter Faktor (src/konto/zweiterFaktor.ts) ─────────────────────────────────
// Einrichten und Abschalten verlangen das Passwort: Wer nur eine offene
// Sitzung erbeutet, soll das Konto weder aussperren noch den Schutz abbauen.

router.get('/zweiter-faktor', requireLogin, async (req, res: Antwort<'GET /api/v1/auth/zweiter-faktor'>) => {
  res.json({ success: true, ...(await zf.stand(angemeldeteNutzerId(req))) });
});

router.post('/zweiter-faktor/einrichten', requireLogin, async (req, res: Antwort<'POST /api/v1/auth/zweiter-faktor/einrichten'>) => {
  const uid = angemeldeteNutzerId(req);
  if (!await bestaetigePasswort(req, res, uid, req.body?.password)) return;
  const geheimnis = await zf.beginneEinrichtung(uid);
  if (!geheimnis) return sendeFehler(req, res, 409, 'zweiter_faktor_schon_aktiv');
  const u = await K.kontoKurz(uid);
  res.json({ success: true, geheimnis, otpauth: zf.otpauthAdresse(geheimnis, u?.username ?? String(uid)) });
});

// Auch mit App-Token (die Android-App richtet so ein): Wer Token und Passwort
// hat, könnte ebenso das Passwort wechseln; eine Sitzungspflicht schützte nichts.
router.post('/zweiter-faktor/bestaetigen', requireLogin, async (req, res: Antwort<'POST /api/v1/auth/zweiter-faktor/bestaetigen'>) => {
  const uid = angemeldeteNutzerId(req);
  const codes = await bestaetigeEinrichtungGebremst(uid, req.body?.code);
  if (!Array.isArray(codes)) return sendeFehler(req, res, codes.status, codes.code, codes.vars);
  const kopf = String(req.headers.authorization || '');
  const version = await beendeAndereZugaenge(uid, kopf.startsWith('Bearer ') ? kopf.slice(7) : null,
    req.session?.userId ? req.sessionID : null);
  if (req.session?.userId) req.session.sitzungsVersion = version;
  res.json({ success: true, codes });
});

router.post('/zweiter-faktor/abschalten', requireLogin, async (req, res: Antwort<'POST /api/v1/auth/zweiter-faktor/abschalten'>) => {
  const uid = angemeldeteNutzerId(req);
  if (!await zf.istAktiv(uid)) return sendeFehler(req, res, 409, 'zweiter_faktor_nicht_aktiv');
  if (!await bestaetigePasswort(req, res, uid, req.body?.password, { zweiterFaktor: req.body?.code })) return;
  await zf.schalteAb(uid);
  res.json({ success: true });
});

router.post('/zweiter-faktor/codes', requireLogin, async (req, res: Antwort<'POST /api/v1/auth/zweiter-faktor/codes'>) => {
  const uid = angemeldeteNutzerId(req);
  if (!await zf.istAktiv(uid)) return sendeFehler(req, res, 409, 'zweiter_faktor_nicht_aktiv');
  if (!await bestaetigeCode(req, res, uid, req.body?.code)) return;
  res.json({ success: true, codes: await zf.erneuereCodes(uid) });
});

// Notausgang, wenn Telefon UND Wiederherstellungscodes weg sind.
router.delete('/users/:id/zweiter-faktor', requireAdmin, async (req, res: Antwort<'DELETE /api/v1/auth/users/:id/zweiter-faktor'>) => {
  const id = parseInt(pfadParam(req, 'id'));
  if (!Number.isInteger(id)) return sendeFehler(req, res, 400, 'id_ungueltig');
  if (id === nutzerId(req)) return sendeFehler(req, res, 400, 'eigener_zweiter_faktor');
  if (!await bestaetigePasswort(req, res, angemeldeteNutzerId(req), req.body?.admin_password)) return;
  await zf.schalteAb(id);
  await protokolliere(angemeldeteNutzerId(req), id, 'zweiter_faktor_entfernt');
  res.json({ success: true });
});

// POST, weil die Route eine Nonce anlegt, die fünf Minuten ein Konto öffnet;
// ein GET liesse sich von fremden Seiten auslösen.
// Ausführlich: docs/begruendungen/routes/auth.ts.md#post-qr-token
router.post('/qr-token', requireLogin, async (req, res: Antwort<'POST /api/v1/auth/qr-token'>) => {
  // Wie /token-create: Ein QR-Code eröffnet einen neuen, langlebigen Geräte-
  // zugang. Mit einem erbeuteten Token allein darf das nicht gehen.
  if (!req.session?.userId) return sendeFehler(req, res, 403, 'nur_mit_sitzung');
  if (!await bestaetigePasswort(req, res, angemeldeteNutzerId(req), req.body?.password)) return;
  // Ohne Adresse verweigern statt raten: Eine falsche Adresse im QR-Code fiele
  // erst später in einem anderen Netz auf.
  // Ausführlich: docs/begruendungen/routes/auth.ts.md#post-qr-token-basis
  const basis = basisUrl();
  if (!basis) {
    // Der Betreiber sähe die Absage sonst in keinem Protokoll.
    hinweisOhneBasisUrl('auth:qr',
      'der QR-Code zur Verknuepfung der App laesst sich nicht erzeugen.');
    return sendeFehler(req, res, 503, 'qr_ohne_basis_url');
  }
  await K.raeumeQrTokensAuf().catch(logAndContinue('qr-token:aufräumen'));
  // Gewählt von der angemeldeten Sitzung, nicht im unangemeldeten /qr-login;
  // unbekannt heisst „keine feste Frist", ältere Clients bleiben unverändert.
  // Ausführlich: docs/begruendungen/routes/auth.ts.md#post-qr-token-tage
  const tage = laufzeitTage(req.body?.gueltigkeit);
  // „Unbegrenzt" nur, wenn die App den Server über HTTPS erreicht: Ohne TLS
  // ginge ein Token ohne Ablauf im Klartext durchs Netz.
  if (tage === UNBEGRENZT && !/^https:\/\//i.test(basis))
    return sendeFehler(req, res, 400, 'unbegrenzt_nur_https');
  const nonce = crypto.randomBytes(32).toString('base64url');
  await K.legeQrTokenAn(hashToken(nonce), nutzerId(req), new Date(Date.now() + QR_TTL_MS), tage);
  // `token_days` nennt, was gespeichert wurde, nicht was gewünscht war.
  // Ausführlich: docs/begruendungen/routes/auth.ts.md#post-qr-token-2
  // `fp` nur zu https: Die App pinnt damit die Wurzel der internen CA; ohne
  // lesbare CA-Datei vertraut sie dem System.
  const fp = /^https:\/\//i.test(basis) ? (await tlsStand())?.fp ?? null : null;
  res.json({ success: true, token: `bim:${nonce}`, expires_in: QR_TTL_MS / 1000,
    token_days: tage, url: basis, ...(fp ? { fp } : {}) });
});

// Gedrosselt, weil der Endpunkt ohne Anmeldung in die Datenbank schreibt.
router.post('/qr-login', ipThrottle('qr-login', 30, 60 * 60 * 1000), async (req, res: Antwort<'POST /api/v1/auth/qr-login'>) => {
  const { token } = req.body;
  if (typeof token !== 'string' || !token.startsWith('bim:'))
    return sendeFehler(req, res, 400, 'token_ungueltig');
  const claimed = await K.loeseQrTokenEin(hashToken(token.slice(4)));
  if (!claimed) return sendeFehler(req, res, 401, 'token_ungueltig');

  const user = await K.kontoVoll(claimed.user_id);
  if (!user) return sendeFehler(req, res, 401, 'token_ungueltig');
  const blocked = assertLoginAllowed(user);
  if (blocked) return sendeFehler(req, res, blocked.status, blocked.code);

  // Keine Sitzung: Sie trüge die vollen Rechte des Kontos an Scope `app` vorbei.
  // Die Laufzeit kommt aus der Zeile der Nonce, nicht aus der Anfrage.
  const bearerToken = await createToken(user.id, 'qr-login', true, claimed.token_days ?? null,
                                        { scope: 'app', ip: req.ip });
  res.json({ success: true, token: bearerToken, username: user.username, isAdmin: false, userId: user.id,
    user: { id: user.id, username: user.username }, token_info: await tokenAngaben(bearerToken) });
});

// Die Anmeldemaske zeigt nur Wege, die dieser Server auch kann.
router.get('/registration-status', async (_req, res: Antwort<'GET /api/v1/auth/registration-status'>) => {
  res.json({ enabled: await registrierungOffen(), passkey: !!P.vertrauenspartei(),
             passwort_vergessen: !!basisUrl() && await mailEingerichtet() });
});

router.post('/register', ipThrottle('register', 5, 60 * 60 * 1000), async (req, res: Antwort<'POST /api/v1/auth/register'>) => {
  const { username, email, first_name, last_name, password, language } = req.body;
  const lang = ['de', 'en'].includes(language) ? language : 'de';

  if (!await registrierungOffen()) return sendeFehler(req, res, 403, 'registrierung_deaktiviert');

  if (!username || !email || !password)
    return sendeFehler(req, res, 400, 'registrierung_felder');
  const mangel = passwortMangel(password, username);
  if (mangel) return sendeFehler(req, res, 400, mangel);
  if (!EMAIL_RE.test(email))
    return sendeFehler(req, res, 400, 'email_ungueltig');
  if (!USERNAME_RE.test(username))
    return sendeFehler(req, res, 400, 'benutzername_ungueltig');
  if (!nameGueltig(first_name) || !nameGueltig(last_name)) return sendeFehler(req, res, 400, 'name_ungueltig');
  // Zählt jeden Versuch, ob es die Adresse gibt oder nicht: Die Absage verrät nichts.
  const ziel = await zielGedrosselt('register-ziel', email, 3, 60 * 60 * 1000);
  if (ziel) return sendeFehler(req, res, 429, 'zu_viele_anfragen', { minuten: ziel.waitMin });

  // Vergebene Adresse oder vergebener Name: dieselbe Antwort wie bei Erfolg, sonst liesse
  // sich abfragen, wer ein Konto hat. Die Rückmeldung geht per Mail an die Adresse.
  const inhaber = await K.kontoMitEmail(email);
  const nameVergeben = !inhaber && await K.nameVergeben(username, 0);
  const basis = getBaseUrl();
  let result: { success: boolean; mode: string };
  if (inhaber) {
    await K.rechneWieRegistrierung(password);
    const sprache = String(await getSetting(inhaber.id, 'language', 'de').catch(() => 'de'));
    result = basis ? await sendRegistrierungsVersuchMail(inhaber.email, inhaber.username, sprache)
      : { success: false, mode: 'ohne_basis' };
  } else if (nameVergeben) {
    await K.rechneWieRegistrierung(password);
    result = basis ? await sendBenutzernameVergebenMail(email, lang, basis) : { success: false, mode: 'ohne_basis' };
  } else {
    const token  = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    // Nur als SHA-256: Bei einem Datenbank-Leak wäre ein ausstehender
    // Bestätigungslink sonst einlösbar.
    const neuId = await K.registriere({ username, email, first_name, last_name, passwort: password,
      tokenHash: hashToken(token), bis: expires }).catch(alsDoppelt('benutzername_oder_email_vergeben'));
    // Ohne Protokoll bliebe unklar, warum ein frisches Konto in der falschen
    // Sprache startet.
    if (neuId) await setUserSetting(neuId, 'language', lang).catch(logAndContinue(`registrierung:sprache ${neuId}`));
    result = basis ? await sendVerificationMail(email, token, basis, lang)
      : { success: false, mode: 'ohne_basis' };
  }

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
});

const RUECKSETZ_GUELTIG_MIN = 60, RUECKSETZ_PAUSE_MIN = 15, RUECKSETZ_MINDESTDAUER_MS = 400;

// Wie /forgot-password: gleiche Antwort und Dauer, ob es ein unbestätigtes Konto gibt oder nicht.
router.post('/bestaetigung-erneut', ipThrottle('bestaetigung-erneut', 5, 60 * 60 * 1000), async (req, res: Antwort<'POST /api/v1/auth/bestaetigung-erneut'>) => {
  const { email } = req.body ?? {};
  if (!email) return sendeFehler(req, res, 400, 'email_erforderlich');
  if (!basisUrl()) {
    hinweisOhneBasisUrl('bestaetigung-erneut', 'Bestätigungs-Mails werden nicht versendet.');
    return sendeFehler(req, res, 503, 'bestaetigung_nicht_eingerichtet');
  }
  const beginn = Date.now();
  const gedrosselt = await zielGedrosselt('bestaetigung-ziel', String(email), 3, 60 * 60 * 1000);
  const token = crypto.randomBytes(32).toString('hex');
  const konto = gedrosselt ? null : await K.erneuereEmailTokenWennFrei(String(email), hashToken(token), 24, RUECKSETZ_PAUSE_MIN);
  if (konto) {
    getSetting(konto.id, 'language', 'de')
      .catch(() => 'de')
      .then((lang: unknown) => sendVerificationMail(konto.email, token, getBaseUrl()!, String(lang ?? 'de')))
      .catch(logAndContinue('bestaetigung-erneut:mailversand'));
  }
  await new Promise(r => setTimeout(r, Math.max(0, RUECKSETZ_MINDESTDAUER_MS - (Date.now() - beginn))));
  res.json({ success: true, message: fehlerText('bestaetigung_gesendet', antwortSprache(req)) });
});

router.post('/forgot-password', ipThrottle('forgot-password', 5, 60 * 60 * 1000), async (req, res: Antwort<'POST /api/v1/auth/forgot-password'>) => {
  const { email } = req.body;
  if (!email) return sendeFehler(req, res, 400, 'email_erforderlich');
  // Vor der Nutzersuche, damit die Absage nichts über die Adresse verrät.
  if (!basisUrl()) {
    hinweisOhneBasisUrl('passwort-reset', 'Passwort-vergessen-Mails werden nicht versendet.');
    return sendeFehler(req, res, 503, 'passwort_reset_nicht_eingerichtet');
  }
  // Immer dieselbe Antwort nach derselben Mindestdauer: Weder Inhalt noch Zeit
  // verraten, ob es die Adresse gibt.
  const beginn = Date.now();
  // Über der Grenze still keine Mail: Eine Absage verriete, dass jemand die Adresse bedrängt.
  const gedrosselt = await zielGedrosselt('forgot-ziel', String(email), 3, 60 * 60 * 1000);
  const user = gedrosselt ? null : await K.aktivesKontoNachEmail(email);
  const token = crypto.randomBytes(32).toString('hex');
  // Höchstens ein Link je Konto und RUECKSETZ_PAUSE_MIN: Sonst flutet ein Fremder das Postfach.
  if (user && await K.setzeRuecksetzTokenWennFrei(user.id, hashToken(token), RUECKSETZ_GUELTIG_MIN, RUECKSETZ_PAUSE_MIN)) {
    // Nicht awaiten, sonst verriete die Dauer des SMTP-Versands die Adresse.
    // Ausführlich: docs/begruendungen/routes/auth.ts.md#post-forgot-password-2
    getSetting(user.id, 'language', 'de')
      .catch(() => 'de')
      // An die GESPEICHERTE Adresse: Die eingegebene passt per LOWER() auch als Unicode-Variante.
      .then((lang: unknown) => sendPasswordResetMail(
        user.email ?? '', token, getBaseUrl()!, String(lang ?? 'de')))
      .catch(logAndContinue('forgot-password:mailversand'));
  }
  await new Promise(r => setTimeout(r, Math.max(0, RUECKSETZ_MINDESTDAUER_MS - (Date.now() - beginn))));
  res.json({ success: true, message: 'Falls die E-Mail existiert, wurde ein Link gesendet.' });
});

router.post('/reset-password', ipThrottle('reset-password', 10, 60 * 60 * 1000), async (req, res: Antwort<'POST /api/v1/auth/reset-password'>) => {
  const { token, password } = req.body;
  if (!token || !password) return sendeFehler(req, res, 400, 'token_passwort_erforderlich');
  const mangel = passwortMangel(password);
  if (mangel) return sendeFehler(req, res, 400, mangel);
  const user = await K.kontoNachRuecksetzToken(hashToken(token));
  if (!user) return sendeFehler(req, res, 400, 'token_ungueltig');
  await K.setzePasswortZurueck(user.id, password);
  hinweisNebenher(user.id, 'passwort_zurueckgesetzt');
  res.json({ success: true, message: 'Passwort erfolgreich geändert.' });
});


// ── Passkeys: Verwalten im Konto, Anmelden auf der Anmeldeseite ─────────────
const NAME_MAX = 60;
const passkeyName = (roh: unknown) =>
  (typeof roh === 'string' && roh.trim() ? Array.from(roh.trim()).slice(0, NAME_MAX).join('') : 'Passkey');

router.get('/passkeys', requireLoginOrToken, async (req, res: Antwort<'GET /api/v1/auth/passkeys'>) => {
  res.json({ success: true, verfuegbar: !!P.vertrauenspartei(),
    passkeys: await P.passkeysDesKontos(angemeldeteNutzerId(req)) });
});

// Ein neuer Anmeldeweg verlangt Passwort und Browser-Sitzung: Eine erbeutete
// Sitzung oder ein Token allein soll keinen dauerhaften Zugang prägen.
router.post('/passkey/registrieren/optionen', requireLoginOrToken, async (req, res: Antwort<'POST /api/v1/auth/passkey/registrieren/optionen'>) => {
  if (!perSitzung(req)) return sendeFehler(req, res, 403, 'nur_mit_sitzung');
  const uid = angemeldeteNutzerId(req);
  // Ein Passkey ersetzt den Code; ohne Code hier umginge das Passwort allein den zweiten Faktor.
  const zusatz = await zf.istAktiv(uid) ? { zweiterFaktor: req.body?.code } : {};
  if (!await bestaetigePasswort(req, res, uid, req.body?.password, zusatz)) return;
  const konto = await K.kontoKurz(uid);
  const optionen = await P.registrierungsOptionen(uid, konto?.username ?? String(uid));
  if (!optionen) return sendeFehler(req, res, 503, 'passkey_ohne_domain');
  res.json({ success: true, optionen });
});

router.post('/passkey/registrieren', requireLoginOrToken, async (req, res: Antwort<'POST /api/v1/auth/passkey/registrieren'>) => {
  if (!perSitzung(req)) return sendeFehler(req, res, 403, 'nur_mit_sitzung');
  const neu = await P.registrierungPruefen(angemeldeteNutzerId(req), req.body?.antwort, passkeyName(req.body?.name));
  if (!neu) return sendeFehler(req, res, 400, 'passkey_ungueltig');
  hinweisNebenher(angemeldeteNutzerId(req), 'passkey_neu', neu.name);
  res.json({ success: true, passkey: neu });
});

router.delete('/passkeys/:id', requireLoginOrToken, async (req, res: Antwort<'DELETE /api/v1/auth/passkeys/:id'>) => {
  const uid = angemeldeteNutzerId(req);
  const id = parseInt(pfadParam(req, 'id'));
  if (!Number.isInteger(id)) return sendeFehler(req, res, 400, 'id_ungueltig');
  if (!await bestaetigeMitFaktor(req, res, uid, req.body?.password, req.body?.code)) return;
  res.json({ success: true, deleted: await P.loeschePasskey(uid, id) ? 1 : 0 });
});

// Öffentlich; die Drossel begrenzt, wie viele Challenges eine Adresse anlegt.
router.post('/passkey/anmelden/optionen', ipThrottle('passkey-optionen', 60, 60 * 60 * 1000), async (req, res: Antwort<'POST /api/v1/auth/passkey/anmelden/optionen'>) => {
  const zweck = req.body?.zweck === 'zweiter_faktor' ? 'zweiter_faktor' : 'anmelden';
  const optionen = await P.anmeldeOptionen(zweck);
  if (!optionen) return sendeFehler(req, res, 503, 'passkey_ohne_domain');
  res.json({ success: true, optionen });
});

/** Die Sitzung für den Browser; einen Token nur auf `mit_token`, wie ihn die App braucht. */
router.post('/passkey/anmelden', ipThrottle('passkey-anmelden', 30, 60 * 60 * 1000), async (req, res: Antwort<'POST /api/v1/auth/passkey/anmelden'>) => {
  const uid = await P.anmeldungPruefen(req.body?.antwort, 'anmelden');
  if (!uid) return sendeFehler(req, res, 401, 'passkey_ungueltig');
  const user = await K.kontoVoll(uid);
  if (!user) return sendeFehler(req, res, 401, 'passkey_ungueltig');
  const gesperrt = assertLoginAllowed(user);
  if (gesperrt) return sendeFehler(req, res, gesperrt.status, gesperrt.code);
  await angemeldetAntworten(req, res, user, req.body?.mit_token === true);
});

router.use(fehlerAntwort);

export = Object.assign(router, { requireLogin, requireAdmin });
