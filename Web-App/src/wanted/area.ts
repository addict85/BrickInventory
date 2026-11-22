/** The area's factory: services as a closure over k (buildArea, src/infra/area.ts). */
import { bound, buildArea, type Inspect } from '../infra/area';
import * as wantedService from './wanted';
import * as wantedListService from './wantedList';
import { access, type WantedDependencies, type WantedContext } from './context';

export type { WantedDependencies, WantedContext } from './context';

export function createWanted(a: WantedDependencies, inspect?: Inspect<WantedContext>) {
  return buildArea(
    a,
    access,
    (k: WantedContext) => ({
      addWantedItem: bound(k)(wantedService.addWantedItem),
      removeWantedItem: bound(k)(wantedService.removeWantedItem),
      moveWantedItem: bound(k)(wantedService.moveWantedItem),
      wantedItemsOf: bound(k)(wantedService.wantedItemsOf),
      fulfillWantedItem: bound(k)(wantedService.fulfillWantedItem),
      wantedListCsv: bound(k)(wantedService.wantedListCsv),
      pricesForBothConditions: bound(k)(wantedService.pricesForBothConditions),
      importWantedListCsv: bound(k)(wantedService.importWantedListCsv),
      importWantedList: bound(k)(wantedListService.importWantedList),
    }),
    inspect,
  );
}

export type WantedServices = ReturnType<typeof createWanted>;
