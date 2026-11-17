/** The area's factory: services as a closure over k (baueBereich, src/infra/bereich.ts). */
import { mit, baueBereich, type Einblick } from '../infra/bereich';
import * as wantedDienst from './wanted';
import * as wantedListeDienst from './wantedListe';
import { access, type WantedDependencies, type WantedContext } from './context';

export type { WantedDependencies, WantedContext } from './context';

export function createWanted(a: WantedDependencies, einblick?: Einblick<WantedContext>) {
  return baueBereich(
    a,
    access,
    (k: WantedContext) => ({
      addWantedItem: mit(k)(wantedDienst.addWantedItem),
      removeWantedItem: mit(k)(wantedDienst.removeWantedItem),
      moveWantedItem: mit(k)(wantedDienst.moveWantedItem),
      wantedItemsOf: mit(k)(wantedDienst.wantedItemsOf),
      fulfillWantedItem: mit(k)(wantedDienst.fulfillWantedItem),
      wantedListCsv: mit(k)(wantedDienst.wantedListCsv),
      pricesForBothConditions: mit(k)(wantedDienst.pricesForBothConditions),
      importWantedListCsv: mit(k)(wantedDienst.importWantedListCsv),
      importWantedList: mit(k)(wantedListeDienst.importiereWantedListe),
    }),
    einblick,
  );
}

export type WantedServices = ReturnType<typeof createWanted>;
