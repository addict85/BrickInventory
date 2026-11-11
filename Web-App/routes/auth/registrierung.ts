/** Ohne Anmeldung: Registrierung, E-Mail-Bestätigung und Passwort vergessen.
 * Jede Antwort verrät gleich wenig darüber, ob es ein Konto gibt. */
import * as K from '../../src/konto/konten';
import { logAndContinue, meldeUndLiefere } from '../../src/infra/fehler';
import { fehlerAntwort, sendeFehler } from '../../src/http/httpAntwort';
import { hashToken, USERNAME_RE, emailGueltig, nameGueltig, verifiziereEmailToken } from '../../src/konto/auth';
import { zielGedrosselt } from '../../src/konto/zielDrossel';
import { ipThrottle } from '../../src/konto/http/anmeldung';
import { hinweisNebenher } from '../../src/konto/kontoHinweis';
import crypto from 'crypto';
import { passwortMangel } from '../../src/infra/passwortRegel';
import { sendPasswordResetMail, sendVerificationMail, sendRegistrierungsVersuchMail, sendBenutzernameVergebenMail, mailBereit } from '../../src/mail/mailer';
import { registrierungOffen, getSetting } from '../../src/einstellungen/settings';
import { setUserSetting } from '../../src/konto/nutzerEinstellung';
import { fehlerText, antwortSprache, alsDoppelt } from '../../src/infra/fehlerTexte';
import { basisUrl, hinweisOhneBasisUrl, mailBasisUrl } from '../../src/infra/basisUrl';
import * as P from '../../src/konto/passkeys';
import { vertragsRouter } from '../../src/http/vertragsRouter';
import type { Antwort, OffeneAnfrage } from '../../src/http/vertragsRouter';

const router = vertragsRouter();

// Die Anmeldemaske zeigt nur Wege, die dieser Server auch kann; ohne Mail endete die Registrierung in einem Konto, das niemand bestätigen kann.
router.get('/registration-status', async (_req, res: Antwort<'GET /api/v1/auth/registration-status'>) => {
  const mail = await mailBereit();
  res.json({ enabled: mail && await registrierungOffen(), passkey: !!P.vertrauenspartei(),
             passwort_vergessen: mail, mail_versand: mail });
});

router.post('/register', ipThrottle('register', 5, 60 * 60 * 1000), async (req: OffeneAnfrage<'POST /api/v1/auth/register'>, res: Antwort<'POST /api/v1/auth/register'>) => {
  const { username, email, first_name, last_name, password, language } = req.eingabe;
  const lang = language === 'en' ? 'en' : 'de';

  if (!await registrierungOffen() || !await mailBereit()) return sendeFehler(req, res, 403, 'registrierung_deaktiviert');

  if (!username || !email || !password)
    return sendeFehler(req, res, 400, 'registrierung_felder');
  const mangel = passwortMangel(password, username);
  if (mangel) return sendeFehler(req, res, 400, mangel);
  if (!emailGueltig(email))
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
  const basis = mailBasisUrl();
  let result: { success: boolean; mode: string };
  if (inhaber) {
    await K.rechneWieRegistrierung(password);
    const sprache = String(await getSetting(inhaber.id, 'language', 'de').catch(meldeUndLiefere('registrierung:sprache', 'de')));
    result = basis ? await sendRegistrierungsVersuchMail(inhaber.email, sprache)
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
    const mehrere = (await K.offeneRegistrierungen(email)) > 1;
    result = basis ? await sendVerificationMail(email, token, basis, lang, 'registrierung', mehrere)
      : { success: false, mode: 'ohne_basis' };
  }

  res.json({
    success: true,
    message: result.success ? 'Konto erstellt. Bitte bestätige deine E-Mail-Adresse.'
      : 'Konto erstellt, aber die Bestätigungsmail ging nicht hinaus. Der Verwalter kann das Konto freischalten.',
    email_sent: result.success,
  });
});

const RUECKSETZ_GUELTIG_MIN = 60, RUECKSETZ_PAUSE_MIN = 15, RUECKSETZ_MINDESTDAUER_MS = 400;

