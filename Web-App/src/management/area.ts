/** Die Fabrik des Bereichs: Dienste als Closure über k (buildArea, src/infra/bereich.ts). */
import { mit, buildArea, type Inspect } from '../infra/bereich';
import { managementJobTypes } from './jobTypes';
import * as dataExport from './dataExport';
import * as diagnostics from './diagnostics';
import * as service from './service';
import * as health from './health';
import * as jobMonitor from './jobMonitor';
import * as saveSettings from './saveSettings';
import * as background from './background';
import { zugang, type ManagementDependencies, type ManagementContext } from './context';

export type { ManagementDependencies, ManagementContext } from './context';

export function createManagement(a: ManagementDependencies, inspect?: Inspect<ManagementContext>) {
  return buildArea(
    a,
    zugang,
    (k: ManagementContext) => ({
      jobTypes: () => managementJobTypes(k),
      dataZip: mit(k)(dataExport.dataZip),
      importConfig: mit(k)(dataExport.importConfig),
      exportConfig: mit(k)(dataExport.exportConfig),
      priceProbe: mit(k)(diagnostics.priceProbe),
      imageProbe: mit(k)(diagnostics.imageProbe),
      imageDiagnostics: mit(k)(diagnostics.imageDiagnostics),
      cacheStats: mit(k)(service.cacheStats),
      requeueInstructions: mit(k)(service.requeueInstructions),
      priceJobStatus: mit(k)(service.priceJobStatus),
      queueCatalogImages: mit(k)(service.queueCatalogImages),
      forgetImageMisses: mit(k)(service.forgetImageMisses),
      serverLogSince: mit(k)(service.serverLogSince),
      clearCaches: mit(k)(service.clearCaches),
      bricksetLimitSet: mit(k)(service.bricksetLimitSet),
      runPriceJobNow: mit(k)(service.runPriceJobNow),
      reloadMissingImages: mit(k)(service.reloadMissingImages),
      runCatalogSyncNow: mit(k)(service.runCatalogSyncNow),
      retryBrickset: mit(k)(service.retryBrickset),
      removeBrickset: mit(k)(service.removeBrickset),
      setJobSchedule: mit(k)(service.setJobSchedule),
      checkSource: mit(k)(service.checkSource),
      healthReport: mit(k)(health.healthReport),
      databaseReady: mit(k)(health.databaseReady),
      jobMonitor: mit(k)(jobMonitor.jobMonitor),
      saveSettings: mit(k)(saveSettings.saveSettings),
      jobsOverview: mit(k)(background.jobsOverview),
      clearJobType: mit(k)(background.clearJobType),
    }),
    inspect,
  );
}

export type ManagementServices = ReturnType<typeof createManagement>;
