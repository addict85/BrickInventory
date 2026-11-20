import { createWorker, type Bearbeitertabelle, type WorkerOptions } from './jobWorker';
import type { JobKind } from '../src/jobQueue';
import type { Dienste } from '../src/services';

/** Was die Bereiche in der Verdrahtung angemeldet haben (startup/wiring.ts), je Art. */
const editor = (d: Pick<Dienste, 'jobQueue'>): Bearbeitertabelle =>
  Object.fromEntries(d.jobQueue.signedInKinds().map(a => [a.art, a]));

/** Der Worker gehört dem, der ihn startet (startup/jobsProcess.ts, Testhilfen): Er hält ihn
 * und beendet ihn mit stoppe(); ein Speicher im Modul liesse zwei Starts einander sehen. */
function startJobWorker(d: Pick<Dienste, 'jobQueue'>, o: WorkerOptions & { arten?: JobKind[] } = {}) {
  const alle = editor(d);
  const tabelle: Bearbeitertabelle = o.arten ? Object.fromEntries(o.arten.map(a => [a, alle[a]])) : alle;
  const worker = createWorker(d.jobQueue, tabelle, o);
  worker.starte();
  return worker;
}

export type JobWorker = ReturnType<typeof startJobWorker>;
export { editor, startJobWorker };
