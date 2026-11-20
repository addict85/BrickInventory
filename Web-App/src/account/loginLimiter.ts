/** Die Adresse kommt als Wert; welche eine Anfrage hat, entscheidet die HTTP-Schicht. */
import crypto from 'node:crypto';
import { singleValue } from '../infra/validate';
import { reportAndDeliver } from '../infra/error';
import { searchValue } from '../infra/secret';
import { fachfehler, type ErrorCode } from '../infra/errorTexts';
import type { AccountContext } from './context';
import { drosselAdresse } from '../infra/throttleAddress';

export const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

/** Je Konto über alle Adressen, verdoppelnd: Ein Angreifer rät rund 15 Mal je Viertelstunde,
 * der Inhaber wartet nach einem Vertipper Sekunden statt einer festen Sperre. */
export function waitTimeSeconds(fehlversuche: number): number {
  if (fehlversuche < MAX_ATTEMPTS) return 0;
  return Math.min(2 ** (fehlversuche - MAX_ATTEMPTS), WINDOW_MS / 1000);
}
/** Über ALLE Namen: Die Grenze je Konto liesse sonst Password-Spraying zu. */
export const MAX_JE_ADDRESS = 30;
const KNOWN_MIN = 30 * 24 * 60;
const WINDOW_MIN = WINDOW_MS / 60000;
/** Ein reservierter Platz, dessen Prüfung nie gemeldet wurde, verfällt danach. */
const RUNNING_EXPIRY_S = 60;

// einzelwert(): Kommt der Name doppelt an, liefert Express ein Array.
const _key = (ip: string, name: string) => `login|${drosselAdresse(ip)}|${singleValue(name).toLowerCase()}`;
const _adressKey = (ip: string) => `login-adresse|${drosselAdresse(ip)}`;
const _nameKey = (name: string) => `login-name|${singleValue(name).toLowerCase()}`;
/** Die Bekannt-Zeile lebt 30 Tage und die Tabelle liest die Leserolle: Dort steht
 * nur der HMAC der Adresse; er bleibt für dieselbe Adresse gleich und zählt weiter. */
function adressDigest(ip: string): string {
  return searchValue('anmeldeadresse', drosselAdresse(ip));
}
const _knownKey = (ip: string, name: string) => `login-bekannt|${adressDigest(ip)}|${singleValue(name).toLowerCase()}`;
const _successKey = (ip: string, kennung: string) => `login-erfolg|${adressDigest(ip)}|${kennung}`;

/** Name und E-Mail eines Kontos zählen gemeinsam, sonst gälte jede Grenze doppelt.
 * Klein schreibt PostgreSQL wie beim Login: JS macht aus „İ" zwei Zeichen. */
async function kontoKennung(k: AccountContext, username: string): Promise<string> {
  // Ausnahme: Bei gestörter Datenbank zählt die Drossel im Speicher weiter
  // (inMemory); ohne Konto dann nach dem Namen, statt die Anmeldung zu sperren.
  const z = await k.konten
    .accountToNames(singleValue(username))
    .catch(reportAndDeliver('anmeldung:konto-kennung', null));
  if (z?.id) return `konto:${z.id}`;
  return `name:${namedDigest(z?.kennung ?? singleValue(username).toLowerCase())}`;
}

/** Ein unbekannter Name ist oft ein vertipptes Passwort, und die Tabelle liest die
 * Leserolle: nur der HMAC, der für denselben Namen gleich bleibt und weiter zählt. */
function namedDigest(name: string): string {
  return searchValue('anmeldename', name);
}

export type Sperre = { code: ErrorCode; vars: { minuten: number } };

