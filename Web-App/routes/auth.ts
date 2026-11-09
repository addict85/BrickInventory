/** Anmeldung, Token, Profil, QR und Passkeys; setzt die Teilrouter aus
 * routes/auth/ zusammen. Alles hängt unter /api/v1/auth. */
import { sitzungsKeksName, sitzungsKeksOptionen } from '../src/http/sitzungsKeks';
const router  = vertragsRouter();
import * as K from '../src/konto/konten';
import { meldeHaushaltsaenderung } from '../src/haushalt/haushalt';
import { logAndContinue, meldeFehler, fehlertext, meldeUndLiefere } from '../src/infra/fehler';
import { fehlerAntwort } from '../src/http/httpAntwort';
import { hashToken, createToken, pruefeToken, assertLoginAllowed, revokeAllSessions, deleteToken, USERNAME_RE, emailGueltig, leereTokenCache, laufzeitTage, rotiereToken, rotationFaellig, UNBEGRENZT, UEBERLAPPUNG_MS, nameGueltig, geraeteNameGueltig, geraeteNameInhaltGueltig } from '../src/konto/auth';
import { APP_HOECHSTDAUER_TAGE, tokenAngaben, tokenLabel, tokenScope } from '../src/konto/tokenWunsch';
import * as QR from '../src/konto/qrKopplung';
import { kontoGedrosselt } from '../src/konto/zielDrossel';
import { meldeAnmeldung } from '../src/konto/loginLimiter';
import { perSitzung, anmelden, establishSession, requireLoginOrToken, nutzerId, angemeldeteNutzerId, ipThrottle, bestaetigeMitFaktor, zweiterFaktorPflicht } from '../src/konto/http/anmeldung';
import { tlsStand } from '../src/infra/tlsWurzel';
import { hinweisNebenher } from '../src/konto/kontoHinweis';
import crypto from 'crypto';
import { passwortMangel } from '../src/infra/passwortRegel';
import { sendEmailGeaendertMail, sendRegistrierungsVersuchMail, sendVerificationMail } from '../src/mail/mailer';
import type { Request, Response } from 'express';
import { getSetting } from '../src/einstellungen/settings';
import { requireApiAdmin } from './api_v1/middleware';
import { sendeFehler, fehlerText, antwortSprache } from '../src/infra/fehlerTexte';
import { basisUrl, hinweisOhneBasisUrl, mailBasisUrl, ueberTls, unbegrenztNurMitTls } from '../src/infra/basisUrl';
import * as zf from '../src/konto/zweiterFaktor';
import * as P from '../src/konto/passkeys';
import { loescheKontoDateien } from '../src/gutscheine/gutscheinDateien';
import { vertragsRouter } from '../src/vertrag/pruefen';
import type { Antwort, OffeneAnfrage } from '../src/vertrag';
import benutzerRouter = require('./auth/benutzer');
import zweiterFaktorRouter = require('./auth/zweiterFaktor');
import registrierungRouter = require('./auth/registrierung');

// Ein Wächter für Sitzung UND Token: Die App hat keine Sitzung und war mit
// einem reinen Sitzungswächter von Routen ausgesperrt. Ausführlich: docs/begruendungen/routes/auth.ts.md#requirelogin
const requireLogin = requireLoginOrToken;
const requireAdmin = requireApiAdmin;
type Angemeldet = { id: number | string; username: string; is_admin: boolean; must_change_password?: boolean };

/** Sitzung, Token und Antwort — derselbe Weg nach Passwort und Passkey. */
/** Wie der Token heissen und gelten soll; beide Anmeldewege prüft der Vertrag. */
type TokenWunsch = { label?: unknown; never_expires?: boolean | undefined; scope?: string | undefined };

