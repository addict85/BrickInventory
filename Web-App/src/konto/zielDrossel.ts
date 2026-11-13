import crypto from 'node:crypto';
import { zaehleAnfrage } from './loginLimiter';
import type { KontoKontext } from './kontext';

/** Je ZIELADRESSE, nicht je Absender: Über wechselnde IP-Adressen flutete ein
 * Fremder sonst ein Postfach. Gezählt wird der Hash, damit die Zählertabelle
 * keine Adressen sammelt. */
export async function zielGedrosselt(
  k: KontoKontext,
  bucket: string,
  email: string,
  max: number,
  fensterMs: number,
): Promise<{ waitMin: number } | null> {
  const ziel = crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32);
  const st = await zaehleAnfrage(k, bucket, `ziel:${ziel}`, fensterMs);
  return st.count > max ? { waitMin: st.waitMin } : null;
}

/** Je angemeldetem Konto, gleich über welche Adresse es fragt. */
export async function kontoGedrosselt(
  k: KontoKontext,
  bucket: string,
  uid: number,
  max: number,
  fensterMs: number,
): Promise<{ waitMin: number } | null> {
  const st = await zaehleAnfrage(k, bucket, `konto:${uid}`, fensterMs);
  return st.count > max ? { waitMin: st.waitMin } : null;
}
