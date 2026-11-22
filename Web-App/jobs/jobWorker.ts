import {
  receiptId,
  type JobsServices,
  type JobKind,
  type JobRow,
  type Handler,
  type Progress,
  type JobContext,
  JobInterrupted,
  JobLost,
  JobMove,
  PayloadInvalid,
  type Payload,
} from '../src/jobQueue';
import { errorMessage, logAndContinue, reportError } from '../src/infra/error';
import { DEFAULT } from '../src/infra/config';
import { counter, histogram } from '../src/infra/metrics';

export type { Handler } from '../src/jobQueue';

export interface WorkerOptions {
  parallel?: number;
  tickMs?: number;
  deadlineSec?: number;
}

export type HandlerTable = { [A in JobKind]?: Handler<A> };

interface Lauf {
  a: JobRow;
  ac: AbortController;
  done: Promise<void>;
}

/** The worker holds the lease itself: a handler that never gives a sign of life
 * would otherwise lose its row after the deadline and run twice. */
function holdLease(d: JobsServices, a: JobRow, ac: AbortController, deadlineSec: number): () => void {
  const renew = async () => {
    if (ac.signal.aborted) return;
    const ok = await d.heartbeat(a, deadlineSec).catch((e: unknown) => {
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

/** Reports of a run one after another, otherwise a late state would overtake an earlier one.
 * A failed report fails for its caller, not for all following ones. */
function progressChain(d: JobsServices, a: JobRow, ac: AbortController, deadlineSec: number) {
  let chain: Promise<boolean> = Promise.resolve(true);
  return (f: Progress): Promise<boolean> => {
    const report = () => d.setProgress(a, f, deadlineSec);
    chain = chain.then(report, report).then(ok => {
      if (!ok && !ac.signal.aborted) ac.abort(new JobLost());
      return ok;
    });
    return chain;
  };
}

/** What no longer runs would otherwise stay on 'running' until the deadline; the deadline also heals an error here. */
async function backToTable(d: JobsServices, a: JobRow): Promise<void> {
  await d.giveBack(a).catch(logAndContinue('auftraege:zurückgeben'));
}

/** Also after a final error, otherwise the schedule would end; without a schedule nothing. */
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
    heartbeat: async () => {
      const ok = await d.heartbeat(a, deadlineSec);
      if (!ok && !ac.signal.aborted) ac.abort(new JobLost());
      return ok;
    },
    progress: progressChain(d, a, ac, deadlineSec),
    signal: ac.signal,
    get ended() {
      return isEnded() || ac.signal.aborted;
    },
    attempt: a.attempts,
  };
}

const jobRuns = counter('jobs_runs_total', 'Finished job runs by kind and result.');
const jobDuration = histogram('job_duration_seconds', 'Duration of a job run by kind and result.');

async function runJobFrom(
  d: JobsServices,
  a: JobRow,
  ac: AbortController,
  b: Handler | undefined,
  deadlineSec: number,
  isEnded: () => boolean,
): Promise<void> {
  let payload: Payload<JobKind> | undefined;
  const k = contextFor(d, a, ac, deadlineSec, isEnded);
  const release = holdLease(d, a, ac, deadlineSec);
  const start = process.hrtime.bigint();
  let result = 'ok';
  try {
    // More attempts than allowed: the earlier ones crashed, another one probably would too.
    if (!b || a.attempts > a.max_attempts)
      throw new Error(b ? 'ohne Rückmeldung abgebrochen' : `keine Bearbeitung für ${a.type}`);
    const checked = d.checkPayload(a.type, a.payload);
    payload = checked;
    await d.inNamesOfJob(a, () => b.run(checked, k, a));
    if (await d.done(a)) await followUpPlan(d, a);
  } catch (e) {
    result = e instanceof JobMove ? 'moved' : ac.signal.aborted ? 'interrupted' : 'error';
    await afterError(d, a, b, payload, ac, e);
  } finally {
    release();
    jobRuns.inc({ type: a.type, result });
    jobDuration.observe({ type: a.type, result }, Number(process.hrtime.bigint() - start) / 1e9);
  }
}

async function afterError(
  d: JobsServices,
  a: JobRow,
  b: Handler | undefined,
  payload: Payload<JobKind> | undefined,
  ac: AbortController,
  e: unknown,
): Promise<void> {
  // After an abort the reason of the signal counts, not the exception it caused in the handler.
  const reason: unknown = ac.signal.aborted ? ac.signal.reason : e;
  if (reason instanceof JobLost) {
    console.warn(`[auftraege] ${a.type} #${a.id}: ${reason.message}`);
    return;
  }
  if (reason instanceof JobInterrupted) {
    await d.giveBack(a);
    return;
  }
  if (e instanceof JobMove) {
    if (await d.moved(a, e.bis, e.reason, e.counts)) {
      if (payload) await d.inNamesOfJob(a, async () => b?.givenUp?.(payload, e.reason, a));
      await followUpPlan(d, a);
    }
    return;
  }
  const text = errorMessage(e) || 'Unbekannter Fehler';
  console.warn(`[auftraege] ${a.type} #${a.id} Versuch ${a.attempts}/${a.max_attempts}: ${text}`);
  if (await d.failed(a, text, e instanceof PayloadInvalid)) {
    if (payload) await d.inNamesOfJob(a, async () => b?.givenUp?.(payload, text, a));
    await followUpPlan(d, a);
  }
}

/** On shutdown: interrupt all runs, wait for them briefly, and return whatever is
 * still running then — otherwise it would stay on 'running' until the deadline. */
async function interruptRunning(d: JobsServices, running: Map<string, Lauf>, waitMs: number): Promise<Lauf[]> {
  const all = [...running.values()];
  for (const l of all) if (!l.ac.signal.aborted) l.ac.abort(new JobInterrupted());
  await Promise.race([Promise.all(all.map(l => l.done)), new Promise(r => setTimeout(r, waitMs).unref())]);
  const rest = [...running.values()];
  for (const { a } of rest) await backToTable(d, a);
  return rest;
}

/** Several workers share the work via SKIP LOCKED; the NOTIFY on enqueueing wakes earlier than the tick. */
function createWorker(d: JobsServices, editor: HandlerTable, o: WorkerOptions = {}) {
  const kinds = Object.keys(editor);
  const exclusive = kinds.filter(a => editor[a as JobKind]?.exclusive);
  // The values are passed by the start (startup/jobsProcess.ts); without them the default applies.
  const parallel = Math.max(1, o.parallel ?? DEFAULT.jobParallel);
  const deadlineSec = o.deadlineSec ?? DEFAULT.jobDeadlineSec;
  const running = new Map<string, Lauf>();
  let ended = false,
    started = false,
    pumps = false;
  let tick: NodeJS.Timeout | null = null;
  let deregister: (() => void)[] = [];
  // At the end of every round: the heartbeat depends on it (startup/jobsProcess.ts).
  let lastRound = 0;
  const exclusiveRemembered = d.rememberExclusive(exclusive).catch(logAndContinue('auftraege:exklusiv'));

  async function receiptsAndStart(): Promise<Lauf | null> {
    await exclusiveRemembered;
    const a = await d.claimJob(kinds, deadlineSec, receiptId(), exclusive, [...running.keys()]);
    if (!a) return null;
    if (ended) {
      await backToTable(d, a);
      return null;
    }
    const ac = new AbortController();
    const lauf: Lauf = { a, ac, done: Promise.resolve() };
    running.set(a.id, lauf);
    // No frame around the run: the execution sets it per account (inNamesOfJob).
    lauf.done = runJobFrom(d, a, ac, editor[a.type], deadlineSec, () => ended)
      .catch(logAndContinue(`auftraege:${a.type}`))
      .finally(() => running.delete(a.id));
    return lauf;
  }

  async function processOne(): Promise<boolean> {
    const l = await receiptsAndStart();
    if (!l) return false;
    await l.done;
    return true;
  }

  // The running round, so stoppe() can wait for a claim that
  // is currently in the database: it would otherwise arrive after shutdown and
  // stay on 'running' until its deadline expires.
  let pumpLauf: Promise<void> = Promise.resolve();

  function pump(): Promise<void> {
    if (pumps || ended) return pumpLauf;
    pumps = true;
    pumpLauf = round();
    return pumpLauf;
  }

  async function round(): Promise<void> {
    try {
      while (!ended && running.size < parallel) {
        const l = await receiptsAndStart();
        if (!l) break;
        void l.done.finally(() => {
          void pump();
        });
      }
    } catch (e) {
      // The round ends; the next tick or a NOTIFY tries again.
      reportError('auftraege:belegen', e);
    } finally {
      pumps = false;
      lastRound = Date.now();
    }
  }
  const woken = () => {
    void pump();
  };

  function launch(): void {
    if (started) return;
    started = true;
    lastRound = Date.now();
    deregister = [d.atNewJob(woken), d.atJobStatus(s => d.checkMembership(running.values(), s))];
    tick = setInterval(woken, o.tickMs ?? 5000);
    tick.unref();
    void pump();
  }

  async function stop(waitMs = 3000): Promise<void> {
    ended = true;
    if (tick) clearInterval(tick);
    for (const ab of deregister) ab();
    await pumpLauf;
    const rest = await interruptRunning(d, running, waitMs);
    console.log(`[auftraege] beendet, ${rest.length} laufende Aufträge zurückgegeben`);
  }

  return { processOne, launch, stop, running: () => running.size, lastRound: () => lastRound };
}

export { JobInterrupted, JobLost, JobMove, createWorker };
export type { JobContext };