async function angemeldetAntworten(req: Request, res: Response, user: Angemeldet, wunsch: TokenWunsch, mitToken: boolean, mitPasswort = false) {
  const { label, never_expires, scope } = wunsch;
  const uid = Number(user.id);
  // Token ODER Sitzung: Die Sitzung trüge die vollen Rechte am Scope des Tokens vorbei.
  if (!mitToken) await establishSession(req, {
    userId:   uid,
    username: user.username,
    isAdmin:  user.is_admin,
    mussPasswortAendern: user.must_change_password === true,
    // Nur nach einem Passwort, nicht nach einem Passkey allein: Grundlage der Gnadenfrist.
    ...(mitPasswort ? { passwortBestaetigtAm: Date.now() } : {}),
  });
  // Ein Token, den die Datenbank nie sah, liefe im SSE-Kanal in ein 401.
  const dauerhaft = never_expires === true;
  let token: string | null = null;
  // Die Webapp nur mit httpOnly-Cookie: Ein Token wäre per Skript auslesbar.
  if (mitToken) {
    token = await createToken(uid, tokenLabel(label, 'webapp-session'), dauerhaft, dauerhaft ? APP_HOECHSTDAUER_TAGE : null,
                              { scope: tokenScope(scope), ip: req.ip })
      .catch((e: unknown) => { console.warn('[login] Token konnte nicht gespeichert werden:', fehlertext(e)); return null; });
    if (!token) return sendeFehler(req, res, 500, 'token_nicht_ausgestellt');
    // Ein neues Gerät wie bei token-create und qr-token: Der Inhaber soll es merken.
    hinweisNebenher(uid, 'token_neu', tokenLabel(label, 'webapp-session'));
  }
  // Verwalterrechte trägt die Sitzung und ein Token mit Scope `voll`, nicht `app`.
  const verwalter = user.is_admin && (!mitToken || tokenScope(scope) === 'voll');
  // `never_expires` nennt, was gilt: Mit gleitender Frist ist nichts unbegrenzt.
  res.json({ success: true, ...(token ? { token } : {}), ...(token ? { token_info: await tokenAngaben(token) } : {}),
    never_expires: false,
    user: { id: user.id, username: user.username, is_admin: user.is_admin,
    // Startpasswort (db/database.ts) oder vom Verwalter vergeben (routes/auth/benutzer.ts).
    mustChangePassword: user.must_change_password,
    zweiterFaktorPflicht: verwalter && !await zf.istAktiv(uid) } });
}

/** Die EINE Anmeldung für Webapp und App, damit beide dieselben Regeln erfüllen.
 * Ausführlich: docs/begruendungen/routes/auth.ts.md#post-login */
router.post('/login', async (req: OffeneAnfrage<'POST /api/v1/auth/login'>, res: Antwort<'POST /api/v1/auth/login'>) => {
  const { username, password, code: zweiterCode, ohne_token, passkey } = req.eingabe;
  if (!geraeteNameInhaltGueltig(req.eingabe.label)) return sendeFehler(req, res, 400, 'geraetename_ungueltig');
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
  await angemeldetAntworten(req, res, pruefung.user as Angemeldet, req.eingabe, ohne_token !== true, true);
});

/** Sitzung beenden UND Token entwerten, damit ein Aufruf beides wegräumt.
 * Ausführlich: docs/begruendungen/routes/auth.ts.md#post-logout */
