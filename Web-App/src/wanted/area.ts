/** The area's factory: services as a closure over k (buildArea, src/infra/area.ts). */
import { withValue, buildArea, type Inspect } from '../infra/area';
import * as wantedService from './wanted';
import * as wantedListService from './wantedList';
import { access, type WantedDependencies, type WantedContext } from './context';

export type { WantedDependencies, WantedContext } from './context';

export function createWanted(a: WantedDependencies, inspect?: Inspect<WantedContext>) {
  return buildArea(
    a,
    access,
    (k: WantedContext) => ({
      addWantedItem: withValue(k)(wantedService.addWantedItem),
      removeWantedItem: withValue(k)(wantedService.removeWantedItem),
      moveWantedItem: withValue(k)(wantedService.moveWantedItem),
      wantedItemsOf: withValue(k)(wantedService.wantedItemsOf),
      fulfillWantedItem: withValue(k)(wantedService.fulfillWantedItem),
      wantedListCsv: withValue(k)(wantedService.wantedListCsv),
      pricesForBothConditions: withValue(k)(wantedService.pricesForBothConditions),
      importWantedListCsv: withValue(k)(wantedService.importWantedListCsv),
      importWantedList: withValue(k)(wantedListService.importiereWantedListe),
    }),
    inspect,
  );
}

export type WantedServices = ReturnType<typeof createWanted>;
