import crypto from 'node:crypto';
import fs from 'node:fs';
import { config } from './config';
import { processWide } from './processWide';

export interface TlsStand {
  /** The format of the QR code. */
  fp: string;
  /** For reading aloud. */
  fp_hex: string;
  /** SHA-256 of the whole certificate: devices show this value when installing. */
  cert_sha256: string;
  subject: string;
  valid_until: string;
  pem: string;
}

const Z = processWide('tlsStand', () => ({ v: null as { path: string; mtimeMs: number; state: TlsStand } | null }));

export function tlsStatusFrom(pem: string): TlsStand {
  const cert = new crypto.X509Certificate(pem);
  const spki = cert.publicKey.export({ type: 'spki', format: 'der' });
  const raw = crypto.createHash('sha256').update(spki).digest();
  return {
    fp: raw.toString('base64'),
    fp_hex: (raw.toString('hex').toUpperCase().match(/../g) ?? []).join(':'),
    cert_sha256: cert.fingerprint256,
    subject: cert.subject,
    valid_until: new Date(cert.validTo).toISOString(),
    pem: cert.toString(),
  };
}

/** Re-read as soon as the file changes: Caddy only creates it on the first
 * start, a restart of the app should not be necessary. */
export async function tlsStand(): Promise<TlsStand | null> {
  const path = config().caCertificate;
  if (!path) return null;
  try {
    // State and content from the same opened file: if Caddy swaps it in between, the intermediate state would otherwise not match.
    const file = await fs.promises.open(path, 'r');
    try {
      const st = await file.stat();
      if (Z.v?.path === path && Z.v.mtimeMs === st.mtimeMs) return Z.v.state;
      const state = tlsStatusFrom(await file.readFile('utf8'));
      Z.v = { path, mtimeMs: st.mtimeMs, state };
      return state;
    } finally {
      await file.close();
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT')
      console.warn(`[tls] Wurzelzertifikat ${path} nicht lesbar:`, (e as Error)?.message || e);
    return null;
  }
}

export async function tlsInfo() {
  const state = await tlsStand();
  return {
    https: config().hinterTls,
    ...(state
      ? {
          fp: state.fp,
          fp_hex: state.fp_hex,
          cert_sha256: state.cert_sha256,
          subject: state.subject,
          valid_until: state.valid_until,
          download: '/ca.crt',
        }
      : { fp: null }),
  };
}
