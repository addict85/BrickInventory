import { createWorker, type Bearbeitertabelle, type WorkerOptions } from './jobWorker';
import type { JobKind } from '../src/jobQueue';
import type { Dienste } from '../src/services';

/** What the areas registered in the wiring (startup/wiring.ts), per kind. */
const editor = (d: Pick<Dienste, 'jobQueue'>): Bearbeitertabelle =>
  Object.fromEntries(d.jobQueue.signedInKinds().map(a => [a.art, a]));

/** The worker belongs to whoever starts it (startup/jobsProcess.ts, test helpers): it holds it
 * and ends it with stoppe(); a store in the module would let two starts see each other. */
function startJobWorker(d: Pick<Dienste, 'jobQueue'>, o: WorkerOptions & { arten?: JobKind[] } = {}) {
  const alle = editor(d);
  const tabelle: Bearbeitertabelle = o.arten ? Object.fromEntries(o.arten.map(a => [a, alle[a]])) : alle;
  const worker = createWorker(d.jobQueue, tabelle, o);
  worker.starte();
  return worker;
}

export type JobWorker = ReturnType<typeof startJobWorker>;
export { editor, startJobWorker };
