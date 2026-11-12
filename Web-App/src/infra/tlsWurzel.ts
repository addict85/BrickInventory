import crypto from 'node:crypto';
import fs from 'node:fs';
import { konfig } from './konfig';

export interface TlsStand {
  /** Das Format des QR-Codes. */
  fp: string;
  /** Zum Vorlesen. */
  fp_hex: string;
  /** SHA-256 des ganzen Zertifikats: Diesen Wert zeigen Geräte beim Installieren. */
  zert_sha256: string;
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
    zert_sha256: zert.fingerprint256,
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
    // Stand und Inhalt aus derselben geöffneten Datei: Tauscht Caddy sie dazwischen, passt der Zwischenstand sonst nicht.
    const datei = await fs.promises.open(pfad, 'r');
    try {
      const st = await datei.stat();
      if (_zwischen?.pfad === pfad && _zwischen.mtimeMs === st.mtimeMs) return _zwischen.stand;
      const stand = tlsStandAus(await datei.readFile('utf8'));
      _zwischen = { pfad, mtimeMs: st.mtimeMs, stand };
      return stand;
    } finally {
      await datei.close();
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT')
      console.warn(`[tls] Wurzelzertifikat ${pfad} nicht lesbar:`, (e as Error)?.message || e);
    return null;
  }
}

export async function tlsAuskunft() {
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
