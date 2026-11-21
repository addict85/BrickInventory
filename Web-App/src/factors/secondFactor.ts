/** RFC 6238 (TOTP, SHA-1, 6 digits, 30 s): the form every authenticator app
 * understands. No third-party package, with node:crypto. */
import { encrypt, decrypt, kontext, searchValue, searchValueAlt } from '../infra/secret';
import crypto from 'node:crypto';
import type { DbInterface } from '../../db/database';
import * as repo from './repository/secondFactor';
import type { FactorsContext } from './context';
import { imSystemrahmen } from '../infra/area';

const STEP_S = 30;
/** One step forward and back: phone and server clocks never run exactly alike. */
const WINDOW = 1;
const DIGITS = 6;
const CODES_COUNT = 10;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const secondFactorContext = (uid: number) => kontext('zweiter_faktor.geheimnis', uid);

export function base32(buf: Buffer): string {
  let bits = 0,
    wert = 0,
    aus = '';
  for (const b of buf) {
    wert = (wert << 8) | b;
    bits += 8;
    while (bits >= 5) {
      aus += BASE32[(wert >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) aus += BASE32[(wert << (5 - bits)) & 31];
  return aus;
}

export function fromBase32(s: string): Buffer {
  const rein = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0,
    wert = 0;
  const aus: number[] = [];
  for (const z of rein) {
    wert = (wert << 5) | BASE32.indexOf(z);
    bits += 5;
    if (bits >= 8) {
      aus.push((wert >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(aus);
}

export function hotp(key: Buffer, counter: number, digits = DIGITS): string {
  const z = Buffer.alloc(8);
  z.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(z).digest();
  const o = (h[h.length - 1] ?? 0) & 15;
  const zahl = (h.readUInt32BE(o) & 0x7fffffff) % 10 ** digits;
  return String(zahl).padStart(digits, '0');
}

export function timeStep(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / STEP_S);
}

/** Constant-time comparison. */
export function matchingStep(secret: string, code: string, nowMs: number): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const key = fromBase32(secret);
  const now = timeStep(nowMs);
  let treffer: number | null = null;
  for (let s = now - WINDOW; s <= now + WINDOW; s++) {
    if (crypto.timingSafeEqual(Buffer.from(hotp(key, s)), Buffer.from(code)) && treffer === null) treffer = s;
  }
  return treffer;
}

/** Some authenticator apps (FreeOTP for one) show `image` as the entry's logo; they load it
 * themselves, so only with a public base URL. Authy only picks logos from its own collection. */
export function otpauthAddress(secret: string, account: string, base: string | null): string {
  const issuer = 'BrickInventory';
  return (
    `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}` +
    `?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_S}` +
    (base ? `&image=${encodeURIComponent(`${base}/assets/logo-256.png`)}` : '')
  );
}

/** The link for the account, with this service set's base URL. */
export function otpauthFor(k: FactorsContext, secret: string, account: string): string {
  return otpauthAddress(secret, account, k.konfig.appBaseUrl);
}

function normalizeCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, '');
}
/** HMAC with its own sub-key and bound to the account: a leak of the table alone can't be brute-forced. */
const hashCode = (uid: number, code: string) => searchValue('zweiter-faktor-code', `${uid}:${normalizeCode(code)}`);
/** Codes before 2026-11-01: 10 characters (50 bits), unsalted SHA-256. They still count for 90 days
 * after the update (0122), not invalid right away: someone who only has them on paper needs time to replace them. */
const LEGACY_LENGTH = 10;
const legacyHash = (code: string) => crypto.createHash('sha256').update(normalizeCode(code)).digest('hex');

/** 16 characters base32 = 80 bits, in groups of four for copying by hand. */
function newRecoveryCodes(): string[] {
  return Array.from({ length: CODES_COUNT }, () =>
    base32(crypto.randomBytes(10)).toLowerCase().match(/.{4}/g)!.join('-'),
  );
}

async function regenerateCodes(tx: DbInterface, uid: number): Promise<string[]> {
  const codes = newRecoveryCodes();
  await repo.replaceCodes(
    tx,
    uid,
    codes.map(c => hashCode(uid, c)),
  );
  return codes;
}

export function isActive(k: FactorsContext, uid: number): Promise<boolean> {
  return k.secondFactor.isActive(uid);
}

/** `alte_codes_bis`: open codes could be the old kind, in which case they only count until then. */
export async function status(
  k: FactorsContext,
  uid: number,
): Promise<{ aktiv: boolean; codes_uebrig: number; alte_codes_bis: string | null }> {
  const r = await k.secondFactor.factorStatus(uid);
  return {
    aktiv: r.active,
    codes_uebrig: r.remaining,
    alte_codes_bis: r.legacyUntil ? r.legacyUntil.toISOString() : null,
  };
}

/** Not yet active. @returns null if the factor is already active */
export async function beginSetup(k: FactorsContext, uid: number): Promise<string | null> {
  const secret = base32(crypto.randomBytes(20));
  return (await k.secondFactor.createSecret(uid, encrypt(secret, secondFactorContext(uid)))) ? secret : null;
}

export async function confirmSetup(k: FactorsContext, uid: number, code: string): Promise<string[] | null> {
  return k.transaktion(async t => {
    const z = await repo.lockUnconfirmedSecret(t.db, uid);
    if (!z) return null;
    const schritt = matchingStep(
      decrypt(z.secret, secondFactorContext(uid)) ?? '',
      String(code ?? '').trim(),
      t.uhr.jetzt(),
    );
    if (schritt === null) return null;
    await repo.activate(t.db, uid, schritt);
    return regenerateCodes(t.db, uid);
  });
}

/** One-time code and recovery code each count exactly once.
 * @param withOneTimeCode false (daily limit): a six-digit code isn't checked; guessing reveals nothing. */
export async function checkCode(
  k: FactorsContext,
  uid: number,
  code: string | number | null | undefined,
  withOneTimeCode = true,
): Promise<'totp' | 'wiederherstellung' | 'wiederherstellung_alt' | null> {
  const eingabe = String(code ?? '').trim();
  if (!eingabe) return null;
  if (/^\d{6}$/.test(eingabe)) {
    if (!withOneTimeCode) return null;
    const z = await k.secondFactor.activeSecret(uid);
    const schritt = z ? matchingStep(decrypt(z.secret, secondFactorContext(uid)) ?? '', eingabe, k.uhr.jetzt()) : null;
    if (schritt === null) return null;
    return (await k.secondFactor.consumeStep(uid, schritt)) ? 'totp' : null;
  }
  // Codes from before a key change: their plaintext isn't stored, rehashing isn't possible.
  const beforeSwitch = searchValueAlt('zweiter-faktor-code', `${uid}:${normalizeCode(eingabe)}`);
  if (
    (await k.secondFactor.consumeCode(uid, hashCode(uid, eingabe))) ||
    (beforeSwitch && (await k.secondFactor.consumeCode(uid, beforeSwitch)))
  ) {
    await k.secondFactor.markCodesCurrent(uid);
    return 'wiederherstellung';
  }
  if (normalizeCode(eingabe).length !== LEGACY_LENGTH) return null;
  return (await k.secondFactor.consumeCode(uid, legacyHash(eingabe), true)) ? 'wiederherstellung_alt' : null;
}

export function disable(k: FactorsContext, uid: number): Promise<void> {
  return imSystemrahmen(k.db, 'zugangsdaten', () => k.transaktion(t => t.secondFactor.remove(uid)));
}

export async function renewCodes(k: FactorsContext, uid: number): Promise<string[]> {
  return k.transaktion(t => regenerateCodes(t.db, uid));
}

/** For the admin's account list: accounts live with the account area, their factor here. */
export function activeAmong(k: FactorsContext, ids: number[]): Promise<Set<number>> {
  return k.secondFactor.withActiveFactor(ids);
}
