/** The area's factory: services as a closure over k (buildArea, src/infra/area.ts). */
import { withValue, buildArea, type Inspect } from '../infra/area';
import { managementJobTypes } from './jobTypes';
import * as dataExport from './dataExport';
import * as diagnostics from './diagnostics';
import * as service from './service';
import * as health from './health';
import * as jobMonitor from './jobMonitor';
import * as saveSettings from './saveSettings';
import * as background from './background';
import { access, type ManagementDependencies, type ManagementContext } from './context';

export type { ManagementDependencies, ManagementContext } from './context';

export function createManagement(a: ManagementDependencies, inspect?: Inspect<ManagementContext>) {
  return buildArea(
    a,
    access,
    (k: ManagementContext) => ({
      jobTypes: () => managementJobTypes(k),
      dataZip: withValue(k)(dataExport.dataZip),
      importConfig: withValue(k)(dataExport.importConfig),
      exportConfig: withValue(k)(dataExport.exportConfig),
      priceProbe: withValue(k)(diagnostics.priceProbe),
      imageProbe: withValue(k)(diagnostics.imageProbe),
      imageDiagnostics: withValue(k)(diagnostics.imageDiagnostics),
      cacheStats: withValue(k)(service.cacheStats),
      requeueInstructions: withValue(k)(service.requeueInstructions),
      priceJobStatus: withValue(k)(service.priceJobStatus),
      queueCatalogImages: withValue(k)(service.queueCatalogImages),
      forgetImageMisses: withValue(k)(service.forgetImageMisses),
      serverLogSince: withValue(k)(service.serverLogSince),
      clearCaches: withValue(k)(service.clearCaches),
      bricksetLimitSet: withValue(k)(service.bricksetLimitSet),
      runPriceJobNow: withValue(k)(service.runPriceJobNow),
      reloadMissingImages: withValue(k)(service.reloadMissingImages),
      runCatalogSyncNow: withValue(k)(service.runCatalogSyncNow),
      retryBrickset: withValue(k)(service.retryBrickset),
      removeBrickset: withValue(k)(service.removeBrickset),
      setJobSchedule: withValue(k)(service.setJobSchedule),
      checkSource: withValue(k)(service.checkSource),
      healthReport: withValue(k)(health.healthReport),
      databaseReady: withValue(k)(health.databaseReady),
      jobMonitor: withValue(k)(jobMonitor.jobMonitor),
      saveSettings: withValue(k)(saveSettings.saveSettings),
      jobsOverview: withValue(k)(background.jobsOverview),
      clearJobType: withValue(k)(background.clearJobType),
    }),
    inspect,
  );
}

export type ManagementServices = ReturnType<typeof createManagement>;
