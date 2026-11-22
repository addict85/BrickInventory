import crypto from 'node:crypto';
import { countRequest } from './loginLimiter';
import type { AccountContext } from './context';

/** Per TARGET ADDRESS, not per sender: via changing IP addresses a
 * stranger could otherwise flood a mailbox. The hash is counted so that the counter table
 * does not collect addresses. */
export async function targetThrottled(
  k: AccountContext,
  bucket: string,
  email: string,
  max: number,
  windowMs: number,
): Promise<{ waitMin: number } | null> {
  const target = crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32);
  const st = await countRequest(k, bucket, `ziel:${target}`, windowMs);
  return st.count > max ? { waitMin: st.waitMin } : null;
}

/** Per logged-in account, regardless of which address it asks for. */
export async function accountThrottled(
  k: AccountContext,
  bucket: string,
  uid: number,
  max: number,
  windowMs: number,
): Promise<{ waitMin: number } | null> {
  const st = await countRequest(k, bucket, `konto:${uid}`, windowMs);
  return st.count > max ? { waitMin: st.waitMin } : null;
}
