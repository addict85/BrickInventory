/** Every step reports its error and lets the others run; if one
 * fails, the worker repeats the whole run — all steps tolerate that. */
import { checkAbort, type JobRun } from '../jobQueue';
import { errorMessage } from '../infra/error';
import { cleanOldBackupsOn } from '../../db/migrate';
import type { ManagementContext } from './context';

type Step = [name: string, lauf: () => Promise<unknown>];

async function runSteps(steps: Step[], job?: JobRun): Promise<void> {
  const error: string[] = [];
  for (const [name, lauf] of steps) {
    checkAbort(job);
    try {
      const n = await lauf();
      if (typeof n === 'number' && n > 0) console.log(`[cleanup] ${name}: ${n} entfernt`);
    } catch (e) {
      error.push(`${name}: ${errorMessage(e)}`);
    }
  }
  if (error.length) throw new Error(error.join('; '));
}

function cleanup(k: ManagementContext, lauf?: JobRun): Promise<void> {
  return runSteps(
    [
      ...k.account.onCleanupSteps('stuendlich'),
      ['Papierkorb', k.inventory.cleanTrashOn],
      ['PDF-Aufträge', k.catalog.pdf.cleanUp],
      ['alte Aufträge', k.jobQueue.cleanCompletedOn],
      ['verfallene Bildwünsche', k.images.deleteExpired],
      ['Idempotenzschlüssel', k.idempotency.cleanupIdempotency],
    ],
    lauf,
  );
}

function cleanupDaily(k: ManagementContext, lauf?: JobRun): Promise<void> {
  return runSteps(
    [
      ['Preisverlauf', k.finances.deleteOldPrices],
      ...k.account.onCleanupSteps('taeglich'),
      ['Bild-Cache', () => k.images.cleanImageCacheOn(k.images.imageLimits().cacheMaxBytes, k.uhr.jetzt())],
      ['Kopien vor Migrationen', () => cleanOldBackupsOn(k.db)],
    ],
    lauf,
  );
}

export { cleanup, cleanupDaily };
