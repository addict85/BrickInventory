/** Google's revocation list via the external sources (replaceable in tests) into laufzustand, where the
 * account check reads it. An unreadable response throws and leaves the last good list standing. */
import type { JobRun } from '../jobQueue';
import { REVOCATION_STATE, readRevocationList } from '../devices';
import type { CatalogContext } from './context';

export async function loadRevocationList(k: CatalogContext, run?: JobRun): Promise<void> {
  const numbers = readRevocationList(await k.externalSources.sources.revocationListFetch(run?.signal));
  await k.jobQueue.setState(
    REVOCATION_STATE,
    JSON.stringify({ state: k.clock.date().toISOString(), nummern: numbers }),
  );
  console.log(`[attestation] Widerrufsliste geladen: ${numbers.length} Seriennummern`);
}
