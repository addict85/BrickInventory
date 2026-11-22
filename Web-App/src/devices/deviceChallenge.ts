/** The app's step guard, bound to the server: only a keystore key
 * that signs only after device unlock or strong biometrics opens the
 * sensitive steps of an app token. Its attestation proves that; without it
 * a stolen token would register a key without a lock. */
import { createPublicKey, randomBytes, verify, X509Certificate, type KeyObject } from 'node:crypto';
import type { Family } from './repository/deviceKeys';
import type { ACTIONS } from '../contract/device';
import { GOOGLE_ROOTS } from './attestation/googleRoots';
import { checkChain } from './attestation/keyAttestation';
import { applicableList, REVOCATION_STATE } from './attestation/revocationList';
import type { DevicesContext } from './context';
import { processWide } from '../infra/processWide';
import { failDomain } from '../infra/errorTexts';

export type { Family };

export type StepAction = (typeof ACTIONS)[number];

/** Only right after logging in: whoever came later with a stolen token
 * could otherwise register their own key. */
export const KEY_DEADLINE_S = 10 * 60;
export const CHALLENGE_FRIST_S = 2 * 60;
const CHALLENGES_OPEN = 5;
const NONCES_OPEN = 3;
/** Admin stays open in the app until it goes to the background;
 * the window therefore slides along, but ends after HOECHSTENS_S at the latest. */
export const RELEASE_IDLE_S = 5 * 60;
export const RELEASE_AT_MOST_S = 30 * 60;

/** What the app signs. The action is part of it so that a challenge is never good for another one. */
export const message = (action: StepAction, challenge: string) => `BrickInventory-Schritt/1\n${action}\n${challenge}`;

export function familyFrom(
  apiUser: { user_id: number; created_at?: string | Date | undefined } | undefined,
): Family | null {
  const since = apiUser?.created_at;
  if (!apiUser || since === undefined || since === null) return null;
  const d = new Date(since);
  return Number.isNaN(d.getTime()) ? null : { uid: apiUser.user_id, since: d.toISOString() };
}

/** Only EC P-256 as SPKI (Base64), just as the keystore's PublicKey.getEncoded() delivers it. */
export function readKey(b64: string): KeyObject | null {
  try {
    const k = createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' });
    return k.asymmetricKeyType === 'ec' && k.asymmetricKeyDetails?.namedCurve === 'prime256v1' ? k : null;
  } catch {
    return null;
  }
}

/** What the app uses as the attestation challenge; valid until the end of KEY_DEADLINE_S.
 * A family from QR pairing only gets the nonce of its pickup. */
export async function newNonce(k: DevicesContext, f: Family, fromQr = false): Promise<string | null> {
  if (!fromQr) {
    const qr = await k.deviceKeys.qrNonceThe(f);
    if (qr) return qr.nonce;
  }
  const nonce = randomBytes(32).toString('base64url');
  const ok = await k.deviceKeys.createNonce(f, nonce, {
    fristS: KEY_DEADLINE_S,
    open: NONCES_OPEN,
    fromQr,
  });
  return ok ? nonce : null;
}

/** After the QR pickup: the nonce only applies to the new token's family; without a family, none. */
export async function nonceForQrToken(k: DevicesContext, tokenHash: string): Promise<string | null> {
  const f = await k.deviceKeys.familyOfTokens(tokenHash);
  return f ? newNonce(k, f, true) : null;
}

/** Read once per PEM; the key '' stands for the Google roots. */
function roots(pem: string): X509Certificate[] {
  const wurzelCache = processWide('attestationRoots', () => new Map<string, X509Certificate[]>());
  let list = wurzelCache.get(pem);
  if (!list) {
    const parts = pem
      ? (pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [])
      : GOOGLE_ROOTS;
    list = parts.map(p => new X509Certificate(p));
    wurzelCache.set(pem, list);
  }
  return list;
}

export type Registration = 'neu' | 'gleich';

