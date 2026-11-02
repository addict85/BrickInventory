import crypto from 'node:crypto';
import { zaehleAnfrage } from './loginLimiter';

/** Je ZIELADRESSE, nicht je Absender: Über wechselnde IP-Adressen flutete ein
 * Fremder sonst ein Postfach. Gezählt wird der Hash, damit die Zählertabelle
 * keine Adressen sammelt. */
export async function zielGedrosselt(bucket: string, email: string, max: number, fensterMs: number)
  : Promise<{ waitMin: number } | null> {
  const ziel = crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32);
  const st = await zaehleAnfrage(bucket, `ziel:${ziel}`, fensterMs);
  return st.count > max ? { waitMin: st.waitMin } : null;
}
