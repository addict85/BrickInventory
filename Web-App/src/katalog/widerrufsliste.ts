/** Googles Widerrufsliste über die Fremdquellen (im Test ersetzbar) nach laufzustand, wo die
 * Konto-Prüfung sie liest. Eine unlesbare Antwort wirft und lässt die letzte gute Liste stehen. */
import type { AuftragsLauf } from '../auftraege';
import { WIDERRUF_ZUSTAND, leseWiderrufsliste } from '../konto';
import { quellen } from './fremdquellen';
import type { KatalogKontext } from './kontext';

export async function ladeWiderrufsliste(k: KatalogKontext, lauf?: AuftragsLauf): Promise<void> {
  const nummern = leseWiderrufsliste(await quellen(k).widerrufslisteAbruf(lauf?.signal));
  await k.auftraege.setzeZustand(WIDERRUF_ZUSTAND, JSON.stringify({ stand: new Date().toISOString(), nummern }));
  console.log(`[attestation] Widerrufsliste geladen: ${nummern.length} Seriennummern`);
}
