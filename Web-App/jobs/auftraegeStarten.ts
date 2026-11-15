import { erzeugeWorker, type Bearbeitertabelle, type WorkerOptionen } from './auftragsWorker';
import type { AuftragsArt } from '../src/auftraege';
import type { Dienste } from '../src/dienste';

/** Was die Bereiche in der Verdrahtung angemeldet haben (startup/verdrahtung.ts), je Art. */
const bearbeiter = (d: Pick<Dienste, 'auftraege'>): Bearbeitertabelle =>
  Object.fromEntries(d.auftraege.angemeldeteArten().map(a => [a.art, a]));

/** Der Worker gehört dem, der ihn startet (startup/jobsProzess.ts, Testhilfen): Er hält ihn
 * und beendet ihn mit stoppe(); ein Speicher im Modul liesse zwei Starts einander sehen. */
function starteAuftragsWorker(d: Pick<Dienste, 'auftraege'>, o: WorkerOptionen & { arten?: AuftragsArt[] } = {}) {
  const alle = bearbeiter(d);
  const tabelle: Bearbeitertabelle = o.arten ? Object.fromEntries(o.arten.map(a => [a, alle[a]])) : alle;
  const worker = erzeugeWorker(d.auftraege, tabelle, o);
  worker.starte();
  return worker;
}

export type AuftragsWorker = ReturnType<typeof starteAuftragsWorker>;
export { bearbeiter, starteAuftragsWorker };
