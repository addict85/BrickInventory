import fs from 'node:fs';
import { logAndContinue, reportError } from '../src/infra/error';
import { konfig } from '../src/infra/config';
import { startJobWorker } from '../jobs/startJobs';
import { FOLLOWUP_RUNS, type FollowUpStep } from '../src/management';
import type { Services } from './wiring';

/** The healthcheck of the `jobs` service (compose.yaml) looks at the age of this file. */
export const HEARTBEAT_FILE = '/tmp/brickinventory-jobs.lebt';
/** The admin sees from the same stamp in laufzustand whether a job process is running. */
export const HEARTBEAT_KEY = 'jobs_lebenszeichen';
const HEARTBEAT_MS = 30_000;
/** If the worker does not complete a round for this long, the sign of life stays out. */
const STILL_AT_MOST_MS = 2 * HEARTBEAT_MS;

/** What startJobs starts and stopJobs ends again; the entry point holds it. */
export interface JobsLauf {
  worker: { lastRound(): number; stop(): Promise<void> } | null;
  lebenszeichen: NodeJS.Timeout | null;
}

/** Only a worker that completes its rounds counts as alive: an interval
 * alone would also report a process whose startup failed. The result
 * ends with writing to the database, so that a test can wait for it. */
export function renewHeartbeat(d: Services, worker: JobsLauf['worker']): Promise<void> {
  if (!worker || Date.now() - worker.lastRound() > STILL_AT_MOST_MS) return Promise.resolve();
  fs.writeFile(HEARTBEAT_FILE, String(Date.now()), { mode: 0o600 }, e => {
    if (e) reportError('jobs:lebenszeichen', e);
  });
  return d.jobQueue.setState(HEARTBEAT_KEY, new Date().toISOString()).catch(logAndContinue('jobs:lebenszeichen'));
}

/** The background work (ROLE=jobs or beides) only runs via jobs; a
 * second job process would be harmless, because each claims jobs with SKIP LOCKED. */
export async function startJobs(d: Services): Promise<JobsLauf> {
  const takenOver = await d.jobQueue.registerProcess();
  if (takenOver) console.log(`[auftraege] ${takenOver} Aufträge eines beendeten Prozesses übernommen`);
  await d.jobQueue.reportStartState({ ready: false, step: 'CSV wird geladen...', progress: 0, total: 6 });
  await d.jobQueue.planeAll();
  await d.jobQueue.pullPlanBefore('csv_sync', 0, { onStart: true });
  await d.jobQueue.pullPlanBefore('aufraeumen', 0);
  await d.jobQueue.pullPlanBefore('preise', 30);
  await d.jobQueue.pullPlanBefore('bild_nachlauf', 30);
  await d.jobQueue.pullPlanBefore('aufraeumen_taeglich', 60);
  await d.jobQueue.pullPlanBefore('widerrufsliste', 0);
  for (const [schritt, { afterSeconds }] of Object.entries(FOLLOWUP_RUNS) as [FollowUpStep, { afterSeconds: number }][])
    await d.jobQueue.placeJobOne(
      'nachlauf',
      { schritt },
      { schluessel: `nachlauf:${schritt}`, afterSeconds, maxAttempts: 3 },
    );
  if (await d.images.openImageDemand()) await d.images.imageDemandKick();
  await d.finances.scheduleRateFetch();
  const worker = startJobWorker(d, { parallel: konfig().jobParallel, deadlineSec: konfig().jobDeadlineSec });
  void renewHeartbeat(d, worker);
  const lebenszeichen = setInterval(() => renewHeartbeat(d, worker), HEARTBEAT_MS);
  lebenszeichen.unref();
  return { worker, lebenszeichen };
}

/** On shutdown: finish running jobs or return them. */
export async function stopJobs(d: Services, lauf: JobsLauf): Promise<void> {
  if (lauf.lebenszeichen) clearInterval(lauf.lebenszeichen);
  lauf.lebenszeichen = null;
  const worker = lauf.worker;
  lauf.worker = null;
  await worker?.stop().catch(logAndContinue('shutdown:auftraege'));
  d.jobQueue.deregisterProcess();
}