/** Belegt den Versuch; loginFailed, loginSucceeded oder giveLoginSpaceFree geben ihn frei. */
export async function loginAllowed(k: AccountContext, ip: string, username: string): Promise<Sperre | null> {
  const kennung = await kontoKennung(k, username);
  // Bekannt: nur die Sperre je Adresse und Konto. Gesamtsperre und Wartezeit liessen sich sonst
  // gegen den Inhaber richten, hinter einem Proxy teilen sich alle eine Adresse.
  const bekannt = !!(await k.throttle.counterState(_knownKey(ip, kennung), KNOWN_MIN));
  const gesamt = await k.throttle.reserve(
    _adressKey(ip),
    WINDOW_MIN,
    RUNNING_EXPIRY_S,
    s => bekannt || s.count + s.laufend < MAX_JE_ADDRESS,
  );
  if (!gesamt.ok) return { code: 'zu_viele_fehlversuche', vars: { minuten: gesamt.stand.waitMin } };
  const adresse = await k.throttle.reserve(
    _key(ip, kennung),
    WINDOW_MIN,
    RUNNING_EXPIRY_S,
    s => s.count + s.laufend < MAX_ATTEMPTS,
  );
  if (!adresse.ok) {
    await k.throttle.releaseSlot(_adressKey(ip));
    return { code: 'zu_viele_fehlversuche', vars: { minuten: adresse.stand.waitMin } };
  }
  if (bekannt) return null;
  let rest = 0;
  const konto = await k.throttle.reserve(_nameKey(kennung), WINDOW_MIN, RUNNING_EXPIRY_S, s => {
    rest = waitTimeSeconds(s.count) - s.sinceLast;
    // In der Wartezeit-Phase höchstens ein Versuch zugleich je Konto.
    return rest <= 0 && (s.count < MAX_ATTEMPTS || s.laufend === 0);
  });
  if (!konto.ok) {
    await k.throttle.releaseSlot(_key(ip, kennung));
    await k.throttle.releaseSlot(_adressKey(ip));
    return { code: 'zu_viele_fehlversuche', vars: { minuten: Math.max(1, Math.ceil(Math.max(rest, 1) / 60)) } };
  }
  return null;
}

export async function giveLoginSpaceFree(k: AccountContext, ip: string, username: string): Promise<void> {
  const kennung = await kontoKennung(k, username);
  await k.throttle.releaseSlot(_key(ip, kennung));
  await k.throttle.releaseSlot(_nameKey(kennung));
  await k.throttle.releaseSlot(_adressKey(ip));
}

/** @returns die Fehlversuche des Kontos im Fenster und ob die Tagesgrenze gerade erreicht ist */
export async function loginFailed(
  k: AccountContext,
  ip: string,
  username: string,
): Promise<{ n: number; dailyLimit: boolean }> {
  const kennung = await kontoKennung(k, username);
  await k.throttle.countAttempt(_key(ip, kennung), WINDOW_MIN);
  const n = await k.throttle.countAttempt(_nameKey(kennung), WINDOW_MIN);
  await k.throttle.countAttempt(_adressKey(ip), WINDOW_MIN);
  const tag = await k.throttle.countAttempt(await _tagKey(k, ip, kennung), ACCOUNT_WINDOW_MIN);
  return { n, dailyLimit: tag === MAX_JE_ACCOUNT_TAG };
}

/** Eine bekannte Adresse umgeht die Bremse je Konto; wer dort sitzt, riete sonst 480 Mal am Tag.
 * Darüber gilt das Passwort nur mit zweitem Faktor; Passkey und „Passwort vergessen“ bleiben
 * offen, das Zurücksetzen leert den Zähler. Bekannte Adressen zählen je für sich: Sonst
 * sperrte ein Fremder mit 50 Versuchen den Inhaber auch an seinen eigenen Geräten aus. */
export const MAX_JE_ACCOUNT_TAG = 50;
async function _tagKey(k: AccountContext, ip: string, kennung: string): Promise<string> {
  const eigen =
    !!(await k.throttle.counterState(_knownKey(ip, kennung), KNOWN_MIN)) ||
    !!(await k.throttle.counterState(_releaseKey(kennung, adressDigest(ip)), ACCOUNT_WINDOW_MIN));
  return eigen ? `login-tag|${kennung}|${adressDigest(ip)}` : `login-tag|${kennung}`;
}

/** Über der Tagesgrenze sperrte ein Fremder den Inhaber an jedem neuen Ort aus: Ein signierter, einmal
 * gültiger Link lässt die Adresse der gesperrten Anmeldung einen Tag lang wie eine bekannte zählen. */
const _releaseKey = (kennung: string, abdruck: string) => `login-freigabe|${kennung}|${abdruck}`;
const releaseSignature = (uid: number, abdruck: string, bis: number) =>
  searchValue('anmeldefreigabe', `${uid}|${abdruck}|${bis}`);
