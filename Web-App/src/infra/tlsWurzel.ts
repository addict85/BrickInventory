import crypto from 'node:crypto';
import fs from 'node:fs';
import { konfig } from './config';
import { processWide } from './prozessweit';

export interface TlsStand {
  /** The format of the QR code. */
  fp: string;
  /** For reading aloud. */
  fp_hex: string;
  /** SHA-256 of the whole certificate: devices show this value when installing. */
  zert_sha256: string;
  subject: string;
  gueltig_bis: string;
  pem: string;
}

const Z = processWide('tlsStand', () => ({ v: null as { pfad: string; mtimeMs: number; stand: TlsStand } | null }));

export function tlsStatusFrom(pem: string): TlsStand {
  const cert = new crypto.X509Certificate(pem);
  const spki = cert.publicKey.export({ type: 'spki', format: 'der' });
  const raw = crypto.createHash('sha256').update(spki).digest();
  return {
    fp: raw.toString('base64'),
    fp_hex: (raw.toString('hex').toUpperCase().match(/../g) ?? []).join(':'),
    zert_sha256: cert.fingerprint256,
    subject: cert.subject,
    gueltig_bis: new Date(cert.validTo).toISOString(),
    pem: cert.toString(),
  };
}

/** Re-read as soon as the file changes: Caddy only creates it on the first
 * start, a restart of the app should not be necessary. */
export async function tlsStand(): Promise<TlsStand | null> {
  const pfad = konfig().caCertificate;
  if (!pfad) return null;
  try {
    // State and content from the same opened file: if Caddy swaps it in between, the intermediate state would otherwise not match.
    const file = await fs.promises.open(pfad, 'r');
    try {
      const st = await file.stat();
      if (Z.v?.pfad === pfad && Z.v.mtimeMs === st.mtimeMs) return Z.v.stand;
      const stand = tlsStatusFrom(await file.readFile('utf8'));
      Z.v = { pfad, mtimeMs: st.mtimeMs, stand };
      return stand;
    } finally {
      await file.close();
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT')
      console.warn(`[tls] Wurzelzertifikat ${pfad} nicht lesbar:`, (e as Error)?.message || e);
    return null;
  }
}

export async function tlsInfo() {
  const stand = await tlsStand();
  return {
    https: konfig().hinterTls,
    ...(stand
      ? {
          fp: stand.fp,
          fp_hex: stand.fp_hex,
          zert_sha256: stand.zert_sha256,
          subject: stand.subject,
          gueltig_bis: stand.gueltig_bis,
          download: '/ca.crt',
        }
      : { fp: null }),
  };
}
