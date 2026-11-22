/** QR login in three steps: the web session creates the code, the app logs
 * in with it and shows a confirmation code, the web session types it in.
 * Only then does the app pick up its token: a photographed QR code alone
 * opens no account, and the owner sees every device before it gets access. */
import crypto from 'node:crypto';
import { createToken, tokenDigest, ipArea } from './deviceToken';
import { tokenLabel } from './tokenRequest';
import { failDomain } from '../infra/errorTexts';
import type { AccountContext } from './context';

export type { QrStand } from './repository/qrPairing';
export const QR_TTL_MS = 5 * 60 * 1000;
export const QR_FAILED_ATTEMPTS = 3;

/** Across all accounts: every open pairing is a target for the public /qr-login. */
export const OPEN_PAIRINGS_AT_MOST = 500;

export async function create(
  k: AccountContext,
  uid: number,
  days: number | null,
): Promise<{ token: string; kopplung: number }> {
  await k.qrKopplung.cleanQrPairingsOn();
  const nonce = crypto.randomBytes(32).toString('base64url');
  const bis = new Date(k.uhr.jetzt() + QR_TTL_MS);
  const kopplung = await k.qrKopplung.createQrPairing(tokenDigest(nonce), uid, bis, days, OPEN_PAIRINGS_AT_MOST);
  if (kopplung === null) failDomain('nicht_verfuegbar', 'server_ausgelastet');
  return { token: `bim:${nonce}`, kopplung };
}

export async function reportDevice(
  k: AccountContext,
  token: string | null | undefined,
  device: unknown,
  ip: string | null | undefined,
): Promise<{ abholung: string; code: string; uid: number } | null> {
  if (typeof token !== 'string' || !token.startsWith('bim:')) return null;
  const abholung = crypto.randomBytes(32).toString('base64url');
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const z = await k.qrKopplung.report(tokenDigest(token.slice(4)), {
    abholung: tokenDigest(abholung),
    codeHash: tokenDigest(code),
    geraet: tokenLabel(device, 'Android App'),
    ipArea: ipArea(ip),
    fristS: QR_TTL_MS / 1000,
  });
  return z ? { abholung, code, uid: z.user_id } : null;
}

export type Pickup =
  | { stand: 'wartet' }
  | { stand: 'bereit'; uid: number }
  | { stand: 'fertig'; token: string; uid: number; keyNonce: string | null };

const rowTo = (k: AccountContext, abholung: string | null | undefined) =>
  typeof abholung === 'string' && abholung
    ? k.qrKopplung.afterPickup(tokenDigest(abholung))
    : Promise.resolve(undefined);

/** With [vorschau] only the account: the app shows it and picks up the token only after the yes.
 * The nonce for the device key is created with the token and only applies to its family. */
export async function fetchQrToken(
  k: AccountContext,
  abholung: string | null | undefined,
  ip: string | null | undefined,
  may: (uid: number) => Promise<boolean>,
  preview = false,
): Promise<Pickup> {
  const z = await rowTo(k, abholung);
  if (z?.stand === 'wartet') return { stand: 'wartet' };
  if (z?.stand === 'abgelehnt') failDomain('verboten', 'qr_abgelehnt');
  if (z?.stand !== 'bestaetigt' || !(await may(z.user_id))) failDomain('nicht_angemeldet', 'token_ungueltig');
  if (preview) return { stand: 'bereit', uid: z.user_id };
  if (!(await k.qrKopplung.markPickedUp(z.id))) failDomain('nicht_angemeldet', 'token_ungueltig');
  const token = await createToken(k, z.user_id, z.geraet ?? 'qr-login', true, z.token_days ?? null, {
    scope: 'app',
    ip,
  });
  const keyNonce = await k.devices.nonceForQrToken(tokenDigest(token));
  return { stand: 'fertig', token, uid: z.user_id, keyNonce };
}

/** The app's no after the preview: the pairing is rejected afterwards, a token is never created. */
export async function discardPickup(k: AccountContext, abholung: string | null | undefined): Promise<boolean> {
  const z = await rowTo(k, abholung);
  if (z?.stand !== 'bestaetigt' && z?.stand !== 'wartet') return false;
  await k.qrKopplung.markRejected(z.id);
  return true;
}

export async function pairingState(k: AccountContext, kopplung: number, uid: number) {
  const z = await k.qrKopplung.qrPairingOfAccount(kopplung, uid);
  return z ? { stand: z.stand, geraet: z.geraet, ip_range: z.ip_range } : null;
}

function codeFits(saved: string | null, input: string | number | null | undefined): boolean {
  const digits = String(input ?? '').replace(/\s+/g, '');
  if (!saved || !/^\d{6}$/.test(digits)) return false;
  return crypto.timingSafeEqual(Buffer.from(tokenDigest(digits)), Buffer.from(saved));
}

/** After QR_FAILED_ATTEMPTS wrong codes the pairing is rejected: six digits hold up long enough for that. */
export async function confirmPairing(
  k: AccountContext,
  kopplung: number,
  uid: number,
  code: string | number | null | undefined,
): Promise<void> {
  const z = await k.qrKopplung.qrPairingOfAccount(kopplung, uid);
  if (!z) failDomain('nicht_gefunden', 'nicht_gefunden');
  if (z.stand !== 'wartet') failDomain('konflikt', 'qr_nicht_wartend');
  if (!codeFits(z.code_hash, code)) {
    if ((await k.qrKopplung.countQrFailedAttempt(z.id)) < QR_FAILED_ATTEMPTS) failDomain('ungueltig', 'qr_code_falsch');
    await k.qrKopplung.markRejected(z.id);
    failDomain('verboten', 'qr_abgelehnt');
  }
  if (!(await k.qrKopplung.markConfirmed(z.id))) failDomain('konflikt', 'qr_nicht_wartend');
}

export async function rejectPairing(k: AccountContext, kopplung: number, uid: number): Promise<boolean> {
  const z = await k.qrKopplung.qrPairingOfAccount(kopplung, uid);
  if (z) await k.qrKopplung.markRejected(z.id);
  return !!z;
}
