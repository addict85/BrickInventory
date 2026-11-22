/** The area's factory: services as a closure over k (buildArea, src/infra/area.ts). */
import { bound, buildArea, type Inspect } from '../infra/area';
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
      dataZip: bound(k)(dataExport.dataZip),
      importConfig: bound(k)(dataExport.importConfig),
      exportConfig: bound(k)(dataExport.exportConfig),
      priceProbe: bound(k)(diagnostics.priceProbe),
      imageProbe: bound(k)(diagnostics.imageProbe),
      imageDiagnostics: bound(k)(diagnostics.imageDiagnostics),
      cacheStats: bound(k)(service.cacheStats),
      requeueInstructions: bound(k)(service.requeueInstructions),
      priceJobStatus: bound(k)(service.priceJobStatus),
      queueCatalogImages: bound(k)(service.queueCatalogImages),
      forgetImageMisses: bound(k)(service.forgetImageMisses),
      serverLogSince: bound(k)(service.serverLogSince),
      clearCaches: bound(k)(service.clearCaches),
      bricksetLimitSet: bound(k)(service.bricksetLimitSet),
      runPriceJobNow: bound(k)(service.runPriceJobNow),
      reloadMissingImages: bound(k)(service.reloadMissingImages),
      runCatalogSyncNow: bound(k)(service.runCatalogSyncNow),
      retryBrickset: bound(k)(service.retryBrickset),
      removeBrickset: bound(k)(service.removeBrickset),
      setJobSchedule: bound(k)(service.setJobSchedule),
      checkSource: bound(k)(service.checkSource),
      healthReport: bound(k)(health.healthReport),
      databaseReady: bound(k)(health.databaseReady),
      jobMonitor: bound(k)(jobMonitor.jobMonitor),
      saveSettings: bound(k)(saveSettings.saveSettings),
      jobsOverview: bound(k)(background.jobsOverview),
      clearJobType: bound(k)(background.clearJobType),
    }),
    inspect,
  );
}

export type ManagementServices = ReturnType<typeof createManagement>;