router.post('/logout', async (req: OffeneAnfrage<'POST /api/v1/auth/logout'>, res: Antwort<'POST /api/v1/auth/logout'>) => {
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
router.get('/me', async (req: OffeneAnfrage<'GET /api/v1/auth/me'>, res: Antwort<'GET /api/v1/auth/me'>) => {
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const ungueltig = (code: 'token_ungueltig' | 'token_rotation_noetig' | 'zu_viele_anfragen') =>
    res.status(code === 'zu_viele_anfragen' ? 429 : 401).json({ success: false, loggedIn: false, user: null,
      code, error: fehlerText(code, antwortSprache(req), code === 'zu_viele_anfragen' ? { minuten: 1 } : undefined) });
  const antworte = async () => {
    if (req.session?.userId) {
      const user = await K.kontoKurz(req.session.userId);
      if (user) return res.json({ success: true, loggedIn: true,
        user: { id: user.id, username: user.username, is_admin: user.is_admin, mustChangePassword: user.must_change_password,
                zweiterFaktorPflicht: await zweiterFaktorPflicht(req) } });
    }
    const p = token ? await pruefeToken(token, { ip: req.ip }) : { nutzer: null };
    const u = p.nutzer;
    if (u) {
      const faellig = rotationFaellig(u);
      if (faellig) res.setHeader('X-Token-Rotation', 'faellig');
      // is_admin ist das Recht DIESES Tokens: bei Scope `app` immer false.
      return res.json({ success: true, loggedIn: true,
        user: { id: u.user_id, username: u.username, is_admin: u.is_admin === 1, mustChangePassword: u.muss_passwort_aendern === true,
                zweiterFaktorPflicht: u.is_admin === 1 && !await zf.istAktiv(u.user_id) },
        token_expires: u.expires_at, token_last_used: u.last_used,
        token_info: { scope: u.scope, expires_at: u.expires_at, hard_expires_at: u.hard_expires_at ?? null,
                      never_expires: u.never_expires === true, rotiert_am: u.rotiert_am,
                      rotation_faellig: faellig } });
    }
    if (token) return ungueltig('grund' in p && p.grund ? p.grund : 'token_ungueltig');
    return res.json({ success: true, loggedIn: false, user: null });
  };
  await antworte().catch((e: unknown) => {
    // Ohne Anmeldung ist die Anmeldemaske die richtige Antwort, keine Fehlerseite.
    meldeFehler('auth:me', e);
    if (token) return ungueltig('token_ungueltig');
    return res.json({ success: true, loggedIn: false, user: null });
  });
});

/** Öffentlich, weil ein unbegrenzter Token nach der Pflichtfrist nur noch hier
 * gilt; die Prüfung steht deshalb hier. */
router.post('/token-rotieren', ipThrottle('token-rotieren', 120, 60 * 60 * 1000), async (req: OffeneAnfrage<'POST /api/v1/auth/token-rotieren'>, res: Antwort<'POST /api/v1/auth/token-rotieren'>) => {
  const auth = String(req.headers.authorization || '');
  const alt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!alt || !(await pruefeToken(alt, { ip: req.ip, zweck: 'rotation' })).nutzer)
    return sendeFehler(req, res, 401, 'token_ungueltig');
  const t = await rotiereToken(alt, req.ip);
  if (t === 'laeuft') return sendeFehler(req, res, 409, 'tausch_laeuft');
  if (!t) return sendeFehler(req, res, 401, 'token_ungueltig');
  res.json({ success: true, token: t.token,
    token_info: { scope: t.scope, expires_at: t.expires_at, hard_expires_at: t.hard_expires_at,
                  never_expires: t.never_expires, rotiert_am: t.rotiert_am, rotation_faellig: false },
    alt_gueltig_bis: t.alt_gueltig_bis, ueberlappung_sek: UEBERLAPPUNG_MS / 1000 });
});

/** Nur aus einer Sitzung, mit Passwort und zweitem Faktor: Sonst prägte ein
 * erbeuteter Zugang einen dauerhaften. Die Mail meldet ihn dem Inhaber. */
router.post('/token-create', requireLogin, async (req: OffeneAnfrage<'POST /api/v1/auth/token-create'>, res: Antwort<'POST /api/v1/auth/token-create'>) => {
  if (!req.session?.userId) return sendeFehler(req, res, 403, 'nur_mit_sitzung');
  if (!geraeteNameInhaltGueltig(req.eingabe.label)) return sendeFehler(req, res, 400, 'geraetename_ungueltig');
  const userId = angemeldeteNutzerId(req);
  if (!await bestaetigeMitFaktor(req, res, userId, req.eingabe.password)) return;
  const label = tokenLabel(req.eingabe.label, 'Android App');
  const neu = await createToken(userId, label, true, null, { scope: tokenScope(req.eingabe.scope), ip: req.ip });
  hinweisNebenher(userId, 'token_neu', label);
  res.json({ success: true, token: neu, label, never_expires: false, token_info: await tokenAngaben(neu) });
});

router.get('/profile', requireLogin, async (req: OffeneAnfrage<'GET /api/v1/auth/profile'>, res: Antwort<'GET /api/v1/auth/profile'>) => {
  const user = await K.profil(nutzerId(req)!);
  if (!user) return sendeFehler(req, res, 404, 'benutzer_nicht_gefunden');
  res.json({ success: true, user });
});

router.put('/profile', requireLogin, async (req: OffeneAnfrage<'PUT /api/v1/auth/profile'>, res: Antwort<'PUT /api/v1/auth/profile'>) => {
  const { username, email, first_name, last_name, password, password_current } = req.eingabe;
  const user = await K.kontoVoll(nutzerId(req)!);
  if (!user) return sendeFehler(req, res, 404, 'benutzer_nicht_gefunden');

  // Das Passwort nur über /change-password: Nur dort werden danach alle
  // übrigen Sitzungen und Token verworfen.
  if (password) return sendeFehler(req, res, 400, 'passwort_ueber_change_password');

  // Dieselbe Regex wie Login/Register: Sonst liesse sich eine fremde E-Mail als
  // Benutzername eintragen, und der Login sucht „username ODER email".
  if (username !== undefined && !USERNAME_RE.test(String(username || '')))
    return sendeFehler(req, res, 400, 'benutzername_ungueltig');
  if (!nameGueltig(first_name) || !nameGueltig(last_name)) return sendeFehler(req, res, 400, 'name_ungueltig');

  const nameNeu = username && username.toLowerCase() !== String(user.username || '').toLowerCase();
  const emailChanged = email && email.toLowerCase() !== String(user.email || '').toLowerCase();
  if (emailChanged && !emailGueltig(email))
    return sendeFehler(req, res, 400, 'email_ungueltig');
  // Jede Änderung mit Passwort (und zweitem Faktor): Über eine neue Adresse liesse
  // sich das Passwort zurücksetzen, und erst danach verrät die Vergabeprüfung, ob
  // es einen Namen oder eine Adresse schon gibt.
  if (!password_current) return sendeFehler(req, res, 400, 'aktuelles_passwort_erforderlich');
  if (!await bestaetigeMitFaktor(req, res, user.id, String(password_current))) return;
  if (nameNeu || emailChanged) {
    // Jede Vergabeprüfung verrät, ob es ein Konto gibt; die Registrierung verbirgt das.
    const zuOft = await kontoGedrosselt('profil-vergabe', user.id, 10, 60 * 60 * 1000);
    if (zuOft) return sendeFehler(req, res, 429, 'zu_viele_anfragen', { minuten: zuOft.waitMin });
    // Case-insensitiv und auch gegen die E-Mail-Spalte, weil der Login mit LOWER() beide vergleicht.
    if (nameNeu && await K.nameVergeben(username, user.id)) return sendeFehler(req, res, 400, 'benutzername_vergeben');
  }

  const felder: Record<string, unknown> = {};
  if (username) felder.username = username;
  if (first_name !== undefined) felder.first_name = first_name || null;
  if (last_name  !== undefined) felder.last_name  = last_name  || null;
  if (emailChanged) {
    // Auch für Verwalter: Ob die Adresse dem Inhaber gehört, zeigt erst der Link.
    // Bis dahin gilt die alte, und die neue belegt nichts.
    const token   = crypto.randomBytes(32).toString('hex');
    await K.merkeEmailNeu(user.id, email, hashToken(token), new Date(Date.now() + 24*60*60*1000));
    await K.aendereProfil(user.id, felder);
    // Sprache des Kontos, nicht die Vorgabe. Ausführlich: docs/begruendungen/routes/auth.ts.md#put-profile-emailsent
    let emailSent = false;
    const lang = String(await getSetting(user.id, 'language', 'de').catch(meldeUndLiefere('anmeldung:sprache', 'de')));
    const basis = mailBasisUrl();
    // Belegt antwortet wie frei, sonst liessen sich Adressen abfragen; der Inhaber
    // bekommt einen Hinweis statt des Links (uebernimmEmailNeu() wiese ihn ab).
    const inhaber = await K.kontoMitEmail(email);
    if (inhaber && inhaber.id !== user.id) {
      const sprache = String(await getSetting(inhaber.id, 'language', 'de').catch(meldeUndLiefere('anmeldung:sprache', 'de')));
      if (basis) emailSent = await sendRegistrierungsVersuchMail(inhaber.email, sprache, 'adresse')
        .then(r => r.success, meldeUndLiefere('anmeldung:versuchsmail', false));
    } else if (basis) emailSent = await sendVerificationMail(email, token, basis, lang, 'adresse')
      .then(r => r.success, meldeUndLiefere('anmeldung:bestaetigungsmail', false));
    // Die alte Adresse erfährt davon — war es nicht der Inhaber, merkt er es so.
    if (user.email) await sendEmailGeaendertMail(user.email, user.username, email, lang)
      .catch((e: unknown) => meldeFehler('anmeldung:hinweis-alte-adresse', e));
    return res.json({ success: true, emailChanged: true, emailSent });
  }

  await K.aendereProfil(user.id, felder);
  res.json({ success: true });
});

// Das eigene Konto, endgültig: Passwort und, falls eingerichtet, zweiter Faktor.
router.delete('/konto', requireLogin, async (req: OffeneAnfrage<'DELETE /api/v1/auth/konto'>, res: Antwort<'DELETE /api/v1/auth/konto'>) => {
  const uid = angemeldeteNutzerId(req);
  if (!await bestaetigeMitFaktor(req, res, uid, req.eingabe.password)) return;
  if (!await K.loescheEigenesKonto(uid)) return sendeFehler(req, res, 409, 'letzter_verwalter');
  await revokeAllSessions(uid);
  await loescheKontoDateien(uid);
  leereTokenCache();
  meldeHaushaltsaenderung();
  console.log(`[konto] Konto ${uid} hat sich selbst gelöscht`);
  req.session.destroy(() => res.clearCookie(sitzungsKeksName(), sitzungsKeksOptionen()).json({ success: true }));
});

router.post('/change-password', requireLogin, async (req: OffeneAnfrage<'POST /api/v1/auth/change-password'>, res: Antwort<'POST /api/v1/auth/change-password'>) => {
  const { current, newPassword } = req.eingabe;
  if (!current || !newPassword) return sendeFehler(req, res, 400, 'alle_felder_erforderlich');
  const uid = nutzerId(req);
  if (uid == null) return sendeFehler(req, res, 401, 'nicht_angemeldet');
  if (!await bestaetigeMitFaktor(req, res, uid, String(current))) return;
  // NACH der Prüfung des alten Passworts: Ein Fremder erfährt über das neue nichts.
  // Der Name aus der Tabelle: Mit App-Token gibt es keine Sitzung, die ihn trägt.
  const konto = await K.kontoKurz(uid);
  const mangel = passwortMangel(newPassword, konto?.username);
  if (mangel) return sendeFehler(req, res, 400, mangel);
  // Beendet alle Zugänge, auch den eigenen; die Sitzung wird danach neu aufgebaut.
  await K.aendereEigenesPasswort(uid, newPassword, { passkeysWiderrufen: req.eingabe.passkeys_widerrufen === true });
  hinweisNebenher(uid, 'passwort_geaendert');
  if (req.session?.userId && konto) {
    await establishSession(req, { userId: uid, username: konto.username, isAdmin: req.session.isAdmin === true,
                                  mussPasswortAendern: false, passwortBestaetigtAm: Date.now() });
  }
  res.json({ success: true });
});

// Der QR-Code trägt nur eine einmalige Nonce (SHA-256 in qr_login_tokens),
// kein Geheimnis des Kontos; den Ablauf beschreibt src/konto/qrKopplung.ts.
// POST, weil die Route eine Nonce anlegt; ein GET liesse sich von fremden Seiten auslösen.
router.post('/qr-token', requireLogin, async (req: OffeneAnfrage<'POST /api/v1/auth/qr-token'>, res: Antwort<'POST /api/v1/auth/qr-token'>) => {
  // Wie /token-create: Ein QR-Code eröffnet einen neuen, langlebigen Geräte-
  // zugang; nur aus der Sitzung, mit Passwort und zweitem Faktor.
  if (!req.session?.userId) return sendeFehler(req, res, 403, 'nur_mit_sitzung');
  if (!await bestaetigeMitFaktor(req, res, angemeldeteNutzerId(req), req.eingabe.password)) return;
  // Ohne Adresse verweigern statt raten: Eine falsche Adresse im QR-Code fiele
  // erst später in einem anderen Netz auf. Ausführlich: docs/begruendungen/routes/auth.ts.md#post-qr-token-basis
  const basis = basisUrl();
  if (!basis) {
    // Der Betreiber sähe die Absage sonst in keinem Protokoll.
    hinweisOhneBasisUrl('auth:qr',
      'der QR-Code zur Verknuepfung der App laesst sich nicht erzeugen.');
    return sendeFehler(req, res, 503, 'qr_ohne_basis_url');
  }
  // Gewählt von der angemeldeten Sitzung, nicht im unangemeldeten /qr-login.
  // Ausführlich: docs/begruendungen/routes/auth.ts.md#post-qr-token-tage
  const tage = laufzeitTage(req.eingabe.gueltigkeit) ?? APP_HOECHSTDAUER_TAGE;
  if (tage === UNBEGRENZT) unbegrenztNurMitTls(basis);
  const { token, kopplung } = await QR.erzeuge(angemeldeteNutzerId(req), tage);
  hinweisNebenher(angemeldeteNutzerId(req), 'qr_zugang_neu');
  // `fp` nur mit TLS: Die App pinnt damit die Wurzel der internen CA.
  const ca = ueberTls(basis) ? await tlsStand() : null;
  res.json({ success: true, token, kopplung, expires_in: QR.QR_TTL_MS / 1000,
    token_days: tage, url: basis, ...(ca ? { fp: ca.fp, zert_sha256: ca.zert_sha256 } : {}) });
});

/** Das Konto muss bei der Meldung und bei der Abholung noch anmelden dürfen. */
async function darfAnmelden(uid: number): Promise<boolean> {
  const user = await K.kontoVoll(uid);
  return !!user && !assertLoginAllowed(user);
}

// Gedrosselt, weil der Endpunkt ohne Anmeldung in die Datenbank schreibt.
router.post('/qr-login', ipThrottle('qr-login', 30, 60 * 60 * 1000), async (req: OffeneAnfrage<'POST /api/v1/auth/qr-login'>, res: Antwort<'POST /api/v1/auth/qr-login'>) => {
  const { token, label } = req.eingabe;
  if (!token?.startsWith('bim:')) return sendeFehler(req, res, 400, 'token_ungueltig');
  if (!geraeteNameInhaltGueltig(label)) return sendeFehler(req, res, 400, 'geraetename_ungueltig');
  const m = await QR.meldeGeraet(token, label, req.ip);
  if (!m || !await darfAnmelden(m.uid)) return sendeFehler(req, res, 401, 'token_ungueltig');
  res.json({ success: true, wartet: true, abholung: m.abholung, code: m.code, expires_in: QR.QR_TTL_MS / 1000 });
});

// Die App fragt alle paar Sekunden, bis die Web-Sitzung bestätigt oder ablehnt.
router.post('/qr-login/abholen', ipThrottle('qr-abholen', 600, 60 * 60 * 1000), async (req: OffeneAnfrage<'POST /api/v1/auth/qr-login/abholen'>, res: Antwort<'POST /api/v1/auth/qr-login/abholen'>) => {
  if (!req.eingabe.abholung) return sendeFehler(req, res, 400, 'token_ungueltig');
  const a = await QR.holeAb(req.eingabe.abholung, req.ip, darfAnmelden);
  if (a.stand === 'wartet') return res.json({ success: true, wartet: true });
  if (a.stand === 'abgelehnt') return sendeFehler(req, res, 403, 'qr_abgelehnt');
  if (a.stand !== 'fertig') return sendeFehler(req, res, 401, 'token_ungueltig');
  const user = await K.kontoKurz(a.uid);
  if (!user) return sendeFehler(req, res, 401, 'token_ungueltig');
  meldeAnmeldung({ ip: req.ip, konto: user.id, zugang: 'qr' });
  // Keine Sitzung: Sie trüge die vollen Rechte des Kontos an Scope `app` vorbei.
  res.json({ success: true, wartet: false, token: a.token, username: user.username, isAdmin: false, userId: user.id,
    user: { id: user.id, username: user.username }, token_info: await tokenAngaben(a.token) });
});

router.get('/qr-kopplung/:id', requireLogin, async (req: OffeneAnfrage<'GET /api/v1/auth/qr-kopplung/:id'>, res: Antwort<'GET /api/v1/auth/qr-kopplung/:id'>) => {
  if (!req.session?.userId) return sendeFehler(req, res, 403, 'nur_mit_sitzung');
  const s = await QR.stand(req.pfad.id, angemeldeteNutzerId(req));
  if (!s) return sendeFehler(req, res, 404, 'nicht_gefunden');
  res.json({ success: true, ...s });
});

const BESTAETIGUNG_FEHLER = { code_falsch: [400, 'qr_code_falsch'], abgelehnt: [403, 'qr_abgelehnt'],
  nicht_wartend: [409, 'qr_nicht_wartend'], unbekannt: [404, 'nicht_gefunden'] } as const;

router.post('/qr-kopplung/:id/bestaetigen', requireLogin, async (req: OffeneAnfrage<'POST /api/v1/auth/qr-kopplung/:id/bestaetigen'>, res: Antwort<'POST /api/v1/auth/qr-kopplung/:id/bestaetigen'>) => {
  if (!req.session?.userId) return sendeFehler(req, res, 403, 'nur_mit_sitzung');
  const uid = angemeldeteNutzerId(req);
  const ergebnis = await QR.bestaetige(req.pfad.id, uid, req.eingabe.code);
  if (ergebnis !== 'ok') {
    const [status, code] = BESTAETIGUNG_FEHLER[ergebnis];
    return sendeFehler(req, res, status, code);
  }
  const s = await QR.stand(req.pfad.id, uid);
  hinweisNebenher(uid, 'token_neu', s?.geraet ?? 'qr-login');
  res.json({ success: true });
});

router.post('/qr-kopplung/:id/ablehnen', requireLogin, async (req: OffeneAnfrage<'POST /api/v1/auth/qr-kopplung/:id/ablehnen'>, res: Antwort<'POST /api/v1/auth/qr-kopplung/:id/ablehnen'>) => {
  if (!req.session?.userId) return sendeFehler(req, res, 403, 'nur_mit_sitzung');
  if (!await QR.lehneAb(req.pfad.id, angemeldeteNutzerId(req))) return sendeFehler(req, res, 404, 'nicht_gefunden');
  res.json({ success: true });
});

// ── Passkeys: Verwalten im Konto, Anmelden auf der Anmeldeseite ─────────────
const NAME_MAX = 60;
const passkeyName = (roh: unknown) =>
  (typeof roh === 'string' && roh.trim() ? Array.from(roh.trim()).slice(0, NAME_MAX).join('') : 'Passkey');

router.get('/passkeys', requireLoginOrToken, async (req: OffeneAnfrage<'GET /api/v1/auth/passkeys'>, res: Antwort<'GET /api/v1/auth/passkeys'>) => {
  res.json({ success: true, verfuegbar: !!P.vertrauenspartei(),
    passkeys: await P.passkeysDesKontos(angemeldeteNutzerId(req)) });
});

// Ein neuer Anmeldeweg verlangt Passwort und Browser-Sitzung: Eine erbeutete
// Sitzung oder ein Token allein soll keinen dauerhaften Zugang prägen.
router.post('/passkey/registrieren/optionen', requireLoginOrToken, async (req: OffeneAnfrage<'POST /api/v1/auth/passkey/registrieren/optionen'>, res: Antwort<'POST /api/v1/auth/passkey/registrieren/optionen'>) => {
  if (!perSitzung(req)) return sendeFehler(req, res, 403, 'nur_mit_sitzung');
  const uid = angemeldeteNutzerId(req);
  if (!await bestaetigeMitFaktor(req, res, uid, req.eingabe.password)) return;
  const konto = await K.kontoKurz(uid);
  const optionen = await P.registrierungsOptionen(uid, konto?.username ?? String(uid));
  if (!optionen) return sendeFehler(req, res, 503, 'passkey_ohne_domain');
  res.json({ success: true, optionen });
});

router.post('/passkey/registrieren', requireLoginOrToken, async (req: OffeneAnfrage<'POST /api/v1/auth/passkey/registrieren'>, res: Antwort<'POST /api/v1/auth/passkey/registrieren'>) => {
  if (!perSitzung(req)) return sendeFehler(req, res, 403, 'nur_mit_sitzung');
  if (!geraeteNameGueltig(req.eingabe.name)) return sendeFehler(req, res, 400, 'geraetename_ungueltig');
  const neu = await P.registrierungPruefen(angemeldeteNutzerId(req), req.eingabe.antwort, passkeyName(req.eingabe.name));
  if (!neu) return sendeFehler(req, res, 400, 'passkey_ungueltig');
  hinweisNebenher(angemeldeteNutzerId(req), 'passkey_neu', neu.name);
  res.json({ success: true, passkey: neu });
});

router.delete('/passkeys/:id', requireLoginOrToken, async (req: OffeneAnfrage<'DELETE /api/v1/auth/passkeys/:id'>, res: Antwort<'DELETE /api/v1/auth/passkeys/:id'>) => {
  const uid = angemeldeteNutzerId(req);
  const id = req.pfad.id;
  if (!Number.isInteger(id)) return sendeFehler(req, res, 400, 'id_ungueltig');
  if (!await bestaetigeMitFaktor(req, res, uid, req.eingabe.password)) return;
  res.json({ success: true, deleted: await P.loeschePasskey(uid, id) ? 1 : 0 });
});

// Öffentlich; die Drossel begrenzt, wie viele Challenges eine Adresse anlegt.
router.post('/passkey/anmelden/optionen', ipThrottle('passkey-optionen', 60, 60 * 60 * 1000), async (req: OffeneAnfrage<'POST /api/v1/auth/passkey/anmelden/optionen'>, res: Antwort<'POST /api/v1/auth/passkey/anmelden/optionen'>) => {
  const zweck = req.eingabe.zweck === 'zweiter_faktor' ? 'zweiter_faktor' : 'anmelden';
  const optionen = await P.anmeldeOptionen(zweck);
  if (!optionen) return sendeFehler(req, res, 503, 'passkey_ohne_domain');
  res.json({ success: true, optionen });
});

/** Die Sitzung für den Browser; einen Token nur auf `mit_token`, wie ihn die App braucht. */
router.post('/passkey/anmelden', ipThrottle('passkey-anmelden', 30, 60 * 60 * 1000), async (req: OffeneAnfrage<'POST /api/v1/auth/passkey/anmelden'>, res: Antwort<'POST /api/v1/auth/passkey/anmelden'>) => {
  if (!geraeteNameInhaltGueltig(req.eingabe.label)) return sendeFehler(req, res, 400, 'geraetename_ungueltig');
  const uid = await P.anmeldungPruefen(req.eingabe.antwort, 'anmelden');
  if (!uid) return sendeFehler(req, res, 401, 'passkey_ungueltig');
  const user = await K.kontoVoll(uid);
  if (!user) return sendeFehler(req, res, 401, 'passkey_ungueltig');
  const gesperrt = assertLoginAllowed(user);
  if (gesperrt) return sendeFehler(req, res, gesperrt.status, gesperrt.code);
  meldeAnmeldung({ ip: req.ip, konto: user.id, zugang: 'passkey' });
  await angemeldetAntworten(req, res, user, req.eingabe, req.eingabe.mit_token === true);
});

router.use(benutzerRouter);
router.use(zweiterFaktorRouter);
router.use(registrierungRouter);
router.use(fehlerAntwort);

export = Object.assign(router, { requireLogin, requireAdmin });
