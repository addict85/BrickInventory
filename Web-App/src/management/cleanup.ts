/** Jeder Schritt meldet seinen Fehler und lässt die übrigen laufen; scheitert
 * einer, wiederholt der Worker den ganzen Lauf — alle Schritte vertragen das. */
import { checkAbort, type JobRun } from '../auftraege';
import { fehlertext } from '../infra/fehler';
import { cleanOldBackupsOn } from '../../db/migrate';
import type { ManagementContext } from './context';

type Step = [name: string, lauf: () => Promise<unknown>];

async function runSteps(schritte: Step[], auftrag?: JobRun): Promise<void> {
  const fehler: string[] = [];
  for (const [name, lauf] of schritte) {
    checkAbort(auftrag);
    try {
      const n = await lauf();
      if (typeof n === 'number' && n > 0) console.log(`[cleanup] ${name}: ${n} entfernt`);
    } catch (e) {
      fehler.push(`${name}: ${fehlertext(e)}`);
    }
  }
  if (fehler.length) throw new Error(fehler.join('; '));
}

function cleanup(k: ManagementContext, lauf?: JobRun): Promise<void> {
  return runSteps(
    [
      ...k.konto.onRaeumSteps('stuendlich'),
      ['Papierkorb', k.bestand.cleanTrashOn],
      ['PDF-Aufträge', k.katalog.pdf.raeumeAuf],
      ['alte Aufträge', k.auftraege.cleanCompletedOn],
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
      ...k.konto.onRaeumSteps('taeglich'),
      ['Bild-Cache', () => k.images.cleanImageCacheOn(k.images.imageLimits().cacheMaxBytes, k.uhr.jetzt())],
      ['Kopien vor Migrationen', () => cleanOldBackupsOn(k.db)],
    ],
    lauf,
  );
}

export { cleanup, cleanupDaily };
