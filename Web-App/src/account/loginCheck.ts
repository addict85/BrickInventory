/** Anmeldedaten prüfen: Passwort, Kontozustand, zweiter Faktor, Bremse. */
import * as passwortRegel from '../infra/passwordRule';
import { BcryptOverload } from './bcryptLimit';
import { needsNewHash, hashePassword, hashePasswordImmediately, passwordFits } from './passwordHash';
import {
  loginAllowed,
  knownLogin,
  giveLoginSpaceFree,
  loginFailed,
  loginSucceeded,
  reportLoginEvent,
  reportLogin,
  factorCodeLocked,
  factorCodeWrong,
  dailyLimitReached,
  releaseToken,
  countRequest,
  MAX_ATTEMPTS,
  type Anmeldeereignis,
  type LoginMethod,
} from './loginLimiter';
import { accountThrottled } from './targetThrottle';
import { duplicateAs, fachfehler, type ErrorKind, type ErrorCode } from '../infra/errorTexts';
import { hintInBackground } from './accountNotice';
import { tokenDigest } from './deviceToken';
import { accessTransaction } from './accessEnd';
import { loginNameValid } from './nameRules';
import type { AccountContext } from './context';
import { inSystemContext } from '../infra/accountContext';

const TAG_MS = 86_400_000;

export interface AccountState {
  is_active: boolean;
  email_verified: boolean;
  email?: string | null;
  is_admin: boolean;
  registration_pending?: boolean;
  [k: string]: unknown;
}

/** Leer zählt wie „nicht da": Der Hash eines leeren Strings ist ein gültiger
 * SHA-256-Wert. */
export async function verifyEmailToken(
  k: AccountContext,
  token: string | null | undefined,
): Promise<{ userId: number }> {
  const leer = token === undefined || token === null || String(token).trim() === '';
  const hash = tokenDigest(String(token));
  const id = leer ? undefined : await k.konten.accountToEmailToken(hash);
  if (id === undefined) fachfehler('ungueltig', 'bestaetigungslink_ungueltig');
  const ok = await accessTransaction(k, t => t.konten.adoptEmailNew(id, hash)).catch(duplicateAs(false));
  if (!ok) {
    await k.konten.discardEmailNew(id, hash);
    fachfehler('ungueltig', 'email_vergeben');
  }
  return { userId: id };
}

/** Eine Konstante, damit alle Routen, die ein Passwort setzen, dieselbe Länge prüfen. */
export const PASSWORD_MIN_CHARS = passwortRegel.PASSWORD_MIN_CHARS;
export const passwordToShort = passwortRegel.passwordToShort;

/** Nach erfolgreicher Passwortprüfung. Die Absage kommt als CODE, weil die
 * Route weiss, welche Sprache der Anfragende sieht.
 * @returns null = Login erlaubt */
export function assertLoginAllowed(
  user: AccountState,
): { art: ErrorKind; code: ErrorCode; unverified?: boolean } | null {
  if (!user.is_active) return { art: 'verboten', code: 'konto_deaktiviert' };
  if (user.registration_pending === true && !user.is_admin)
    return { art: 'verboten', code: 'email_nicht_bestaetigt', unverified: true };
  return null;
}

/** Für unbekannte Namen: Die Prüfung braucht dann dieselbe Zeit wie bei einem
 * Konto mit aktuellem Hash. */
const DUMMY_HASH = hashePasswordImmediately('nonexistent-account-placeholder');

/** Fachlich, nicht HTTP: Den Status wählt die HTTP-Seite (src/http/errorKind.ts). */
export interface LoginRejection {
  art: ErrorKind;
  code: ErrorCode;
  vars?: Record<string, string | number>;
  /** Der Client blendet dann „E-Mail erneut senden" ein. */
  unverified?: boolean;
  /** Passwort stimmt, es fehlt (oder scheiterte) der Code des zweiten Faktors. */
  zweiterFaktor?: boolean;
  /** Statt des Codes geht auch eine Passkey-Antwort. */
  passkey?: boolean;
}

export type LoginResult = { ok: true; user: Record<string, unknown> } | { ok: false; absage: LoginRejection };

