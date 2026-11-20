/** Googles Widerrufsliste über die Fremdquellen (im Test ersetzbar) nach laufzustand, wo die
 * Konto-Prüfung sie liest. Eine unlesbare Antwort wirft und lässt die letzte gute Liste stehen. */
import type { JobRun } from '../jobQueue';
import { REVOCATION_STATE, readRevocationList } from '../devices';
import type { CatalogContext } from './context';

export async function loadRevocationList(k: CatalogContext, lauf?: JobRun): Promise<void> {
  const nummern = readRevocationList(await k.externalSources.quellen.revocationListFetch(lauf?.signal));
  await k.jobQueue.setzeZustand(REVOCATION_STATE, JSON.stringify({ stand: k.uhr.datum().toISOString(), nummern }));
  console.log(`[attestation] Widerrufsliste geladen: ${nummern.length} Seriennummern`);
}
