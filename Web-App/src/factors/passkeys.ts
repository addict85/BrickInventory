/** Register, log in without a password, and as a second factor instead of
 * the TOTP code. */
import crypto from 'node:crypto';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  type WebAuthnCredential,
} from '@simplewebauthn/server';
import { decodeClientDataJSON } from '@simplewebauthn/server/helpers';
import { baseUrl } from '../infra/baseUrl';
import { errorMessage } from '../infra/error';
import { failDomain } from '../infra/errorTexts';
import { searchValue } from '../infra/secret';
import type { FactorsContext } from './context';
import { androidOrigins } from './androidApp';

function rejected(e: unknown): null {
  console.warn('[passkey] response rejected:', errorMessage(e));
  return null;
}

function asResponse<T extends RegistrationResponseJSON | AuthenticationResponseJSON>(raw: unknown): T | null {
  const a = raw as { id?: unknown; response?: { clientDataJSON?: unknown } } | null;
  return a && typeof a.id === 'string' && typeof a.response?.clientDataJSON === 'string' ? (raw as T) : null;
}

type Transports = NonNullable<WebAuthnCredential['transports']>;
const transports = (s: string | null): { transports?: Transports } =>
  s ? { transports: s.split(',') as Transports } : {};

export type PasskeyPurpose = 'registrieren' | 'anmelden' | 'zweiter_faktor';

/** The browser dialog runs for at most this long. */
const CHALLENGE_MS = 5 * 60 * 1000;

/** A browser only allows WebAuthn for a domain name, not an IP address;
 * without a name there are no passkeys. */
export function relyingParty(): { rpID: string; origin: string; rpName: string } | null {
  const basis = baseUrl();
  if (!basis) return null;
  const u = new URL(basis);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) || u.hostname.startsWith('[')) return null;
  return { rpID: u.hostname, origin: u.origin, rpName: 'BrickInventory' };
}

const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/** Open challenges per purpose; only registering (while logged in) stores them. Beyond this, 503
 * instead of a table that grows without bound. */
export const MAX_OPEN_CHALLENGES = 5000;

const PURPOSES: readonly PasskeyPurpose[] = ['registrieren', 'anmelden', 'zweiter_faktor'];
const signature = (content: Buffer) =>
  Buffer.from(searchValue('passkey-challenge', content.toString('base64url')), 'hex');

/** The public login options store nothing: deadline, purpose and randomness carry their own
 * signature. Otherwise many addresses would fill one shared table and lock everyone out. */
function signedChallenge(purpose: PasskeyPurpose, untilMs: number): Uint8Array<ArrayBuffer> {
  const content = Buffer.alloc(23);
  content.writeUIntBE(Math.ceil(untilMs / 1000), 0, 6);
  content[6] = PURPOSES.indexOf(purpose);
  crypto.randomBytes(16).copy(content, 7);
  return new Uint8Array(Buffer.concat([content, signature(content)]));
}

/** @returns the deadline in ms if the signature, purpose and deadline all match */
function signedDeadline(challenge: string, purpose: PasskeyPurpose, now: number): number | null {
  const b = Buffer.from(challenge, 'base64url');
  if (b.length !== 55) return null;
  const content = b.subarray(0, 23);
  if (!crypto.timingSafeEqual(b.subarray(23), signature(content))) return null;
  const until = content.readUIntBE(0, 6) * 1000;
  return content[6] === PURPOSES.indexOf(purpose) && until > now && until <= now + CHALLENGE_MS + 1000 ? until : null;
}

async function rememberChallenge(
  k: FactorsContext,
  challenge: string,
  purpose: PasskeyPurpose,
  uid: number | null,
): Promise<void> {
  if (
    !(await k.passkeys.storeChallenge(
      hash(challenge),
      purpose,
      uid,
      new Date(k.clock.now() + CHALLENGE_MS),
      MAX_OPEN_CHALLENGES,
    ))
  )
    failDomain('nicht_verfuegbar', 'server_busy');
}

/** Exactly once: a repeated response no longer finds its row. */
async function resolveChallenge(
  k: FactorsContext,
  clientDataJSON: unknown,
  purpose: PasskeyPurpose,
  uid: number | null,
): Promise<string | null> {
  if (typeof clientDataJSON !== 'string') return null;
  let challenge: string;
  try {
    challenge = decodeClientDataJSON(clientDataJSON).challenge;
  } catch (e) {
    return rejected(e);
  }
  return (await k.passkeys.consumeChallenge(hash(challenge), purpose, uid)) ? challenge : null;
}

