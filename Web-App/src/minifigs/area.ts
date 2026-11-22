/** The area's factory: services as a closure over k (buildArea, src/infra/area.ts). */
import { withValue, buildArea, type Inspect } from '../infra/area';
import * as queries from './queries';
import * as service from './service';
import * as manualMinifigs from './manualMinifigs';
import { access, type MinifigsDependencies, type MinifigsContext } from './context';

export type { MinifigsDependencies, MinifigsContext } from './context';

export function createMinifigs(a: MinifigsDependencies, inspect?: Inspect<MinifigsContext>) {
  return buildArea(
    a,
    access,
    (k: MinifigsContext) => ({
      readMinifigs: withValue(k)(queries.readMinifigs),
      minifigStats: withValue(k)(queries.computeMinifigStats),
      readManualMinifigs: withValue(k)(queries.readManualMinifigs),
      partsOfMinifig: withValue(k)(service.partsOfMinifig),
      addManualMinifig: withValue(k)(manualMinifigs.addManualMinifig),
      updateManualMinifig: withValue(k)(manualMinifigs.updateManualMinifig),
      minifigAcquisitions: withValue(k)(manualMinifigs.minifigAcquisitionsInScope),
      importMinifigsCsv: withValue(k)(manualMinifigs.importMinifigsCsv),
    }),
    inspect,
  );
}

export type MinifigsServices = ReturnType<typeof createMinifigs>;
