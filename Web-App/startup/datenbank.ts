import * as db from '../db/database';
import { logAndContinue } from '../src/infra/httpError';
import { initImageMisses } from '../utils/imageMisses';
import { initImageQueue } from '../jobs/imageQueue';

/**
 * Schema und Migrationen, danach die Bild-Hilfsdienste — in JEDEM
 * Arbeitsprozess, weil sie prozess-lokal sind (Bestand im Speicher, Takt des
 * Puffers). Hier und nicht in db/: Die Datenbankschicht kennt keine Jobs.
 */
export async function bereiteDatenbankVor(): Promise<void> {
  await db.initSchemaOnce();
  await initImageMisses().catch(logAndContinue('db:image_misses'));
  await initImageQueue().catch(logAndContinue('db:image_wanted'));
}
