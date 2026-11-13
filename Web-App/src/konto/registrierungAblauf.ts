/** Registrierung, neuer Bestätigungslink und Passwort vergessen. Jeder Weg
 * antwortet gleich, ob es das Konto gibt oder nicht; die Rückmeldung geht per
 * Mail an die Adresse, nicht an den Anfragenden. */
import crypto from 'node:crypto';
import { logAndContinue, meldeUndLiefere } from '../infra/fehler';
import { mailBasisUrl } from '../infra/basisUrl';
import { imSystemkontext } from '../infra/kontoKontext';
import {
  sendBenutzernameVergebenMail,
  sendPasswordResetMail,
  sendRegistrierungsVersuchMail,
  sendVerificationMail,
} from '../mail';
import { hashToken } from './geraeteToken';
import { rechneWieRegistrierung, registriere } from './konten';
import { setUserSetting } from './nutzerEinstellung';
import { zielGedrosselt } from './zielDrossel';
import { alsDoppelt } from '../infra/fehlerTexte';
import type { KontoKontext } from './kontext';

const STUNDE_MS = 60 * 60 * 1000;
const RUECKSETZ_GUELTIG_MIN = 60,
  RUECKSETZ_PAUSE_MIN = 15,
  MINDESTDAUER_MS = 400;

/** Ausnahme: Die Mail geht auch ohne lesbare Einstellung hinaus, dann deutsch.
 * Das Konto des Inhabers ist nicht das der Anfrage (Zeilenschutz). */
async function mailSprache(k: KontoKontext, uid: number): Promise<string> {
  const wert = imSystemkontext('registrierung', () => k.einstellungen.getSetting(uid, 'language', 'de'));
  return String(await wert.catch(meldeUndLiefere('registrierung:sprache', 'de')));
}

/** Ohne Basisadresse kein Link, also keine Mail. */
async function versende(mail: (basis: string) => Promise<{ success: boolean }>): Promise<boolean> {
  const basis = mailBasisUrl();
  return basis ? (await mail(basis)).success : false;
}

/** Dieselbe Mindestdauer für jeden Ausgang: Auch die Zeit verrät keine Adresse. */
async function mitMindestdauer(arbeit: () => Promise<void>): Promise<void> {
  const beginn = Date.now();
  await arbeit();
  await new Promise(r => setTimeout(r, Math.max(0, MINDESTDAUER_MS - (Date.now() - beginn))));
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
export async function registrierungVersuchen(k: KontoKontext, r: Registrierung): Promise<boolean> {
  const inhaber = await k.konten.kontoMitEmail(r.email);
  if (inhaber) {
    await rechneWieRegistrierung(r.passwort);
    const sprache = await mailSprache(k, inhaber.id);
    return versende(() => sendRegistrierungsVersuchMail(inhaber.email, sprache));
  }
  if (await k.konten.nameVergeben(r.username, 0)) {
    await rechneWieRegistrierung(r.passwort);
    return versende(basis => sendBenutzernameVergebenMail(r.email, r.lang, basis));
  }
  return neuesKonto(k, r);
}

async function neuesKonto(k: KontoKontext, r: Registrierung): Promise<boolean> {
  const token = crypto.randomBytes(32).toString('hex');
  // Nur als SHA-256: Bei einem Datenbank-Leak wäre ein ausstehender Link sonst einlösbar.
  const neuId = await registriere(k, {
    username: r.username,
    email: r.email,
    first_name: r.first_name,
    last_name: r.last_name,
    passwort: r.passwort,
    tokenHash: hashToken(token),
    bis: new Date(Date.now() + 24 * STUNDE_MS),
  }).catch(alsDoppelt('benutzername_oder_email_vergeben'));
  if (neuId)
    await imSystemkontext('registrierung', () => setUserSetting(k, neuId, 'language', r.lang)).catch(
      logAndContinue(`registrierung:sprache ${neuId}`),
    );
  const mehrere = (await k.konten.offeneRegistrierungen(r.email)) > 1;
  return versende(basis => sendVerificationMail(r.email, token, basis, r.lang, 'registrierung', mehrere));
}

/** Über der Grenze still keine Mail: Eine Absage verriete, dass jemand die Adresse bedrängt. */
export function bestaetigungErneutAnfordern(k: KontoKontext, email: string): Promise<void> {
  return mitMindestdauer(async () => {
    const gedrosselt = await zielGedrosselt(k, 'bestaetigung-ziel', email, 3, STUNDE_MS);
    const token = crypto.randomBytes(32).toString('hex');
    const konto = gedrosselt
      ? null
      : await k.konten.erneuereEmailTokenWennFrei(email, hashToken(token), 24, RUECKSETZ_PAUSE_MIN);
    // Nicht awaiten, sonst verriete die Dauer des SMTP-Versands die Adresse.
    if (konto)
      mailSprache(k, konto.id)
        .then(lang => sendVerificationMail(konto.email, token, mailBasisUrl()!, lang))
        .catch(logAndContinue('bestaetigung-erneut:mailversand'));
  });
}

/** Höchstens ein Link je Konto und RUECKSETZ_PAUSE_MIN: Sonst flutet ein Fremder das Postfach. */
export function ruecksetzLinkAnfordern(kx: KontoKontext, email: string): Promise<void> {
  return mitMindestdauer(async () => {
    const gedrosselt = await zielGedrosselt(kx, 'forgot-ziel', email, 3, STUNDE_MS);
    const user = gedrosselt ? null : await kx.konten.aktivesKontoNachEmail(email);
    const token = crypto.randomBytes(32).toString('hex');
    const k = kx.konten;
    if (
      !user ||
      !(await k.setzeRuecksetzTokenWennFrei(user.id, hashToken(token), RUECKSETZ_GUELTIG_MIN, RUECKSETZ_PAUSE_MIN))
    )
      return;
    mailSprache(kx, user.id)
      // An die GESPEICHERTE Adresse: Die eingegebene passt per LOWER() auch als Unicode-Variante.
      .then(lang => sendPasswordResetMail(user.email ?? '', token, mailBasisUrl()!, lang))
      .catch(logAndContinue('forgot-password:mailversand'));
  });
}

export function nameZuBestaetigung(k: KontoKontext, token: string): Promise<string | null> {
  return k.konten.nameZuEmailToken(hashToken(token));
}

export function kontoZumRuecksetzLink(k: KontoKontext, token: string) {
  return k.konten.kontoNachRuecksetzToken(hashToken(token));
}
