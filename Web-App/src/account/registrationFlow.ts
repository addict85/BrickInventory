/** Registrierung, neuer Bestätigungslink und Passwort vergessen. Jeder Weg
 * antwortet gleich, ob es das Konto gibt oder nicht; die Rückmeldung geht per
 * Mail an die Adresse, nicht an den Anfragenden. */
import crypto from 'node:crypto';
import { logAndContinue, reportAndDeliver } from '../infra/fehler';
import { mailBasisUrl } from '../infra/basisUrl';
import { inSystemContext } from '../infra/kontoKontext';
import { tokenDigest } from './deviceToken';
import { computeHowRegistration, register } from './accounts';
import { targetThrottled } from './targetThrottle';
import { asDuplicate } from '../infra/fehlerTexte';
import type { AccountContext } from './context';

const HOUR_MS = 60 * 60 * 1000;
const RUECKSETZ_VALID_MIN = 60,
  RUECKSETZ_PAUSE_MIN = 15,
  MIN_DURATION_MS = 400;

/** Ausnahme: Die Mail geht auch ohne lesbare Einstellung hinaus, dann deutsch.
 * Das Konto des Inhabers ist nicht das der Anfrage (Zeilenschutz). */
async function mailLanguage(k: AccountContext, uid: number): Promise<string> {
  const wert = inSystemContext('registrierung', () => k.einstellungen.userValue(uid, 'language', 'de'));
  return String(await wert.catch(reportAndDeliver('registrierung:sprache', 'de')));
}

/** Ohne Basisadresse kein Link, also keine Mail. */
async function sendOut(mail: (basis: string) => Promise<{ success: boolean }>): Promise<boolean> {
  const basis = mailBasisUrl();
  return basis ? (await mail(basis)).success : false;
}

/** Dieselbe Mindestdauer für jeden Ausgang: Auch die Zeit verrät keine Adresse. */
async function withMinDuration(work: () => Promise<void>): Promise<void> {
  const start = Date.now();
  await work();
  await new Promise(r => setTimeout(r, Math.max(0, MIN_DURATION_MS - (Date.now() - start))));
}

export interface Registrierung {
  username: string;
  email: string;
  first_name?: string | null | undefined;
  last_name?: string | null | undefined;
  passwort: string;
  lang: 'de' | 'en';
}

/** Vergebene Adresse oder vergebener Name rechnen so lange wie ein neues Konto.
 * @returns ob die Mail hinausging */
export async function tryRegistration(k: AccountContext, r: Registrierung): Promise<boolean> {
  const inhaber = await k.konten.accountWithEmail(r.email);
  if (inhaber) {
    await computeHowRegistration(r.passwort);
    const sprache = await mailLanguage(k, inhaber.id);
    return sendOut(() => k.mail.mailRegistrationAttempt(inhaber.email, sprache));
  }
  if (await k.konten.nameTaken(r.username, 0)) {
    await computeHowRegistration(r.passwort);
    return sendOut(basis => k.mail.mailUsernameTaken(r.email, r.lang, basis));
  }
  return newAccount(k, r);
}

async function newAccount(k: AccountContext, r: Registrierung): Promise<boolean> {
  const token = crypto.randomBytes(32).toString('hex');
  // Nur als SHA-256: Bei einem Datenbank-Leak wäre ein ausstehender Link sonst einlösbar.
  const newId = await register(k, {
    username: r.username,
    email: r.email,
    first_name: r.first_name,
    last_name: r.last_name,
    passwort: r.passwort,
    tokenHash: tokenDigest(token),
    bis: new Date(k.uhr.jetzt() + 24 * HOUR_MS),
  }).catch(asDuplicate('benutzername_oder_email_vergeben'));
  if (newId)
    await inSystemContext('registrierung', () => k.einstellungen.setUserSetting(newId, 'language', r.lang)).catch(
      logAndContinue(`registrierung:sprache ${newId}`),
    );
  const mehrere = (await k.konten.openRegistrations(r.email)) > 1;
  return sendOut(basis => k.mail.mailVerification(r.email, token, basis, r.lang, 'registrierung', mehrere));
}

/** Über der Grenze still keine Mail: Eine Absage verriete, dass jemand die Adresse bedrängt. */
export function confirmationAgainRequest(k: AccountContext, email: string): Promise<void> {
  return withMinDuration(async () => {
    const gedrosselt = await targetThrottled(k, 'bestaetigung-ziel', email, 3, HOUR_MS);
    const token = crypto.randomBytes(32).toString('hex');
    const konto = gedrosselt
      ? null
      : await k.konten.renewEmailTokenIfFree(email, tokenDigest(token), 24, RUECKSETZ_PAUSE_MIN);
    // Nicht awaiten, sonst verriete die Dauer des SMTP-Versands die Adresse.
    if (konto)
      mailLanguage(k, konto.id)
        .then(lang => k.mail.mailVerification(konto.email, token, mailBasisUrl()!, lang))
        .catch(logAndContinue('bestaetigung-erneut:mailversand'));
  });
}

/** Höchstens ein Link je Konto und RUECKSETZ_PAUSE_MIN: Sonst flutet ein Fremder das Postfach. */
export function ruecksetzLinkRequest(kx: AccountContext, email: string): Promise<void> {
  return withMinDuration(async () => {
    const gedrosselt = await targetThrottled(kx, 'forgot-ziel', email, 3, HOUR_MS);
    const user = gedrosselt ? null : await kx.konten.activeAccountAfterEmail(email);
    const token = crypto.randomBytes(32).toString('hex');
    const k = kx.konten;
    if (
      !user ||
      !(await k.setRuecksetzTokenIfFree(user.id, tokenDigest(token), RUECKSETZ_VALID_MIN, RUECKSETZ_PAUSE_MIN))
    )
      return;
    mailLanguage(kx, user.id)
      // An die GESPEICHERTE Adresse: Die eingegebene passt per LOWER() auch als Unicode-Variante.
      .then(lang => kx.mail.mailPasswordReset(user.email ?? '', token, mailBasisUrl()!, lang))
      .catch(logAndContinue('forgot-password:mailversand'));
  });
}

export function nameToConfirmation(k: AccountContext, token: string): Promise<string | null> {
  return k.konten.nameZuEmailToken(tokenDigest(token));
}

export function accountToRuecksetzLink(k: AccountContext, token: string) {
  return k.konten.accountAfterRuecksetzToken(tokenDigest(token));
}
