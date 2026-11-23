/** If the response never reaches the app's offline outbox, it retries with the
 * same key and gets the stored response back — without a second effect. The
 * same key with different content is a client error. */
import { HTTP_DEADLINES } from '../infra/httpDeadlines';
import { encrypt, decrypt, isEncrypted, context, rekey, searchValue } from '../infra/secret';
import { withEffectNote as markEffect } from './repository';
import type { IdempotencyContext } from './context';

/** The app retries within hours, not days. */
export const EXPIRY_HOURS = 24;
/** After this, the first request counts as abandoned (crash, restart): longer than the longest allowed request. */
export const ORPHANED_AFTER_S = HTTP_DEADLINES.requestTimeout / 1000 + 60;

/** User and key in the context: a stored response is only valid for its own entry. */
export const responseContext = (uid: number, key: string) => context('idempotency.response', uid, key);

export const KEY_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/;

/** Kept 24 h in the table, without passwords/codes; `h1:` marks it apart from the old SHA-256. */
const SECRET_FIELD = /pass|secret|geheim|token|_key$|^key$|^current$|code$|^pin$|_pin$/i;
const FINGERPRINT_PREFIX = 'h1:';
function withoutSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSecrets);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET_FIELD.test(k) ? '*' : withoutSecrets(v)]));
}

/** Runs before the route's guards: admin responses only for the admin role, or running keys would survive updates. */
export function fingerprint(method: string, path: string, body: unknown, isAdmin = false): string {
  const content = `${method} ${path}\n${JSON.stringify(withoutSecrets(body ?? null))}`;
  return FINGERPRINT_PREFIX + searchValue('idempotency', isAdmin ? `${content}\nadmin` : content);
}

export function deleteOldFingerprints(k: IdempotencyContext): Promise<number> {
  return k.repository.deleteOtherPrints(FINGERPRINT_PREFIX);
}

export type Outcome =
  | { kind: 'new' }
  | { kind: 'replay'; status: number; response: string }
  | { kind: 'not_replayable' }
  | { kind: 'running' }
  | { kind: 'different' };

/** Without a readable body, a clear refusal beats risking a second effect. */
export async function begin(k: IdempotencyContext, uid: number, key: string, fp: string): Promise<Outcome> {
  if (await k.repository.receipts(uid, key, fp, ORPHANED_AFTER_S)) return { kind: 'new' };
  const e = await k.repository.entry(uid, key, ORPHANED_AFTER_S);
  // Released between claiming and reading (the first one failed): try again.
  if (!e) return (await k.repository.receipts(uid, key, fp, ORPHANED_AFTER_S)) ? { kind: 'new' } : { kind: 'running' };
  if (e.request !== fp) return { kind: 'different' };
  // Orphaned with an effect: the first run had an effect, its response got lost.
  if (e.status === null) return e.has_effect && e.orphaned ? { kind: 'not_replayable' } : { kind: 'running' };
  const response = isEncrypted(e.response) ? decrypt(e.response, responseContext(uid, key)) : null;
  if (response === null) return { kind: 'not_replayable' };
  return { kind: 'replay', status: e.status, response };
}

/** A 5xx is released, not remembered: without a marked effect a retry may try again. */
export async function end(
  k: IdempotencyContext,
  uid: number,
  key: string,
  status: number,
  response: string | null,
): Promise<void> {
  if (status >= 500) await k.repository.deleteRunning(uid, key, status);
  else
    await k.repository.finish(
      uid,
      key,
      status,
      response === null ? null : encrypt(response, responseContext(uid, key)),
    );
}

export function release(k: IdempotencyContext, uid: number, key: string, status: number): Promise<void> {
  return k.repository.deleteRunning(uid, key, status);
}

/** The route's effect and its mark on the key apply together or not at all. */
export const withEffectMark = <T>(k: IdempotencyContext, uid: number, key: string, work: () => T): T =>
  markEffect(k.db, uid, key, work);

/** v1 responses from before the context; startup re-encrypts them. */
export async function reencryptResponses(k: IdempotencyContext): Promise<number> {
  let n = 0;
  for (const z of await k.repository.oldResponses()) {
    const reencrypted = rekey(z.response, responseContext(z.user_id, z.key));
    if (reencrypted) n += await k.repository.replaceResponse(z.user_id, z.key, z.response, reencrypted);
  }
  return n;
}

/** After a key change: fingerprints and responses belong to the previous key. */
export function forgetAll(k: IdempotencyContext): Promise<number> {
  return k.repository.deleteOlderAs(0);
}

export function cleanupIdempotency(k: IdempotencyContext): Promise<number> {
  return k.repository.deleteOlderAs(EXPIRY_HOURS);
}