// Wie /forgot-password: gleiche Antwort und Dauer, ob es ein unbestätigtes Konto gibt oder nicht.
router.post('/bestaetigung-erneut', ipThrottle('bestaetigung-erneut', 5, 60 * 60 * 1000), async (req: OffeneAnfrage<'POST /api/v1/auth/bestaetigung-erneut'>, res: Antwort<'POST /api/v1/auth/bestaetigung-erneut'>) => {
  const { email } = req.eingabe;
  if (!emailGueltig(email)) return sendeFehler(req, res, 400, email ? 'email_ungueltig' : 'email_erforderlich');
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
      .catch(meldeUndLiefere('registrierung:sprache', 'de'))
      .then((lang: unknown) => sendVerificationMail(konto.email, token, mailBasisUrl()!, String(lang ?? 'de')))
      .catch(logAndContinue('bestaetigung-erneut:mailversand'));
  }
  await new Promise(r => setTimeout(r, Math.max(0, RUECKSETZ_MINDESTDAUER_MS - (Date.now() - beginn))));
  res.json({ success: true, message: fehlerText('bestaetigung_gesendet', antwortSprache(req)) });
});

router.post('/email-bestaetigen/vorschau', ipThrottle('email-vorschau', 30, 60 * 60 * 1000), async (req: OffeneAnfrage<'POST /api/v1/auth/email-bestaetigen/vorschau'>, res: Antwort<'POST /api/v1/auth/email-bestaetigen/vorschau'>) => {
  const token = req.eingabe.token;
  const username = token ? await K.nameZuEmailToken(hashToken(String(token))) : null;
  if (!username) return sendeFehler(req, res, 400, 'bestaetigungslink_ungueltig');
  res.json({ success: true, username });
});

router.post('/email-bestaetigen', ipThrottle('email-bestaetigen', 30, 60 * 60 * 1000), async (req: OffeneAnfrage<'POST /api/v1/auth/email-bestaetigen'>, res: Antwort<'POST /api/v1/auth/email-bestaetigen'>) => {
  const e = await verifiziereEmailToken(req.eingabe.token);
  if (!e.ok) return sendeFehler(req, res, 400, e.grund === 'vergeben' ? 'email_vergeben' : 'bestaetigungslink_ungueltig');
  res.json({ success: true });
});

router.post('/forgot-password', ipThrottle('forgot-password', 5, 60 * 60 * 1000), async (req: OffeneAnfrage<'POST /api/v1/auth/forgot-password'>, res: Antwort<'POST /api/v1/auth/forgot-password'>) => {
  const { email } = req.eingabe;
  if (!emailGueltig(email)) return sendeFehler(req, res, 400, email ? 'email_ungueltig' : 'email_erforderlich');
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
    getSetting(user.id, 'language', 'de')
      .catch(meldeUndLiefere('registrierung:sprache', 'de'))
      // An die GESPEICHERTE Adresse: Die eingegebene passt per LOWER() auch als Unicode-Variante.
      .then((lang: unknown) => sendPasswordResetMail(
        user.email ?? '', token, mailBasisUrl()!, String(lang ?? 'de')))
      .catch(logAndContinue('forgot-password:mailversand'));
  }
  await new Promise(r => setTimeout(r, Math.max(0, RUECKSETZ_MINDESTDAUER_MS - (Date.now() - beginn))));
  res.json({ success: true, message: 'Falls die E-Mail existiert, wurde ein Link gesendet.' });
});

router.post('/reset-password', ipThrottle('reset-password', 10, 60 * 60 * 1000), async (req: OffeneAnfrage<'POST /api/v1/auth/reset-password'>, res: Antwort<'POST /api/v1/auth/reset-password'>) => {
  const { token, password } = req.eingabe;
  if (!token || !password) return sendeFehler(req, res, 400, 'token_passwort_erforderlich');
  const mangel = passwortMangel(password);
  if (mangel) return sendeFehler(req, res, 400, mangel);
  const user = await K.kontoNachRuecksetzToken(hashToken(token));
  if (!user) return sendeFehler(req, res, 400, 'token_ungueltig');
  // Den Namen kennt erst das Konto hinter dem Token; die Regel gilt wie auf allen anderen Wegen.
  const nameMangel = passwortMangel(password, user.username);
  if (nameMangel) return sendeFehler(req, res, 400, nameMangel);
  // Nur die Anfrage, die den Link verbraucht, setzt ihr Passwort.
  const uid = await K.setzePasswortZurueck(hashToken(token), password);
  if (!uid) return sendeFehler(req, res, 400, 'token_ungueltig');
  hinweisNebenher(uid, 'passwort_zurueckgesetzt');
  res.json({ success: true, message: 'Passwort erfolgreich geändert.' });
});

router.use(fehlerAntwort);

export = router;
