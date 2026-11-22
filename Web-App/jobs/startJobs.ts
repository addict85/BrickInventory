import { createWorker, type HandlerTable, type WorkerOptions } from './jobWorker';
import type { JobKind } from '../src/jobQueue';
import type { Services } from '../src/services';

/** What the areas registered in the wiring (startup/wiring.ts), per kind. */
const editor = (d: Pick<Services, 'jobQueue'>): HandlerTable =>
  Object.fromEntries(d.jobQueue.signedInKinds().map(a => [a.kind, a]));

/** The worker belongs to whoever starts it (startup/jobsProcess.ts, test helpers): it holds it
 * and ends it with stoppe(); a store in the module would let two starts see each other. */
function startJobWorker(d: Pick<Services, 'jobQueue'>, o: WorkerOptions & { arten?: JobKind[] } = {}) {
  const all = editor(d);
  const table: HandlerTable = o.arten ? Object.fromEntries(o.arten.map(a => [a, all[a]])) : all;
  const worker = createWorker(d.jobQueue, table, o);
  worker.starte();
  return worker;
}

export type JobWorker = ReturnType<typeof startJobWorker>;
export { editor, startJobWorker };
