import { createWorker, type Bearbeitertabelle, type WorkerOptions } from './auftragsWorker';
import type { JobKind } from '../src/auftraege';
import type { Dienste } from '../src/dienste';

/** Was die Bereiche in der Verdrahtung angemeldet haben (startup/verdrahtung.ts), je Art. */
const editor = (d: Pick<Dienste, 'auftraege'>): Bearbeitertabelle =>
  Object.fromEntries(d.auftraege.signedInKinds().map(a => [a.art, a]));

/** Der Worker gehört dem, der ihn startet (startup/jobsProzess.ts, Testhilfen): Er hält ihn
 * und beendet ihn mit stoppe(); ein Speicher im Modul liesse zwei Starts einander sehen. */
function startJobWorker(d: Pick<Dienste, 'auftraege'>, o: WorkerOptions & { arten?: JobKind[] } = {}) {
  const alle = editor(d);
  const tabelle: Bearbeitertabelle = o.arten ? Object.fromEntries(o.arten.map(a => [a, alle[a]])) : alle;
  const worker = createWorker(d.auftraege, tabelle, o);
  worker.starte();
  return worker;
}

export type JobWorker = ReturnType<typeof startJobWorker>;
export { editor, startJobWorker };
