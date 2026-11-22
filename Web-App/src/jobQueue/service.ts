/** Every change someone is waiting for wakes them via NOTIFY: new jobs
 * the job process, status changes the status stream. If a NOTIFY gets lost,
 * the worker finds the job on its tick. */
import { asRequest, inSystemContext } from '../infra/accountContext';
import * as repo from './repository/jobs';
import {
  JobLost,
  type JobKind,
  type JobStatus,
  type JobRow,
  type Claim,
  type Enqueue,
  type Progress,
  type PayloadInput,
} from './jobs';
import { logAndContinue } from '../infra/error';
import { signal } from '../infra/event';
import type { JobsContext } from './context';

/** A new or again due job wakes the job process; the payload names the kind. */
export const NEW_JOB = signal(repo.JOB_CHANNEL);
/** A status change wakes the status streams; the payload names the key. */
export const JOB_STATUS = signal(repo.JOB_STATUS_CHANNEL);

export function wakeWorker(k: JobsContext, art: string): Promise<void> {
  return NEW_JOB.report(k.db.notification, art);
}

async function reportStatus(k: JobsContext, z: { s: string } | undefined): Promise<void> {
  if (z) await JOB_STATUS.report(k.db.notification, z.s);
}

/** 30 s, doubled per attempt, at most one hour. */
export function waitTimeSec(attempt: number): number {
  return Math.min(3600, 30 * 2 ** Math.max(0, attempt - 1));
}

export async function placeJobOne<A extends JobKind>(
  k: JobsContext,
  art: A,
  payload: PayloadInput<A>,
  o: Enqueue = {},
): Promise<string | null> {
  const id = await k.auftraege.addJobOne(art, k.arten.check(art, payload), o);
  await wakeWorker(k, art);
  return id;
}

/** A job of the requesting account (or its sub-account), also in its transaction:
 * without a system frame, row security checks that user_id belongs to the household. */
export async function placeOwnJobOne<A extends JobKind>(
  k: JobsContext,
  art: A,
  payload: PayloadInput<A>,
  o: Enqueue & { userId: number },
): Promise<string | null> {
  const id = await k.auftraege.addOwnJobOne(art, k.arten.check(art, payload), o);
  await wakeWorker(k, art);
  return id;
}

/** Per key at most one waiting job that adds the new entries of the list `liste` to
 * its own: every report extends instead of creating a second job. */
export async function supplementListenJob<A extends JobKind>(
  k: JobsContext,
  art: A,
  payload: PayloadInput<A>,
  o: { schluessel: string; liste: string; hoechstens: number; userId: number },
): Promise<string> {
  const n = k.arten.check(art, payload);
  const id = await k.auftraege.enqueueList(art, n as object, o);
  await wakeWorker(k, art);
  return id;
}

/** Also counts as a sign of life. erledigt and gesamt are counts (contract
 * and app: integer); a fraction like 5.532 of 8 steps showed up as "5.532 / 8". */
export async function setProgress(kx: JobsContext, a: Claim, f: Progress, deadlineSec: number): Promise<boolean> {
  const stand: Progress = { ...f };
  for (const k of ['erledigt', 'gesamt'] as const) {
    const x = f[k];
    if (typeof x === 'number' && Number.isFinite(x)) stand[k] = Math.floor(x);
  }
  const z = await kx.auftraege.writeProgress(a, stand, deadlineSec);
  await reportStatus(kx, z);
  return !!z;
}

export async function done(k: JobsContext, a: Claim & Pick<JobRow, 'type'>): Promise<boolean> {
  const z = await k.auftraege.setDone(a, !!k.arten.fromValue(a.type)?.discardPayload);
  await reportStatus(k, z);
  return !!z;
}

/** @returns true if it was the last attempt and the job is now 'fehler' */
export async function failed(k: JobsContext, a: JobRow, error: string, immediatelyFinal = false): Promise<boolean> {
  const final = immediatelyFinal || a.attempts >= a.max_attempts;
  const z = await k.auftraege.setFailed(a, final, error, waitTimeSec(a.attempts));
  await reportStatus(k, z);
  return final && !!z;
}

