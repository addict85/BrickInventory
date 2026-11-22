/** The area's factory: services as a closure over k (buildArea, src/infra/area.ts). */
import { withValue, buildArea, type Inspect } from '../infra/area';
import { Faecher } from '../infra/cache';
import * as queries from './queries';
import * as manualPartsService from './manualParts';
import * as changeColorService from './changeColor';
import { partsJobKinds } from './jobKinds';
import { access, type PartsDependencies, type PartsContext } from './context';

export type { PartsDependencies, PartsContext } from './context';

export function createParts(a: Omit<PartsDependencies, 'faecher'>, inspect?: Inspect<PartsContext>) {
  return buildArea(
    { ...a, faecher: new Faecher() },
    access,
    (k: PartsContext) => ({
      partColors: withValue(k)(queries.partColorsQuery),
      readParts: withValue(k)(queries.partsQuery),
      partCategories: withValue(k)(queries.partCategoriesQuery),
      partStats: withValue(k)(queries.partStatsQuery),
      readManualParts: withValue(k)(queries.manualPartsList),
      ownedQuantities: withValue(k)(queries.ownedQuantitiesQuery),
      blColorMap: withValue(k)(queries.blColorMapQuery),
      addManualPart: withValue(k)(manualPartsService.addManualPart),
      changeManualPart: withValue(k)(manualPartsService.changeManualPart),
      partAcquisitions: withValue(k)(manualPartsService.listPartAcquisitions),
      importPartsCsv: withValue(k)(manualPartsService.importPartsCsv),
      changePartColor: withValue(k)(changeColorService.changePartColor),
      jobKinds: () => partsJobKinds(k),
    }),
    inspect,
  );
}

export type PartsServices = ReturnType<typeof createParts>;
