import {
  receiptId,
  type JobsServices,
  type JobKind,
  type JobRow,
  type Bearbeiter,
  type Fortschritt,
  type JobContext,
  JobInterrupted,
  JobLost,
  JobMove,
  PayloadInvalid,
  type Nutzlast,
} from '../src/jobQueue';
import { fehlertext, logAndContinue, reportError } from '../src/infra/error';
import { VORGABE } from '../src/infra/config';

export type { Bearbeiter } from '../src/jobQueue';

export interface WorkerOptions {
  parallel?: number;
  taktMs?: number;
  deadlineSec?: number;
}

export type Bearbeitertabelle = { [A in JobKind]?: Bearbeiter<A> };

interface Lauf {
  a: JobRow;
  ac: AbortController;
  fertig: Promise<void>;
}

/** Der Worker hält das Lease selbst: Ein Handler, der nie ein Lebenszeichen
 * gibt, verlöre sonst nach der Frist seine Zeile und liefe doppelt. */
function holdLease(d: JobsServices, a: JobRow, ac: AbortController, deadlineSec: number): () => void {
  const renew = async () => {
    if (ac.signal.aborted) return;
    const ok = await d.lebenszeichen(a, deadlineSec).catch((e: unknown) => {
      logAndContinue(`auftraege:pacht ${a.type}`)(e);
      return true;
    });
    if (!ok) ac.abort(new JobLost());
  };
  const t = setInterval(
    () => {
      void renew();
    },
    Math.max(200, Math.floor((deadlineSec * 1000) / 3)),
  );
  t.unref();
  return () => clearInterval(t);
}

/** Meldungen eines Laufs nacheinander, sonst überholte ein später Stand einen früheren.
 * Eine gescheiterte Meldung scheitert für ihren Aufrufer, nicht für alle folgenden. */
function progressChain(d: JobsServices, a: JobRow, ac: AbortController, deadlineSec: number) {
  let kette: Promise<boolean> = Promise.resolve(true);
  return (f: Fortschritt): Promise<boolean> => {
    const melde = () => d.setProgress(a, f, deadlineSec);
    kette = kette.then(melde, melde).then(ok => {
      if (!ok && !ac.signal.aborted) ac.abort(new JobLost());
      return ok;
    });
    return kette;
  };
}

/** Was nicht mehr läuft, steht sonst bis zum Ablauf der Frist auf 'laeuft'; die Frist heilt auch einen Fehler hier. */
async function backInDieTable(d: JobsServices, a: JobRow): Promise<void> {
  await d.giveBack(a).catch(logAndContinue('auftraege:zurückgeben'));
}

/** Auch nach einem endgültigen Fehler, sonst endete der Zeitplan; ohne Zeitplan nichts. */
async function followUpPlan(d: JobsServices, a: JobRow): Promise<void> {
  await d.planeNext(a.type).catch(logAndContinue(`auftraege:plan ${a.type}`));
}

function contextFor(
  d: JobsServices,
  a: JobRow,
  ac: AbortController,
  deadlineSec: number,
  isEnded: () => boolean,
): JobContext {
  return {
    lebenszeichen: async () => {
      const ok = await d.lebenszeichen(a, deadlineSec);
      if (!ok && !ac.signal.aborted) ac.abort(new JobLost());
      return ok;
    },
    fortschritt: progressChain(d, a, ac, deadlineSec),
    signal: ac.signal,
    get beendet() {
      return isEnded() || ac.signal.aborted;
    },
    versuch: a.attempts,
  };
}

async function runJobFrom(
  d: JobsServices,
  a: JobRow,
  ac: AbortController,
  b: Bearbeiter | undefined,
  deadlineSec: number,
  isEnded: () => boolean,
): Promise<void> {
  let nutzlast: Nutzlast<JobKind> | undefined;
  const k = contextFor(d, a, ac, deadlineSec, isEnded);
  const letLos = holdLease(d, a, ac, deadlineSec);
  try {
    // Mehr Versuche als erlaubt: Die früheren stürzten ab, ein weiterer vermutlich auch.
    if (!b || a.attempts > a.max_attempts)
      throw new Error(b ? 'ohne Rückmeldung abgebrochen' : `keine Bearbeitung für ${a.type}`);
    const geprueft = d.checkPayload(a.type, a.payload);
    nutzlast = geprueft;
    await d.inNamesOfJob(a, () => b.ausfuehren(geprueft, k, a));
    if (await d.erledigt(a)) await followUpPlan(d, a);
  } catch (e) {
    await afterError(d, a, b, nutzlast, ac, e);
  } finally {
    letLos();
  }
}

async function afterError(
  d: JobsServices,
  a: JobRow,
  b: Bearbeiter | undefined,
  nutzlast: Nutzlast<JobKind> | undefined,
  ac: AbortController,
  e: unknown,
): Promise<void> {
  // Nach einem Abbruch zählt der Grund des Signals, nicht die Ausnahme, die er im Handler auslöste.
  const grund: unknown = ac.signal.aborted ? ac.signal.reason : e;
  if (grund instanceof JobLost) {
    console.warn(`[auftraege] ${a.type} #${a.id}: ${grund.message}`);
    return;
  }
  if (grund instanceof JobInterrupted) {
    await d.giveBack(a);
    return;
  }
  if (e instanceof JobMove) {
    if (await d.verschoben(a, e.bis, e.grund, e.zaehlt)) {
      if (nutzlast) await d.inNamesOfJob(a, async () => b?.aufgegeben?.(nutzlast, e.grund, a));
      await followUpPlan(d, a);
    }
    return;
  }
  const text = fehlertext(e) || 'Unbekannter Fehler';
  console.warn(`[auftraege] ${a.type} #${a.id} Versuch ${a.attempts}/${a.max_attempts}: ${text}`);
  if (await d.fehlgeschlagen(a, text, e instanceof PayloadInvalid)) {
    if (nutzlast) await d.inNamesOfJob(a, async () => b?.aufgegeben?.(nutzlast, text, a));
    await followUpPlan(d, a);
  }
}