/** Not meaningful on its own: the authenticator shouldn't store an account id. */
const userHandle = (uid: number) =>
  new Uint8Array(crypto.createHash('sha256').update(`bim:${uid}`).digest().subarray(0, 16));

export async function registrationOptions(k: FactorsContext, uid: number, name: string) {
  const rp = relyingParty();
  if (!rp) return null;
  const present = await k.passkeys.accountCredentialIds(uid);
  const options = await generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpID,
    userName: name,
    userID: userHandle(uid),
    attestationType: 'none',
    // Discoverable, so these same passkeys can also log in without a username.
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    excludeCredentials: present.map(v => ({ id: v.credential_id, ...transports(v.transports) })),
  });
  await rememberChallenge(k, options.challenge, 'registrieren', uid);
  return options;
}

export async function verifyRegistration(
  k: FactorsContext,
  uid: number,
  raw: unknown,
  name: string,
): Promise<{ id: number; name: string } | null> {
  const rp = relyingParty();
  const reply = asResponse<RegistrationResponseJSON>(raw);
  if (!rp || !reply) return null;
  const challenge = await resolveChallenge(k, reply.response.clientDataJSON, 'registrieren', uid);
  if (!challenge) return null;
  const v = await verifyRegistrationResponse({
    response: reply,
    expectedChallenge: challenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpID,
    requireUserVerification: false,
  }).catch(rejected);
  if (!v?.verified) return null;
  const c = v.registrationInfo.credential;
  return k.passkeys.createCredential(
    uid,
    c.id,
    Buffer.from(c.publicKey),
    c.counter,
    (c.transports ?? []).join(',') || null,
    name,
  );
}

export async function authenticationOptions(k: FactorsContext, purpose: 'anmelden' | 'zweiter_faktor') {
  const rp = relyingParty();
  if (!rp) return null;
  // Empty allowCredentials: the browser offers the discoverable passkeys without
  // the server revealing which account has which.
  return generateAuthenticationOptions({
    rpID: rp.rpID,
    userVerification: purpose === 'anmelden' ? 'required' : 'preferred',
    challenge: signedChallenge(purpose, k.clock.now() + CHALLENGE_MS),
  });
}

/** Without a password it requires user verification (PIN, biometrics) — otherwise
 * the passkey alone would be a single factor.
 * @param uid for the second factor, the account whose password already matched. */
export async function verifyAuthentication(
  kx: FactorsContext,
  raw: unknown,
  purpose: 'anmelden' | 'zweiter_faktor',
  uid: number | null = null,
): Promise<number | null> {
  const rp = relyingParty();
  const reply = asResponse<AuthenticationResponseJSON>(raw);
  if (!rp || !reply) return null;
  let challenge: string;
  try {
    challenge = decodeClientDataJSON(reply.response.clientDataJSON).challenge;
  } catch (e) {
    return rejected(e);
  }
  const until = signedDeadline(challenge, purpose, kx.clock.now());
  if (until === null) return null;
  const k = await kx.passkeys.byCredentialId(reply.id, uid);
  if (!k) return null;
  const v = await verifyAuthenticationResponse({
    // Registration only happens in the browser; logging in may also use the enrolled app.
    response: reply,
    expectedChallenge: challenge,
    expectedOrigin: [rp.origin, ...androidOrigins(kx.config)],
    expectedRPID: rp.rpID,
    credential: {
      id: reply.id,
      publicKey: new Uint8Array(k.public_key),
      counter: Number(k.sign_count),
      ...transports(k.transports),
    },
    requireUserVerification: purpose === 'anmelden',
  }).catch(rejected);
  if (!v?.verified) return null;
  // Only recorded after a valid signature: a repeat of the same response finds it.
  if (!(await kx.passkeys.markConsumed(hash(challenge), purpose, new Date(until)))) return null;
  return (await kx.passkeys.advanceCounter(k.id, v.authenticationInfo.newCounter, k.sign_count)) ? k.user_id : null;
}

export const accountPasskeys = (k: FactorsContext, uid: number) => k.passkeys.passkeysForAccount(uid);
export const hasPasskeys = (k: FactorsContext, uid: number) => k.passkeys.hasAny(uid);
export const deletePasskey = (k: FactorsContext, uid: number, id: number) => k.passkeys.deletePasskeyRow(uid, id);
/** On reset, or on request during a password change: an intruder would otherwise keep their passkey. */
export const revokePasskeys = (k: FactorsContext, uid: number) => k.passkeys.deleteAllForAccount(uid);
