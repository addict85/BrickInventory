/** Googles Widerrufsliste der Attestierungsschlüssel. Nur dieser Host, keine
 * Umleitung: Eine Liste aus fremder Quelle könnte widerrufene Ketten freigeben. */
import { holeHttps } from '../src/infra/fetch';

export const REVOCATION_LIST = 'https://android.googleapis.com/attestation/status';
const HOSTS = ['android.googleapis.com'] as const;

/** Der Körper der Liste; im Test ersetzt über die Fremdquellen des Katalogs. */
export type RevocationFetch = (signal?: AbortSignal) => Promise<Buffer>;

export const revocationListFetch: RevocationFetch = async signal => {
  const r = await holeHttps(REVOCATION_LIST, {
    hosts: HOSTS,
    maxBytes: 8 * 1024 * 1024,
    zeitlimitMs: 60_000,
    redirects: 0,
    ...(signal ? { signal } : {}),
  });
  if (r.status !== 200) throw new Error(`Widerrufsliste: HTTP ${r.status}`);
  return r.koerper;
};
