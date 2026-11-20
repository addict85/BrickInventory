/** The area's factory: services as a closure over k (buildArea, src/infra/bereich.ts). */
import { mit, buildArea, type Inspect } from '../infra/bereich';
import * as wantedService from './wanted';
import * as wantedListService from './wantedListe';
import { access, type WantedDependencies, type WantedContext } from './context';

export type { WantedDependencies, WantedContext } from './context';

export function createWanted(a: WantedDependencies, inspect?: Inspect<WantedContext>) {
  return buildArea(
    a,
    access,
    (k: WantedContext) => ({
      addWantedItem: mit(k)(wantedService.addWantedItem),
      removeWantedItem: mit(k)(wantedService.removeWantedItem),
      moveWantedItem: mit(k)(wantedService.moveWantedItem),
      wantedItemsOf: mit(k)(wantedService.wantedItemsOf),
      fulfillWantedItem: mit(k)(wantedService.fulfillWantedItem),
      wantedListCsv: mit(k)(wantedService.wantedListCsv),
      pricesForBothConditions: mit(k)(wantedService.pricesForBothConditions),
      importWantedListCsv: mit(k)(wantedService.importWantedListCsv),
      importWantedList: mit(k)(wantedListService.importiereWantedListe),
    }),
    inspect,
  );
}

export type WantedServices = ReturnType<typeof createWanted>;
