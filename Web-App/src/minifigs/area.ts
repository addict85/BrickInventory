/** The area's factory: services as a closure over k (baueBereich, src/infra/bereich.ts). */
import { mit, baueBereich, type Einblick } from '../infra/bereich';
import * as queries from './queries';
import * as service from './service';
import * as manualMinifigs from './manualMinifigs';
import { access, type MinifigsDependencies, type MinifigsContext } from './context';

export type { MinifigsDependencies, MinifigsContext } from './context';

export function createMinifigs(a: MinifigsDependencies, einblick?: Einblick<MinifigsContext>) {
  return baueBereich(
    a,
    access,
    (k: MinifigsContext) => ({
      readMinifigs: mit(k)(queries.readMinifigs),
      minifigStats: mit(k)(queries.computeMinifigStats),
      readManualMinifigs: mit(k)(queries.readManualMinifigs),
      partsOfMinifig: mit(k)(service.partsOfMinifig),
      addManualMinifig: mit(k)(manualMinifigs.addManualMinifig),
      updateManualMinifig: mit(k)(manualMinifigs.updateManualMinifig),
      minifigAcquisitions: mit(k)(manualMinifigs.minifigAcquisitionsInScope),
      importMinifigsCsv: mit(k)(manualMinifigs.importMinifigsCsv),
    }),
    einblick,
  );
}

export type MinifigsServices = ReturnType<typeof createMinifigs>;
