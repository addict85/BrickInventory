import { errorMessage, reportError } from '../infra/error';

// A module of its own so that proxy and preview count without reaching through global.
export const imgProxyFailures = {
  timeout: 0,
  error: 0,
  notFound: 0,
  other: 0,
  lastError: null as string | null,
};

/** A side step of delivery failed: it does not hold up the response, but it
 * shows in the diagnostics (counter and last error), not only in the log. */
export function countProxyError(ort: string, e: unknown): void {
  imgProxyFailures.other++;
  imgProxyFailures.lastError = `${ort}: ${errorMessage(e)}`;
  reportError(ort, e);
}