export function releaseToken(k: AccountContext, ip: string, uid: number): string {
  const abdruck = adressDigest(ip);
  const bis = Math.floor(k.uhr.jetzt() / 1000) + ACCOUNT_WINDOW_MIN * 60;
  return `${uid}.${abdruck}.${bis}.${releaseSignature(uid, abdruck, bis)}`;
}
export async function anmeldungFreigeben(k: AccountContext, token: string): Promise<void> {
  const [u, abdruck = '', b, sig = ''] = String(token).split('.');
  const uid = Number(u),
    bis = Number(b);
  const soll = Number.isInteger(uid) && Number.isInteger(bis) ? releaseSignature(uid, abdruck, bis) : '';
  const echt = soll.length === sig.length && crypto.timingSafeEqual(Buffer.from(soll), Buffer.from(sig));
  if (!echt || bis * 1000 <= k.uhr.jetzt()) fachfehler('konflikt', 'freigabe_link_ungueltig');
  if ((await k.throttle.countAttempt(`login-freigabe-benutzt|${sig}`, ACCOUNT_WINDOW_MIN)) > 1)
    fachfehler('konflikt', 'freigabe_link_ungueltig');
  await k.throttle.countAttempt(_releaseKey(`konto:${uid}`, abdruck), ACCOUNT_WINDOW_MIN);
}
export async function dailyLimitReached(k: AccountContext, ip: string, username: string): Promise<boolean> {
  const key = await _tagKey(k, ip, await kontoKennung(k, username));
  return ((await k.throttle.counterState(key, ACCOUNT_WINDOW_MIN))?.count ?? 0) >= MAX_JE_ACCOUNT_TAG;
}
export async function deleteDailyLimit(k: AccountContext, uid: number): Promise<void> {
  await k.throttle.forgetCounter(`login-tag|konto:${uid}`, { alsoBelow: true });
}

export type Anmeldeereignis =
  | 'anmeldung_fehlgeschlagen'
  | 'anmeldung_gesperrt'
  | 'anmeldung_tagesgrenze'
  | 'zweiter_faktor_falsch'
  | 'bestaetigung_fehlgeschlagen'
  | 'bestaetigung_gesperrt'
  | 'bestaetigung_gebremst';
/** Eine Warnzeile je Ereignis für Protokoll, app_logs und fail2ban; nie Passwort, Code
 * oder eingegebener Name, denn im Namensfeld landet auch einmal ein Passwort. */
export function reportLoginEvent(
  ereignis: Anmeldeereignis,
  angaben: { ip?: string; konto?: number | null; art?: Brake; zugang?: string },
): void {
  const { ip, konto, ...rest } = angaben;
  console.warn(`[anmeldung] ${ereignis}`, {
    ereignis,
    ...(ip ? { adresse: drosselAdresse(ip) } : {}),
    konto: konto ?? 'unbekannt',
    ...rest,
  });
}

/** Erst der Erfolg zeigt, ob nach Fehlversuchen jemand hineinkam, und von wo; nie der Name. */
export type LoginMethod = 'passwort' | 'passwort+code' | 'passwort+passkey' | 'passkey' | 'qr';
export function reportLogin(angaben: { ip?: string | undefined; konto: number; zugang: LoginMethod }): void {
  const { ip, konto, zugang } = angaben;
  console.info('[anmeldung] anmeldung_erfolgreich', {
    ereignis: 'anmeldung_erfolgreich',
    ...(ip ? { adresse: drosselAdresse(ip) } : {}),
    konto,
    zugang,
  });
}

export async function loginSucceeded(k: AccountContext, ip: string, username: string): Promise<void> {
  const kennung = await kontoKennung(k, username);
  await k.throttle.forgetCounter(_key(ip, kennung));
  await k.throttle.forgetCounter(_nameKey(kennung));
  // Nur freigeben: Ein Erfolg setzt den Zähler der Adresse nach Fehlversuchen gegen andere Konten nicht zurück.
  await k.throttle.releaseSlot(_adressKey(ip));
  await k.throttle.countAttempt(_knownKey(ip, kennung), KNOWN_MIN);
  await k.throttle.countAttempt(_successKey(ip, kennung), WINDOW_MIN);
}

/** Weiche Grenze: Wer sich öfter anmeldet, verliert nur den Vorrang. Eine harte träfe
 * den Inhaber, und gegen die Last wirken schon Sperren und Schranke. */
export const SUCCESSES_WITH_PRIORITY = 30;

/** Diese Adresse hat sich mit diesem Namen zuletzt angemeldet, und nicht zu oft. */
export async function knownLogin(k: AccountContext, ip: string, username: string): Promise<boolean> {
  const kennung = await kontoKennung(k, username);
  if (!(await k.throttle.counterState(_knownKey(ip, kennung), KNOWN_MIN))) return false;
  return ((await k.throttle.counterState(_successKey(ip, kennung), WINDOW_MIN))?.count ?? 0) < SUCCESSES_WITH_PRIORITY;
}

