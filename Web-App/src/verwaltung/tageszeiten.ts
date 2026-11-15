/** Die Läufe mit eingestellter Tageszeit, wie die Überwachungsseite sie zeigt und setzt. */
import { BRICKSET_UHRZEIT } from '../fremdquellen';
import { KATALOG_ABGLEICH_UHRZEIT } from '../katalog';

export const DAILY_JOBS = [
  { name: 'brickset_retry', monitorKey: 'bricksetRetry', default: BRICKSET_UHRZEIT.vorgabe },
  { name: 'csv_sync', monitorKey: 'csvImport', default: KATALOG_ABGLEICH_UHRZEIT.vorgabe },
] as const;
