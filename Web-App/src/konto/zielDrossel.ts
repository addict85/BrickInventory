import crypto from 'node:crypto';
import { countRequest } from './loginLimiter';
import type { AccountContext } from './kontext';

/** Je ZIELADRESSE, nicht je Absender: Über wechselnde IP-Adressen flutete ein
 * Fremder sonst ein Postfach. Gezählt wird der Hash, damit die Zählertabelle
 * keine Adressen sammelt. */
export async function targetThrottled(
  k: AccountContext,
  bucket: string,
  email: string,
  max: number,
  windowMs: number,
): Promise<{ waitMin: number } | null> {
  const ziel = crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32);
  const st = await countRequest(k, bucket, `ziel:${ziel}`, windowMs);
  return st.count > max ? { waitMin: st.waitMin } : null;
}

/** Je angemeldetem Konto, gleich über welche Adresse es fragt. */
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
