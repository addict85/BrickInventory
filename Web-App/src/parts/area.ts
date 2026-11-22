/** The area's factory: services as a closure over k (buildArea, src/infra/area.ts). */
import { bound, buildArea, type Inspect } from '../infra/area';
import { Compartments } from '../infra/cache';
import * as queries from './queries';
import * as manualPartsService from './manualParts';
import * as changeColorService from './changeColor';
import { partsJobKinds } from './jobKinds';
import { access, type PartsDependencies, type PartsContext } from './context';

export type { PartsDependencies, PartsContext } from './context';

export function createParts(a: Omit<PartsDependencies, 'faecher'>, inspect?: Inspect<PartsContext>) {
  return buildArea(
    { ...a, faecher: new Compartments() },
    access,
    (k: PartsContext) => ({
      partColors: bound(k)(queries.partColorsQuery),
      readParts: bound(k)(queries.partsQuery),
      partCategories: bound(k)(queries.partCategoriesQuery),
      partStats: bound(k)(queries.partStatsQuery),
      readManualParts: bound(k)(queries.manualPartsList),
      ownedQuantities: bound(k)(queries.ownedQuantitiesQuery),
      blColorMap: bound(k)(queries.blColorMapQuery),
      addManualPart: bound(k)(manualPartsService.addManualPart),
      changeManualPart: bound(k)(manualPartsService.changeManualPart),
      partAcquisitions: bound(k)(manualPartsService.listPartAcquisitions),
      importPartsCsv: bound(k)(manualPartsService.importPartsCsv),
      changePartColor: bound(k)(changeColorService.changePartColor),
      jobKinds: () => partsJobKinds(k),
    }),
    inspect,
  );
}

export type PartsServices = ReturnType<typeof createParts>;
