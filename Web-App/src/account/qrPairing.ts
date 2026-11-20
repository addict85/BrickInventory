/** QR-Anmeldung in drei Schritten: Die Web-Sitzung erzeugt den Code, die App meldet
 * sich damit an und zeigt einen Bestätigungscode, die Web-Sitzung tippt ihn ein.
 * Erst dann holt die App ihren Token ab: Ein abfotografierter QR-Code allein
 * öffnet kein Konto, der Inhaber sieht jedes Gerät, bevor es Zugang bekommt. */
import crypto from 'node:crypto';
import { createToken, tokenDigest, ipArea } from './deviceToken';
import { APP_MAX_DURATION_DAYS, tokenLabel } from './tokenRequest';
import { fachfehler } from '../infra/errorTexts';
import type { AccountContext } from './context';

export type { QrStand } from './repository/qrPairing';
export const QR_TTL_MS = 5 * 60 * 1000;
export const QR_FAILED_ATTEMPTS = 3;

/** Über alle Konten: Jede offene Kopplung ist ein Ziel für das öffentliche /qr-login. */
export const OPEN_PAIRINGS_AT_MOST = 500;

export async function create(
  k: AccountContext,
  uid: number,
  tage: number | null,
): Promise<{ token: string; kopplung: number }> {
  await k.qrKopplung.cleanQrPairingsOn();
  const nonce = crypto.randomBytes(32).toString('base64url');
  const bis = new Date(k.uhr.jetzt() + QR_TTL_MS);
  const kopplung = await k.qrKopplung.putQrPairingAn(tokenDigest(nonce), uid, bis, tage, OPEN_PAIRINGS_AT_MOST);
  if (kopplung === null) fachfehler('nicht_verfuegbar', 'server_ausgelastet');
  return { token: `bim:${nonce}`, kopplung };
}

export async function reportDevice(
  k: AccountContext,
  token: string | null | undefined,
  geraet: unknown,
  ip: string | null | undefined,
): Promise<{ abholung: string; code: string; uid: number } | null> {
  if (typeof token !== 'string' || !token.startsWith('bim:')) return null;
  const abholung = crypto.randomBytes(32).toString('base64url');
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const z = await k.qrKopplung.melde(tokenDigest(token.slice(4)), {
    abholung: tokenDigest(abholung),
    codeHash: tokenDigest(code),
    geraet: tokenLabel(geraet, 'Android App'),
    ipArea: ipArea(ip),
    fristS: QR_TTL_MS / 1000,
  });
  return z ? { abholung, code, uid: z.user_id } : null;
}

export type Abholung =
  | { stand: 'wartet' }
  | { stand: 'bereit'; uid: number }
  | { stand: 'fertig'; token: string; uid: number; keyNonce: string | null };

const rowTo = (k: AccountContext, abholung: string | null | undefined) =>
  typeof abholung === 'string' && abholung
    ? k.qrKopplung.afterPickup(tokenDigest(abholung))
    : Promise.resolve(undefined);

/** Mit [vorschau] nur das Konto: Die App zeigt es und holt den Token erst nach dem Ja.
 * Die Nonce für den Geräteschlüssel entsteht mit dem Token und gilt nur seiner Familie. */
export async function holeQrTokenAb(
  k: AccountContext,
  abholung: string | null | undefined,
  ip: string | null | undefined,
  darf: (uid: number) => Promise<boolean>,
  vorschau = false,
): Promise<Abholung> {
  const z = await rowTo(k, abholung);
  if (z?.stand === 'wartet') return { stand: 'wartet' };
  if (z?.stand === 'abgelehnt') fachfehler('verboten', 'qr_abgelehnt');
  if (z?.stand !== 'bestaetigt' || !(await darf(z.user_id))) fachfehler('nicht_angemeldet', 'token_ungueltig');
  if (vorschau) return { stand: 'bereit', uid: z.user_id };
  if (!(await k.qrKopplung.markPickedUp(z.id))) fachfehler('nicht_angemeldet', 'token_ungueltig');
  const token = await createToken(k, z.user_id, z.geraet ?? 'qr-login', true, z.token_days ?? APP_MAX_DURATION_DAYS, {
    scope: 'app',
    ip,
  });
  const keyNonce = await k.devices.nonceForQrToken(tokenDigest(token));
  return { stand: 'fertig', token, uid: z.user_id, keyNonce };
}

/** Das Nein der App nach der Vorschau: Die Kopplung ist danach abgelehnt, ein Token entsteht nie. */
export async function discardPickup(k: AccountContext, abholung: string | null | undefined): Promise<boolean> {
  const z = await rowTo(k, abholung);
  if (z?.stand !== 'bestaetigt' && z?.stand !== 'wartet') return false;
  await k.qrKopplung.markRejected(z.id);
  return true;
}

export async function kopplungsStand(k: AccountContext, kopplung: number, uid: number) {
  const z = await k.qrKopplung.qrPairingOfAccount(kopplung, uid);
  return z ? { stand: z.stand, geraet: z.geraet, ip_range: z.ip_range } : null;
}

function codeFits(gespeichert: string | null, eingabe: string | number | null | undefined): boolean {
  const digits = String(eingabe ?? '').replace(/\s+/g, '');
  if (!gespeichert || !/^\d{6}$/.test(digits)) return false;
  return crypto.timingSafeEqual(Buffer.from(tokenDigest(digits)), Buffer.from(gespeichert));
}

/** Nach QR_FAILED_ATTEMPTS falschen Codes ist die Kopplung abgelehnt: Sechs Ziffern hält das lange genug. */
export async function confirmPairing(
  k: AccountContext,
  kopplung: number,
  uid: number,
  code: string | number | null | undefined,
): Promise<void> {
  const z = await k.qrKopplung.qrPairingOfAccount(kopplung, uid);
  if (!z) fachfehler('nicht_gefunden', 'nicht_gefunden');
  if (z.stand !== 'wartet') fachfehler('konflikt', 'qr_nicht_wartend');
  if (!codeFits(z.code_hash, code)) {
    if ((await k.qrKopplung.countQrFailedAttempt(z.id)) < QR_FAILED_ATTEMPTS) fachfehler('ungueltig', 'qr_code_falsch');
    await k.qrKopplung.markRejected(z.id);
    fachfehler('verboten', 'qr_abgelehnt');
  }
  if (!(await k.qrKopplung.markConfirmed(z.id))) fachfehler('konflikt', 'qr_nicht_wartend');
}

export async function rejectPairingAb(k: AccountContext, kopplung: number, uid: number): Promise<boolean> {
  const z = await k.qrKopplung.qrPairingOfAccount(kopplung, uid);
  if (z) await k.qrKopplung.markRejected(z.id);
  return !!z;
}
