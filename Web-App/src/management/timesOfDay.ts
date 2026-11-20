import { BRICKSET_TIME_OF_DAY } from '../fremdquellen';
import { CATALOG_SYNC_TIME_OF_DAY } from '../katalog';

export const DAILY_JOBS = [
  { name: 'brickset_retry', monitorKey: 'bricksetRetry', default: BRICKSET_TIME_OF_DAY.vorgabe },
  { name: 'csv_sync', monitorKey: 'csvImport', default: CATALOG_SYNC_TIME_OF_DAY.vorgabe },
] as const;
