/** Googles Widerrufsliste der Attestierungsschlüssel. Nur dieser Host, keine
 * Umleitung: Eine Liste aus fremder Quelle könnte widerrufene Ketten freigeben. */
import { holeHttps } from '../src/infra/abruf';

export const WIDERRUFSLISTE = 'https://android.googleapis.com/attestation/status';
const HOSTS = ['android.googleapis.com'] as const;

/** Der Körper der Liste; im Test ersetzt über die Fremdquellen des Katalogs. */
export type WiderrufAbruf = (signal?: AbortSignal) => Promise<Buffer>;

export const widerrufslisteAbruf: WiderrufAbruf = async signal => {
  const r = await holeHttps(WIDERRUFSLISTE, {
    hosts: HOSTS,
    maxBytes: 8 * 1024 * 1024,
    zeitlimitMs: 60_000,
    umleitungen: 0,
    ...(signal ? { signal } : {}),
  });
  if (r.status !== 200) throw new Error(`Widerrufsliste: HTTP ${r.status}`);
  return r.koerper;
};