/** The reason belongs in the log: the app cannot fix it, the operator (fingerprint) can. */
function attestationRejected(f: Family, reason: string): never {
  console.warn(`[geraet] Attestation von Konto ${f.uid} abgewiesen: ${reason}`);
  failDomain('invalid', 'device_key_attestation');
}

/** The chain must pass the check and carry a still-open nonce of this family. */
export async function depositKey(kx: DevicesContext, f: Family, chain: readonly string[]): Promise<Registration> {
  const k = kx.config;
  const revoked = applicableList(
    await kx.jobQueue.readState(REVOCATION_STATE),
    k.attestationRevocationDays,
    kx.clock.datum(),
  );
  if (!revoked) attestationRejected(f, 'widerrufsliste_fehlt');
  const p = checkChain(chain, {
    roots: roots(k.attestationRoots ?? ''),
    pkg: k.androidPackage,
    digests: k.androidCertificates,
    revoked,
    patchAtLeast: k.attestationPatchAtLeast,
    now: kx.clock.datum(),
  });
  if (!p.ok) attestationRejected(f, p.reason);
  const canonical = (p.public_key.export({ format: 'der', type: 'spki' }) as Buffer).toString('base64');
  if (!readKey(canonical)) failDomain('invalid', 'device_key_invalid');
  const da = await kx.deviceKeys.entryThe(f);
  if (da?.attested) {
    if (da.public_key !== canonical) failDomain('conflict', 'device_key_exists');
    return 'gleich';
  }
  if (!(await kx.deviceKeys.takeNonce(f, p.challenge.toString('base64url')))) attestationRejected(f, 'challenge');
  if (await kx.deviceKeys.createKey(f, canonical, KEY_DEADLINE_S)) return 'neu';
  if ((await kx.deviceKeys.entryThe(f))?.public_key !== canonical) failDomain('forbidden', 'device_key_deadline');
  return 'gleich';
}

export type Challenge = { challenge: string; message: string; valid_until: Date };

export async function newChallenge(k: DevicesContext, f: Family, action: StepAction): Promise<Challenge> {
  if (!(await k.deviceKeys.keyThe(f, k.config.deviceKeyLegacyUntil))) failDomain('forbidden', 'device_key_missing');
  const challenge = randomBytes(32).toString('base64url');
  const bis = await k.deviceKeys.createChallenge(f, challenge, action, CHALLENGE_FRIST_S, CHALLENGES_OPEN);
  return { challenge, message: message(action, challenge), valid_until: bis };
}

/** The challenge is consumed afterwards, even with a wrong signature: guessing costs a new one per attempt. */
export async function resolveOne(
  kx: DevicesContext,
  f: Family,
  challenge: string,
  signatureB64: string,
): Promise<{ action: StepAction; bis: Date } | null> {
  const action = (await kx.deviceKeys.takeChallenge(f, challenge)) as StepAction | null;
  if (!action) return null;
  const k = readKey((await kx.deviceKeys.keyThe(f, kx.config.deviceKeyLegacyUntil)) ?? '');
  let fits = false;
  try {
    fits =
      !!k &&
      verify(
        'sha256',
        Buffer.from(message(action, challenge), 'utf8'),
        { key: k, dsaEncoding: 'der' },
        Buffer.from(signatureB64, 'base64'),
      );
  } catch {
    fits = false;
  }
  if (!fits) return null;
  return {
    action,
    bis: await kx.deviceKeys.openRelease(f, action, RELEASE_IDLE_S, RELEASE_AT_MOST_S),
  };
}

export type Check = 'frei' | 'kein_schluessel' | 'freigabe_noetig';

export async function checkApproval(k: DevicesContext, f: Family, action: StepAction): Promise<Check> {
  if (await k.deviceKeys.useRelease(f, action, RELEASE_IDLE_S)) return 'frei';
  return (await k.deviceKeys.keyThe(f, k.config.deviceKeyLegacyUntil)) ? 'freigabe_noetig' : 'kein_schluessel';
}
