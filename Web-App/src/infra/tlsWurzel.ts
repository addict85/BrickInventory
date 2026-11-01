import crypto from 'crypto';
import fs from 'fs';
import { konfig } from './konfig';

export interface TlsStand {
  /** Das Format des QR-Codes. */
  fp: string;
  /** Zum Vorlesen. */
  fp_hex: string;
  subject: string;
  gueltig_bis: string;
  pem: string;
}

let _zwischen: { pfad: string; mtimeMs: number; stand: TlsStand } | null = null;

export function tlsStandAus(pem: string): TlsStand {
  const zert = new crypto.X509Certificate(pem);
  const spki = zert.publicKey.export({ type: 'spki', format: 'der' });
  const roh = crypto.createHash('sha256').update(spki).digest();
  return {
    fp: roh.toString('base64'),
    fp_hex: (roh.toString('hex').toUpperCase().match(/../g) ?? []).join(':'),
    subject: zert.subject,
    gueltig_bis: new Date(zert.validTo).toISOString(),
    pem: zert.toString(),
  };
}

/** Neu gelesen, sobald sich die Datei ändert: Caddy legt sie erst beim ersten
 * Start an, ein Neustart der App soll nicht nötig sein. */
export async function tlsStand(): Promise<TlsStand | null> {
  const pfad = konfig().caZertifikat;
  if (!pfad) return null;
  try {
    const st = await fs.promises.stat(pfad);
    if (_zwischen?.pfad === pfad && _zwischen.mtimeMs === st.mtimeMs) return _zwischen.stand;
    const stand = tlsStandAus(await fs.promises.readFile(pfad, 'utf8'));
    _zwischen = { pfad, mtimeMs: st.mtimeMs, stand };
    return stand;
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT')
      console.warn(`[tls] Wurzelzertifikat ${pfad} nicht lesbar:`, (e as Error)?.message || e);
    return null;
  }
}
