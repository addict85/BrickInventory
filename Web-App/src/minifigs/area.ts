/** The area's factory: services as a closure over k (buildArea, src/infra/area.ts). */
import { bound, buildArea, type Inspect } from '../infra/area';
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
      readMinifigs: bound(k)(queries.readMinifigs),
      minifigStats: bound(k)(queries.computeMinifigStats),
      readManualMinifigs: bound(k)(queries.readManualMinifigs),
      partsOfMinifig: bound(k)(service.partsOfMinifig),
      addManualMinifig: bound(k)(manualMinifigs.addManualMinifig),
      updateManualMinifig: bound(k)(manualMinifigs.updateManualMinifig),
      minifigAcquisitions: bound(k)(manualMinifigs.minifigAcquisitionsInScope),
      importMinifigsCsv: bound(k)(manualMinifigs.importMinifigsCsv),
    }),
    inspect,
  );
}

export type MinifigsServices = ReturnType<typeof createMinifigs>;
