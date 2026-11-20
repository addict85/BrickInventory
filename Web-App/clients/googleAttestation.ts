/** Google's revocation list of attestation keys. Only this host, no
 * redirect: a list from a foreign source could release revoked chains. */
import { holeHttps } from '../src/infra/fetch';

export const REVOCATION_LIST = 'https://android.googleapis.com/attestation/status';
const HOSTS = ['android.googleapis.com'] as const;

/** The body of the list; replaced in tests through the catalog's external sources. */
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