export interface Herkunft {
  ip?: string | null;
}

function absage(
  art: ErrorKind,
  code: ErrorCode,
  vars?: Record<string, string | number>,
  unverified?: boolean,
  zweiterFaktor?: boolean,
): LoginResult {
  return {
    ok: false,
    absage: {
      art,
      code,
      ...(vars ? { vars } : {}),
      ...(unverified ? { unverified: true } : {}),
      ...(zweiterFaktor ? { zweiterFaktor: true } : {}),
    },
  };
}

/** Die einzige Stelle, an der Anmeldedaten geprüft werden: Zwei Fassungen für
 * Webapp und App waren schon einmal auseinandergelaufen.
 * @param username Benutzername ODER E-Mail-Adresse. */
export async function checkCredentials(
  k: AccountContext,
  herkunft: Herkunft,
  username: string | null | undefined,
  password: string | null | undefined,
  code?: string | number | null | undefined,
  passkeyResponse?: unknown,
): Promise<LoginResult> {
  if (!username || !password) return absage('ungueltig', 'benutzername_passwort');
  if (!loginNameValid(username)) return absage('ungueltig', 'name_oder_email_eingeben');

  const ip = herkunft.ip || '?';
  const name = String(username);
  const gesperrt = await loginAllowed(k, ip, name);
  if (gesperrt) {
    reportLoginEvent('anmeldung_gesperrt', {
      ip,
      konto: (await k.zugaenge.accountToLogin(name))?.id ?? null,
    });
    return absage('zu_viele', gesperrt.code, gesperrt.vars);
  }

  const user = await k.zugaenge.accountToLogin(name);
  const withFactor = (passkeyResponse !== undefined && passkeyResponse !== null) || !!String(code ?? '').trim();
  if (await onlyStillWithFactor(k, ip, name, user?.id, withFactor))
    return absage('zu_viele', 'konto_tagesgrenze', undefined, false, true);
  // Auch ohne Treffer, gegen DUMMY_HASH: gleiche Zeit für unbekannte Namen. Wer sich von
  // hier zuletzt angemeldet hat, wartet unter Last vorne: Eine Flut fremder Adressen sperrt ihn nicht aus.
  const priority = await knownLogin(k, ip, name);
  let fitsDasPassword: boolean;
  try {
    fitsDasPassword = await passwordFits(password, user?.password_hash || DUMMY_HASH, priority);
  } catch (e) {
    if (!(e instanceof BcryptOverload)) throw e;
    await giveLoginSpaceFree(k, ip, name);
    return absage('nicht_verfuegbar', 'server_ausgelastet');
  }
  // Gesperrt oder unbestätigt wie falsches Passwort: Eine eigene Absage verriete, dass es stimmte.
  if (!user || !fitsDasPassword || assertLoginAllowed(user)) {
    await fehlversuch(k, 'anmeldung_fehlgeschlagen', ip, name, user?.id);
    return absage('nicht_angemeldet', 'anmeldedaten_ungueltig');
  }

  let zugang: LoginMethod = 'passwort';
  if (await k.factors.isActive(user.id)) {
    // Ein Passkey ersetzt den Code — gebunden an DIESES Konto, dessen Passwort stimmte.
    const withPasskey = passkeyResponse !== undefined && passkeyResponse !== null;
    zugang = withPasskey ? 'passwort+passkey' : 'passwort+code';
    const hatPasskey = await k.factors.hasPasskeys(user.id);
    const supplemented = (e: LoginResult) => {
      if (!e.ok && hatPasskey) e.absage.passkey = true;
      return e;
    };
    if (!withPasskey && !String(code ?? '').trim()) {
      // Das Passwort stimmte; nur der Code fehlt noch — kein Fehlversuch.
      await giveLoginSpaceFree(k, ip, name);
      return supplemented(absage('nicht_angemeldet', 'zweiter_faktor_noetig', undefined, false, true));
    }
    const onlyFallbackPath = !withPasskey && (await factorCodeLocked(k, user.id));
    const gilt = withPasskey
      ? (await k.factors.verifyAuthentication(passkeyResponse, 'zweiter_faktor', user.id)) === user.id
      : await k.factors.checkCode(user.id, code, !onlyFallbackPath);
    if (!gilt) {
      await fehlversuch(k, 'zweiter_faktor_falsch', ip, name, user.id);
      // Sofort, nicht erst mit der Kontosperre: Wer hier rät, kennt das Passwort.
      const erreicht = !withPasskey && (await factorCodeWrong(k, user.id));
      if (erreicht) hintInBackground(k, user.id, 'zweiter_faktor_gesperrt');
      const grund = onlyFallbackPath || erreicht ? 'zweiter_faktor_gesperrt' : 'zweiter_faktor_falsch';
      return supplemented(absage('nicht_angemeldet', grund, undefined, false, true));
    }
    if (gilt === 'wiederherstellung_alt') await oldCodesReport(k, user.id);
  }
  // Erst jetzt, nach Passwort und zweitem Faktor: Den Klartext gibt es nur bei einer Anmeldung.
  if (needsNewHash(user.password_hash))
    await k.zugaenge.replacePasswordHash(user.id, user.password_hash, await hashePassword(password));
  await loginSucceeded(k, ip, name);
  reportLogin({ ip, konto: Number(user.id), zugang });
  return { ok: true, user };
}

