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
): Promise<{ token: string; pairing: number }> {
  await k.qrPairing.cleanQrPairingsOn();
  const nonce = crypto.randomBytes(32).toString('base64url');
  const bis = new Date(k.clock.now() + QR_TTL_MS);
  const pairing = await k.qrPairing.createQrPairing(tokenDigest(nonce), uid, bis, days, OPEN_PAIRINGS_AT_MOST);
  if (pairing === null) failDomain('unavailable', 'server_busy');
  return { token: `bim:${nonce}`, pairing };
}

export async function reportDevice(
  k: AccountContext,
  token: string | null | undefined,
  device: unknown,
  ip: string | null | undefined,
): Promise<{ pickup: string; code: string; uid: number } | null> {
  if (typeof token !== 'string' || !token.startsWith('bim:')) return null;
  const pickup = crypto.randomBytes(32).toString('base64url');
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const z = await k.qrPairing.report(tokenDigest(token.slice(4)), {
    pickup: tokenDigest(pickup),
    codeHash: tokenDigest(code),
    device: tokenLabel(device, 'Android App'),
    ipArea: ipArea(ip),
    fristS: QR_TTL_MS / 1000,
  });
  return z ? { pickup, code, uid: z.user_id } : null;
}

export type Pickup =
  | { state: 'waiting' }
  | { state: 'bereit'; uid: number }
  | { state: 'fertig'; token: string; uid: number; keyNonce: string | null };

const rowTo = (k: AccountContext, pickup: string | null | undefined) =>
  typeof pickup === 'string' && pickup ? k.qrPairing.afterPickup(tokenDigest(pickup)) : Promise.resolve(undefined);

/** With [vorschau] only the account: the app shows it and picks up the token only after the yes.
 * The nonce for the device key is created with the token and only applies to its family. */
export async function fetchQrToken(
  k: AccountContext,
  pickup: string | null | undefined,
  ip: string | null | undefined,
  may: (uid: number) => Promise<boolean>,
  preview = false,
): Promise<Pickup> {
  const z = await rowTo(k, pickup);
  if (z?.state === 'waiting') return { state: 'waiting' };
  if (z?.state === 'rejected') failDomain('forbidden', 'qr_rejected');
  if (z?.state !== 'confirmed' || !(await may(z.user_id))) failDomain('not_signed_in', 'token_invalid');
  if (preview) return { state: 'bereit', uid: z.user_id };
  if (!(await k.qrPairing.markPickedUp(z.id))) failDomain('not_signed_in', 'token_invalid');
  const token = await createToken(k, z.user_id, z.device ?? 'qr-login', true, z.token_days ?? null, {
    scope: 'app',
    ip,
  });
  const keyNonce = await k.devices.nonceForQrToken(tokenDigest(token));
  return { state: 'fertig', token, uid: z.user_id, keyNonce };
}

/** The app's no after the preview: the pairing is rejected afterwards, a token is never created. */
export async function discardPickup(k: AccountContext, pickup: string | null | undefined): Promise<boolean> {
  const z = await rowTo(k, pickup);
  if (z?.state !== 'confirmed' && z?.state !== 'waiting') return false;
  await k.qrPairing.markRejected(z.id);
  return true;
}

export async function pairingState(k: AccountContext, pairing: number, uid: number) {
  const z = await k.qrPairing.qrPairingOfAccount(pairing, uid);
  return z ? { state: z.state, device: z.device, ip_range: z.ip_range } : null;
}

function codeFits(saved: string | null, input: string | number | null | undefined): boolean {
  const digits = String(input ?? '').replace(/\s+/g, '');
  if (!saved || !/^\d{6}$/.test(digits)) return false;
  return crypto.timingSafeEqual(Buffer.from(tokenDigest(digits)), Buffer.from(saved));
}

/** After QR_FAILED_ATTEMPTS wrong codes the pairing is rejected: six digits hold up long enough for that. */
export async function confirmPairing(
  k: AccountContext,
  pairing: number,
  uid: number,
  code: string | number | null | undefined,
): Promise<void> {
  const z = await k.qrPairing.qrPairingOfAccount(pairing, uid);
  if (!z) failDomain('not_found', 'not_found');
  if (z.state !== 'waiting') failDomain('conflict', 'qr_not_pending');
  if (!codeFits(z.code_hash, code)) {
    if ((await k.qrPairing.countQrFailedAttempt(z.id)) < QR_FAILED_ATTEMPTS) failDomain('invalid', 'qr_code_wrong');
    await k.qrPairing.markRejected(z.id);
    failDomain('forbidden', 'qr_rejected');
  }
  if (!(await k.qrPairing.markConfirmed(z.id))) failDomain('conflict', 'qr_not_pending');
}

export async function rejectPairing(k: AccountContext, pairing: number, uid: number): Promise<boolean> {
  const z = await k.qrPairing.qrPairingOfAccount(pairing, uid);
  if (z) await k.qrPairing.markRejected(z.id);
  return !!z;
}