/** E.g. after throttling by the remote side.
 * @returns true if the attempt counted and it was the last one (then 'fehler') */
export async function moved(k: JobsContext, a: JobRow, bis: Date, grund: string, counts: boolean): Promise<boolean> {
  const final = counts && a.attempts >= a.max_attempts;
  const z = await k.auftraege.setMoved(a, final, bis, grund, counts);
  await reportStatus(k, z);
  return final && !!z;
}

export async function endPause(k: JobsContext, art: JobKind): Promise<void> {
  await k.auftraege.deletePause(art);
  await wakeWorker(k, art);
}

/** A running one stops at its next sign of life. */
export async function abortAb(k: JobsContext, id: string): Promise<JobRow | null> {
  const a = await k.auftraege.setAborted(id);
  if (a) await reportStatus(k, { s: a.dedupe_key ?? a.id });
  return a;
}

export async function repeat(k: JobsContext, id: string): Promise<boolean> {
  const ja = await k.auftraege.placeAgainOne(id);
  if (ja) await wakeWorker(k, 'wiederholt');
  return ja;
}

export async function pullBefore(k: JobsContext, art: JobKind, key?: string): Promise<number> {
  const n = await k.auftraege.makeDue(art, key);
  if (n > 0) await wakeWorker(k, art);
  return n;
}

/** Every status with a number, even 0. */
export async function countKind(k: JobsContext, art: JobKind): Promise<Record<JobStatus, number>> {
  const from = { offen: 0, laeuft: 0, erledigt: 0, fehler: 0, abgebrochen: 0 };
  for (const z of await k.auftraege.statusNumbers(art)) from[z.status] = z.n;
  return from;
}

/** A job with an account runs like a request of that account, even from within a system frame:
 * row security applies to it as to the account, and an import of a sub-account
 * counts against its share of the third-party quota. */
export async function inNamesOfJob<T>(
  k: JobsContext,
  a: Pick<JobRow, 'type' | 'user_id'>,
  f: () => Promise<T>,
): Promise<T> {
  if (a.user_id == null) return inJobFrame(k, a, f);
  const u = await k.auftraege.accountRole(a.user_id);
  return asRequest({ apiUser: { user_id: a.user_id, is_admin: !!u?.is_admin } }, f);
}

/** A job without an account: in the system frame only if its kind is registered as
 * cross-account (Anmeldung.kontouebergreifend), otherwise without account and without system frame. */
export function inJobFrame<T>(k: JobsContext, a: Pick<JobRow, 'type'>, f: () => Promise<T>): Promise<T> {
  const grund = k.arten.fromValue(a.type)?.kontouebergreifend;
  return grund ? inSystemContext(`auftrag ${a.type}: ${grund}`, f) : asRequest({}, f);
}

/** Wakes on every status change of a job, also from the job process; returns the unsubscribe. */
export function atJobStatus(k: JobsContext, f: (key?: string) => void): () => void {
  return JOB_STATUS.listen(k.db.notification, f);
}

/** Wakes as soon as a job is queued anywhere; returns the unsubscribe. */
export function atNewJob(k: JobsContext, f: () => void): () => void {
  return NEW_JOB.listen(k.db.notification, f);
}

/** An abort via the admin announces itself via NOTIFY: the affected running jobs check immediately
 * whether they still hold their row, instead of only at the next sign of life. */
export function checkMembership(
  k: JobsContext,
  runs: Iterable<{ a: JobRow; ac: AbortController }>,
  key?: string,
): void {
  for (const { a, ac } of runs) {
    if (ac.signal.aborted || (key !== undefined && key !== (a.dedupe_key ?? a.id))) continue;
    void k.auftraege.belongsStill(a).then(
      ja => {
        if (!ja && !ac.signal.aborted) ac.abort(new JobLost());
      },
      logAndContinue(`auftraege:stand ${a.type}`),
    );
  }
}