/** Wer sich mit einem Code alter Art anmeldet, erfährt die Frist. Vor der Anmeldung trägt die
 * Anfrage noch kein Konto für den Zeilenschutz, daher der Systemrahmen. */
async function oldCodesReport(k: AccountContext, uid: number): Promise<void> {
  const bis = (await inSystemContext('anmeldung: alte Codes', () => k.factors.status(uid))).alte_codes_bis;
  if (bis) hintInBackground(k, uid, 'alte_codes_ablauf', undefined, { bis });
}

/** Über der Tagesgrenze nur mit Code oder Passkey und aktivem Faktor. Vor der Passwortprüfung
 * und ohne deren Ergebnis entschieden: Eine eigene Absage danach verriete das Passwort. */
async function onlyStillWithFactor(
  k: AccountContext,
  ip: string,
  name: string,
  konto: number | undefined,
  withFactor: boolean,
): Promise<boolean> {
  if (!(await dailyLimitReached(k, ip, name))) return false;
  if (withFactor && konto !== undefined && (await k.factors.isActive(konto))) return false;
  await giveLoginSpaceFree(k, ip, name);
  reportLoginEvent('anmeldung_tagesgrenze', { ip, konto: konto ?? null });
  if (konto !== undefined) await offerRelease(k, ip, konto);
  return true;
}

/** Ohne zweiten Faktor bliebe dem Inhaber an einem neuen Ort nur „Passwort vergessen“: ein Link je
 * Adresse und Stunde, höchstens zehn am Tag, damit ein Fremder das Postfach nicht flutet. */
async function offerRelease(k: AccountContext, ip: string, konto: number): Promise<void> {
  if (await k.factors.isActive(konto)) return;
  if ((await countRequest(k, `freigabe-mail|konto:${konto}`, ip, 3_600_000)).count > 1) return;
  if (await accountThrottled(k, 'freigabe-mail', konto, 10, TAG_MS)) return;
  hintInBackground(k, konto, 'anmeldung_freigeben', undefined, { freigabe: releaseToken(k, ip, konto), adresse: ip });
}

/** Beim Erreichen der Kontosperre erfährt es der Inhaber, höchstens einmal am Tag:
 * Nur er weiss, ob er sich vertippt hat. */
async function fehlversuch(
  k: AccountContext,
  ereignis: Anmeldeereignis,
  ip: string,
  name: string,
  konto?: number,
): Promise<void> {
  reportLoginEvent(ereignis, { ip, konto: konto ?? null });
  const { n, dailyLimit } = await loginFailed(k, ip, name);
  if (konto === undefined) return;
  if (dailyLimit) hintInBackground(k, konto, 'anmeldung_tagesgrenze');
  else if (n === MAX_ATTEMPTS && !(await accountThrottled(k, 'sperr-hinweis', konto, 1, TAG_MS)))
    hintInBackground(k, konto, 'anmeldung_gebremst');
}