/** Beim Abschalten: alle Läufe unterbrechen, kurz auf sie warten, und was dann noch
 * läuft, zurückgeben — sonst stünde es bis zum Ablauf der Frist auf 'laeuft'. */
async function interruptRunning(d: JobsServices, laufend: Map<string, Lauf>, wartenMs: number): Promise<Lauf[]> {
  const alle = [...laufend.values()];
  for (const l of alle) if (!l.ac.signal.aborted) l.ac.abort(new JobInterrupted());
  await Promise.race([Promise.all(alle.map(l => l.fertig)), new Promise(r => setTimeout(r, wartenMs).unref())]);
  const rest = [...laufend.values()];
  for (const { a } of rest) await backInDieTable(d, a);
  return rest;
}

/** Mehrere Worker teilen sich die Arbeit über SKIP LOCKED; das NOTIFY beim Einstellen weckt früher als der Takt. */
function createWorker(d: JobsServices, editor: Bearbeitertabelle, o: WorkerOptions = {}) {
  const arten = Object.keys(editor);
  const exklusiv = arten.filter(a => editor[a as JobKind]?.exklusiv);
  // Die Werte reicht der Start (startup/jobsProcess.ts); ohne sie gilt die Vorgabe.
  const parallel = Math.max(1, o.parallel ?? VORGABE.jobParallel);
  const deadlineSec = o.deadlineSec ?? VORGABE.jobDeadlineSec;
  const laufend = new Map<string, Lauf>();
  let beendet = false,
    gestartet = false,
    pumps = false;
  let takt: NodeJS.Timeout | null = null;
  let abmelden: (() => void)[] = [];
  // Am Ende jeder Runde: Daran hängt das Lebenszeichen (startup/jobsProcess.ts).
  let lastRound = 0;
  const exclusiveRemembered = d.rememberExclusive(exklusiv).catch(logAndContinue('auftraege:exklusiv'));

  async function receiptsAndStart(): Promise<Lauf | null> {
    await exclusiveRemembered;
    const a = await d.belegeAuftrag(arten, deadlineSec, receiptId(), exklusiv, [...laufend.keys()]);
    if (!a) return null;
    if (beendet) {
      await backInDieTable(d, a);
      return null;
    }
    const ac = new AbortController();
    const lauf: Lauf = { a, ac, fertig: Promise.resolve() };
    laufend.set(a.id, lauf);
    // Kein Rahmen um den Lauf: Die Ausführung setzt ihn je Konto (inNamesOfJob).
    lauf.fertig = runJobFrom(d, a, ac, editor[a.type], deadlineSec, () => beendet)
      .catch(logAndContinue(`auftraege:${a.type}`))
      .finally(() => laufend.delete(a.id));
    return lauf;
  }

  async function processOne(): Promise<boolean> {
    const l = await receiptsAndStart();
    if (!l) return false;
    await l.fertig;
    return true;
  }

  // Die laufende Runde, damit stoppe() auf eine Belegung warten kann, die
  // gerade in der Datenbank steht: Sie käme sonst nach dem Abschalten an und
  // bliebe bis zum Ablauf ihrer Frist auf 'laeuft'.
  let pumpLauf: Promise<void> = Promise.resolve();

  function pump(): Promise<void> {
    if (pumps || beendet) return pumpLauf;
    pumps = true;
    pumpLauf = runde();
    return pumpLauf;
  }

  async function runde(): Promise<void> {
    try {
      while (!beendet && laufend.size < parallel) {
        const l = await receiptsAndStart();
        if (!l) break;
        void l.fertig.finally(() => {
          void pump();
        });
      }
    } catch (e) {
      // Die Runde endet; der nächste Takt oder ein NOTIFY versucht es wieder.
      reportError('auftraege:belegen', e);
    } finally {
      pumps = false;
      lastRound = Date.now();
    }
  }
  const woken = () => {
    void pump();
  };

  function starte(): void {
    if (gestartet) return;
    gestartet = true;
    lastRound = Date.now();
    abmelden = [d.atNewJob(woken), d.atJobStatus(s => d.checkMembership(laufend.values(), s))];
    takt = setInterval(woken, o.taktMs ?? 5000);
    takt.unref();
    void pump();
  }

  async function stop(wartenMs = 3000): Promise<void> {
    beendet = true;
    if (takt) clearInterval(takt);
    for (const ab of abmelden) ab();
    await pumpLauf;
    const rest = await interruptRunning(d, laufend, wartenMs);
    console.log(`[auftraege] beendet, ${rest.length} laufende Aufträge zurückgegeben`);
  }

  return { processOne, starte, stop, laufend: () => laufend.size, lastRound: () => lastRound };
}

export { JobInterrupted, JobLost, JobMove, createWorker };
export type { JobContext };