/** Jeder unbekannte Name legt eine Zeile an; ohne Aufräumen wüchse die Tabelle mit jedem Rateversuch. */
export async function cleanLoginCounterOn(k: AccountContext): Promise<number> {
  return k.throttle.cleanUp(KNOWN_MIN);
}

export function countRequest(
  k: AccountContext,
  bucket: string,
  ip: string,
  windowMs: number,
): Promise<{ count: number; waitMin: number }> {
  return k.throttle.countInWindow(`${bucket}|${drosselAdresse(ip)}`, windowMs / 60000);
}

/** Je Konto und Zugang: Ein erbeuteter Zugang sperrt nicht die Notbremsen des Inhabers.
 * Codes zählen getrennt und länger; nur ein richtiger Code setzt sie zurück. */
export type Brake = 'passwort' | 'faktor';
const FACTOR_WINDOW_MIN = 60;
const _confirmationKey = (art: Brake, uid: number, zugang: string) =>
  `${art === 'faktor' ? 'faktor' : 'passwort'}-bestaetigen|${uid}|${zugang}`;
const fenster = (art: Brake) => (art === 'faktor' ? FACTOR_WINDOW_MIN : WINDOW_MIN);

/** Über alle Zugänge eines Kontos, damit mehrere erbeutete Zugänge nicht mehrfach raten;
 * gesperrt werden nur Zugänge, die selbst falsch geraten haben. */
export const MAX_CONFIRMATION_JE_ACCOUNT = 20;
const ACCOUNT_WINDOW_MIN = 24 * 60;
const _accountConfirmationKey = (art: Brake, uid: number) =>
  `${art === 'faktor' ? 'faktor' : 'passwort'}-bestaetigen-konto|${uid}`;

export async function confirmationLocked(
  k: AccountContext,
  art: Brake,
  uid: number,
  zugang: string,
): Promise<Sperre | null> {
  const konto = await k.throttle.counterState(_accountConfirmationKey(art, uid), ACCOUNT_WINDOW_MIN);
  const accountFull = !!konto && konto.count >= MAX_CONFIRMATION_JE_ACCOUNT;
  const r = await k.throttle.reserve(
    _confirmationKey(art, uid, zugang),
    fenster(art),
    RUNNING_EXPIRY_S,
    s => s.count + s.laufend < MAX_ATTEMPTS && !(accountFull && s.count > 0),
  );
  if (r.ok) return null;
  const minuten = accountFull && r.stand.count < MAX_ATTEMPTS ? konto!.waitMin : r.stand.waitMin;
  return { code: 'zu_viele_fehlversuche', vars: { minuten } };
}
/** @returns true, wenn dieser Fehlversuch eine Bremse (Zugang oder Konto) gerade erreicht hat */
export async function confirmationFailed(k: AccountContext, art: Brake, uid: number, zugang: string): Promise<boolean> {
  const jeAccess = await k.throttle.countAttempt(_confirmationKey(art, uid, zugang), fenster(art));
  const jeAccount = await k.throttle.countAttempt(_accountConfirmationKey(art, uid), ACCOUNT_WINDOW_MIN);
  return jeAccess === MAX_ATTEMPTS || jeAccount === MAX_CONFIRMATION_JE_ACCOUNT;
}
export async function confirmationSucceeded(k: AccountContext, art: Brake, uid: number, zugang: string): Promise<void> {
  await k.throttle.forgetCounter(_confirmationKey(art, uid, zugang));
}

/** Wer das Passwort kennt, riete den Code sonst langsam unter jeder Wartezeit durch;
 * über der Schranke (24 h je Konto) gelten nur Wiederherstellungscode und Passkey. */
export const MAX_FACTOR_LOGIN_JE_ACCOUNT = 20;
const _factorLoginKey = (uid: number) => `faktor-anmeldung-konto|${uid}`;
export async function factorCodeLocked(k: AccountContext, uid: number): Promise<boolean> {
  return (
    ((await k.throttle.counterState(_factorLoginKey(uid), ACCOUNT_WINDOW_MIN))?.count ?? 0) >=
    MAX_FACTOR_LOGIN_JE_ACCOUNT
  );
}
/** @returns true, wenn dieser Fehlversuch die Schranke gerade erreicht hat */
export async function factorCodeWrong(k: AccountContext, uid: number): Promise<boolean> {
  return (await k.throttle.countAttempt(_factorLoginKey(uid), ACCOUNT_WINDOW_MIN)) === MAX_FACTOR_LOGIN_JE_ACCOUNT;
}
