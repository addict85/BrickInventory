/** The area's factory: services as a closure over k (buildArea, src/infra/bereich.ts). */
import { mit, buildArea, type Inspect } from '../infra/bereich';
import { Faecher } from '../infra/zwischenspeicher';
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
      partColors: mit(k)(queries.partColorsQuery),
      readParts: mit(k)(queries.partsQuery),
      partCategories: mit(k)(queries.partCategoriesQuery),
      partStats: mit(k)(queries.partStatsQuery),
      readManualParts: mit(k)(queries.manualPartsList),
      ownedQuantities: mit(k)(queries.ownedQuantitiesQuery),
      blColorMap: mit(k)(queries.blColorMapQuery),
      addManualPart: mit(k)(manualPartsService.addManualPart),
      changeManualPart: mit(k)(manualPartsService.changeManualPart),
      partAcquisitions: mit(k)(manualPartsService.listPartAcquisitions),
      importPartsCsv: mit(k)(manualPartsService.importPartsCsv),
      changePartColor: mit(k)(changeColorService.changePartColor),
      jobKinds: () => partsJobKinds(k),
    }),
    inspect,
  );
}

export type PartsServices = ReturnType<typeof createParts>;
