import { BRICKSET_TIME_OF_DAY } from '../externalSources';
import { CATALOG_SYNC_TIME_OF_DAY } from '../catalog';

export const DAILY_JOBS = [
  { name: 'brickset_retry', monitorKey: 'bricksetRetry', default: BRICKSET_TIME_OF_DAY.preset },
  { name: 'csv_sync', monitorKey: 'csvImport', default: CATALOG_SYNC_TIME_OF_DAY.preset },
] as const;
