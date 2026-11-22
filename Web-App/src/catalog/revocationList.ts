/** Google's revocation list via the external sources (replaceable in tests) into laufzustand, where the
 * account check reads it. An unreadable response throws and leaves the last good list standing. */
import type { JobRun } from '../jobQueue';
import { REVOCATION_STATE, readRevocationList } from '../devices';
import type { CatalogContext } from './context';

export async function loadRevocationList(k: CatalogContext, lauf?: JobRun): Promise<void> {
  const nummern = readRevocationList(await k.externalSources.quellen.revocationListFetch(lauf?.signal));
  await k.jobQueue.setState(REVOCATION_STATE, JSON.stringify({ stand: k.uhr.datum().toISOString(), nummern }));
  console.log(`[attestation] Widerrufsliste geladen: ${nummern.length} Seriennummern`);
}
