import fs from 'fs';
import * as pgNotify from '../utils/pgNotify';
import { HAUSHALT_KANAL, leereHaushaltCache } from '../utils/household';
import { meldeStartZustand } from '../utils/startZustand';
import { liesZustand, loescheZustand } from '../utils/laufzustand';
import { fehlertext, logAndContinue, meldeUndWeiter } from '../utils/httpError';
import { starteHintergrundlaeufe } from './backgroundJobs';
import { starteBildNachlauf } from './bildNachlauf';
import { stoppeAuftragsWorker } from '../jobs/auftraegeStarten';
import * as csvSync from '../jobs/rebrickableCsvSync';
import * as scheduler from '../jobs/dailyScheduler';
import { processRetryQueue } from '../jobs/bricksetRetry';

/** Der Healthcheck des Dienstes `jobs` (compose.yaml) sieht auf das Alter dieser Datei. */
export const LEBENSZEICHEN_DATEI = '/tmp/brickinventory-jobs.lebt';
const LEBENSZEICHEN_MS = 30_000;
let _lebenszeichen: NodeJS.Timeout | null = null;

function schreibeLebenszeichen(): void {
  fs.writeFile(LEBENSZEICHEN_DATEI, String(Date.now()), (e) => { if (e) meldeUndWeiter('jobs:lebenszeichen', e); });
}

/**
 * Die Hintergrundarbeit dieses Prozesses (ROLLE=jobs oder beides). Ein zweiter
 * Job-Prozess wäre unschädlich: Aufträge belegt jeder nur mit SKIP LOCKED.
 */
export async function starteJobs(beides: boolean): Promise<void> {
  schreibeLebenszeichen();
  _lebenszeichen = setInterval(schreibeLebenszeichen, LEBENSZEICHEN_MS);
  _lebenszeichen.unref();
  // Nur ein getrennter Job-Prozess hält eigene Haushalt-Caches, die der Web-Prozess ändert.
  if (!beides) pgNotify.listen(HAUSHALT_KANAL, () => leereHaushaltCache());

  await meldeStartZustand({ ready: false, step: 'CSV wird geladen...', progress: 0, total: 6 });
  try { await csvSync.run(); }
  catch (e) {
    console.error('[rb-csv-sync] startup error:', fehlertext(e));
    await meldeStartZustand({ ready: true, step: 'Fehler beim CSV-Import', progress: 6, total: 6 });
  }
  await starteHintergrundlaeufe();

  scheduler.register('brickset_retry', () => processRetryQueue().catch(e => console.error('[brickset-retry]', e.message)));
  scheduler.register('csv_sync', () => loescheZustand('rb_csv_last_sync').then(() => csvSync.run())
    .catch(e => console.error('[rb-csv-sync daily]', e.message)));
  scheduler.startTriggerPoll();
  let csvLaeuft = false;
  pgNotify.listen('csv_sync_trigger', async () => {
    if (csvLaeuft) return;
    try {
      const ausloeser = await liesZustand('csv_sync_trigger');
      if (!ausloeser) return;
      await loescheZustand('csv_sync_trigger', 'rb_csv_last_sync');
      csvLaeuft = true;
      await csvSync.run().catch(e => console.error('[rb-csv-sync manual]', e.message));
    } catch (e) { meldeUndWeiter('jobs:csv-abgleich-anstossen', e); }
    finally { csvLaeuft = false; }
  });
  starteBildNachlauf();
}

/** Beim Herunterfahren: laufende Aufträge zu Ende führen oder zurückgeben. */
export async function stoppeJobs(): Promise<void> {
  if (_lebenszeichen) clearInterval(_lebenszeichen);
  _lebenszeichen = null;
  await stoppeAuftragsWorker().catch(logAndContinue('shutdown:auftraege'));
}
