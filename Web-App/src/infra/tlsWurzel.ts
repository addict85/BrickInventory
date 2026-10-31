import crypto from 'crypto';
import fs from 'fs';
import { konfig } from './konfig';

/** Was die App zum Pinnen und der Mensch zum Abgleichen braucht. */
export interface TlsStand {
  /** Base64 von SHA-256 über das SubjectPublicKeyInfo — das Format des QR-Codes. */
  fp: string;
  /** Dieselben 32 Byte als Hex mit Doppelpunkten, zum Vorlesen. */
  fp_hex: string;
  subject: string;
  gueltig_bis: string;
  /** Das Zertifikat selbst (PEM) für /ca.crt. */
  pem: string;
}

let _zwischen: { pfad: string; mtimeMs: number; stand: TlsStand } | null = null;

/** Den Stand aus einem PEM berechnen; wirft bei etwas anderem als einem Zertifikat. */
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

/**
 * Die Wurzel der internen CA (CA_ZERTIFIKAT). Gelesen bei Bedarf und neu,
 * sobald sich die Datei ändert: Caddy legt sie erst beim ersten Start an, und
 * ein Neustart der App soll dafür nicht nötig sein.
 * @returns null, wenn keine CA eingerichtet oder die Datei (noch) nicht lesbar ist.
 */
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
