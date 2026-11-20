/** Googles Widerrufsliste über die Fremdquellen (im Test ersetzbar) nach laufzustand, wo die
 * Konto-Prüfung sie liest. Eine unlesbare Antwort wirft und lässt die letzte gute Liste stehen. */
import type { JobRun } from '../auftraege';
import { REVOCATION_STATE, readRevocationList } from '../geraete';
import type { CatalogContext } from './kontext';

export async function loadRevocationList(k: CatalogContext, lauf?: JobRun): Promise<void> {
  const nummern = readRevocationList(await k.fremdquellen.quellen.revocationListFetch(lauf?.signal));
  await k.auftraege.setzeZustand(REVOCATION_STATE, JSON.stringify({ stand: k.uhr.datum().toISOString(), nummern }));
  console.log(`[attestation] Widerrufsliste geladen: ${nummern.length} Seriennummern`);
}
