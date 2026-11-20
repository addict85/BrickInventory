import fs from 'node:fs';
import { logAndContinue, reportError } from '../src/infra/fehler';
import { konfig } from '../src/infra/konfig';
import { startJobWorker } from '../jobs/auftraegeStarten';
import { FOLLOWUP_RUNS, type FollowUpStep } from '../src/management';
import type { Dienste } from './verdrahtung';

/** Der Healthcheck des Dienstes `jobs` (compose.yaml) sieht auf das Alter dieser Datei. */
export const HEARTBEAT_FILE = '/tmp/brickinventory-jobs.lebt';
/** Die Verwaltung sieht am selben Stempel in laufzustand, ob ein Job-Prozess läuft. */
export const HEARTBEAT_KEY = 'jobs_lebenszeichen';
const HEARTBEAT_MS = 30_000;
/** Dreht der Worker so lange keine Runde mehr, bleibt das Lebenszeichen aus. */
const STILL_AT_MOST_MS = 2 * HEARTBEAT_MS;

/** Was startJobs startet und stopJobs wieder beendet; der Einstieg hält es. */
export interface JobsLauf {
  worker: { lastRound(): number; stop(): Promise<void> } | null;
  lebenszeichen: NodeJS.Timeout | null;
}

/** Nur ein Worker, der seine Runden dreht, gilt als lebendig: Ein Intervall
 * allein meldete auch einen Prozess, dessen Start gescheitert ist. Das Ergebnis
 * endet mit dem Schreiben in die Datenbank, damit ein Test darauf warten kann. */
export function renewHeartbeat(d: Dienste, worker: JobsLauf['worker']): Promise<void> {
  if (!worker || Date.now() - worker.lastRound() > STILL_AT_MOST_MS) return Promise.resolve();
  fs.writeFile(HEARTBEAT_FILE, String(Date.now()), { mode: 0o600 }, e => {
    if (e) reportError('jobs:lebenszeichen', e);
  });
  return d.auftraege.setzeZustand(HEARTBEAT_KEY, new Date().toISOString()).catch(logAndContinue('jobs:lebenszeichen'));
}

/** Die Hintergrundarbeit (ROLLE=jobs oder beides) läuft nur über Aufträge; ein
 * zweiter Job-Prozess wäre unschädlich, weil jeder Aufträge mit SKIP LOCKED belegt. */
export async function startJobs(d: Dienste): Promise<JobsLauf> {
  const uebernommen = await d.auftraege.reportProcessAn();
  if (uebernommen) console.log(`[auftraege] ${uebernommen} Aufträge eines beendeten Prozesses übernommen`);
  await d.auftraege.reportStartState({ ready: false, step: 'CSV wird geladen...', progress: 0, total: 6 });
  await d.auftraege.planeAll();
  await d.auftraege.pullPlanBefore('csv_sync', 0, { onStart: true });
  await d.auftraege.pullPlanBefore('aufraeumen', 0);
  await d.auftraege.pullPlanBefore('preise', 30);
  await d.auftraege.pullPlanBefore('bild_nachlauf', 30);
  await d.auftraege.pullPlanBefore('aufraeumen_taeglich', 60);
  await d.auftraege.pullPlanBefore('widerrufsliste', 0);
  for (const [schritt, { afterSeconds }] of Object.entries(FOLLOWUP_RUNS) as [FollowUpStep, { afterSeconds: number }][])
    await d.auftraege.placeJobOne(
      'nachlauf',
      { schritt },
      { schluessel: `nachlauf:${schritt}`, afterSeconds, maxAttempts: 3 },
    );
  if (await d.bilder.openImageDemand()) await d.bilder.imageDemandKick();
  await d.finanzen.planeKursabruf();
  const worker = startJobWorker(d, { parallel: konfig().jobParallel, deadlineSec: konfig().jobDeadlineSec });
  void renewHeartbeat(d, worker);
  const lebenszeichen = setInterval(() => renewHeartbeat(d, worker), HEARTBEAT_MS);
  lebenszeichen.unref();
  return { worker, lebenszeichen };
}

/** Beim Herunterfahren: laufende Aufträge zu Ende führen oder zurückgeben. */
export async function stopJobs(d: Dienste, lauf: JobsLauf): Promise<void> {
  if (lauf.lebenszeichen) clearInterval(lauf.lebenszeichen);
  lauf.lebenszeichen = null;
  const worker = lauf.worker;
  lauf.worker = null;
  await worker?.stop().catch(logAndContinue('shutdown:auftraege'));
  d.auftraege.reportProcessAb();
}
