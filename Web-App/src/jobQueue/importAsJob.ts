/** A job whose result the request waits for (e.g. an import): if the web process
 * aborts, it keeps running, and third-party fetches do not burden the process that serves the pages. */
import { placeJobOne } from './service';
import type { JobKind, Progress, PayloadInput } from './jobs';
import { DomainError, failDomain, type ErrorKind, type ErrorCode } from '../infra/errorTexts';
import type { JobsContext } from './context';

/** The request waits this long; afterwards the job keeps running in the background. */
export const IMPORT_WAIT_MS = 10 * 60_000;
const TICK_MS = 150;

/** What the job stores: the result, or the domain error the route reports. */
type Stored = {
  result?: Record<string, unknown>;
  domainError?: { code: ErrorCode; kind: ErrorKind; vars?: Record<string, string | number> };
};

export async function setResult(k: JobsContext, id: string, result: Record<string, unknown>): Promise<void> {
  await k.jobs.writeResult(id, { result } satisfies Stored);
}

/** A domain error (wrong file, missing right) arrives at the request with a code. */
export async function setSlotError(k: JobsContext, id: string, e: DomainError): Promise<void> {
  await k.jobs.writeResult(id, {
    domainError: { code: e.code, kind: e.kind, ...(e.vars ? { vars: e.vars } : {}) },
  } satisfies Stored);
}

/** Passes the progress on only when it changed. */
function onChange(progress?: (f: Progress) => void): (p: Progress | null | undefined) => void {
  let lastUsed = '';
  return p => {
    if (!p || !progress) return;
    const j = JSON.stringify(p);
    if (j === lastUsed) return;
    lastUsed = j;
    progress(p);
  };
}

/** The end of the job as the request sees it: a domain error, a failure, or still waiting (undefined). */
function outcome(s: Awaited<ReturnType<JobsContext['jobs']['jobStatus']>>, timedOut: boolean): Stored | undefined {
  const stored = (s?.result ?? {}) as Stored;
  if (stored.domainError)
    throw new DomainError(stored.domainError.kind ?? 'invalid', stored.domainError.code, stored.domainError.vars);
  if (s?.status === 'done') return stored;
  if (!s || s.status === 'cancelled') failDomain('conflict', 'import_cancelled');
  if (s.status === 'error') failDomain('internal', 'import_failed');
  if (timedOut) failDomain('upstream_timeout', 'import_still_running');
  return undefined;
}

/** @typeParam T the response the job stores; the contract checks it in the test run. */
export async function waitOnJob<T, A extends JobKind>(
  k: JobsContext,
  kind: A,
  payload: PayloadInput<A>,
  o: { userId: number; progress?: (f: Progress) => void; waitMs?: number },
): Promise<T> {
  const uid = o.userId;
  // One attempt: a second run would create already created items once more.
  const id = await placeJobOne(k, kind, payload, { userId: uid, maxAttempts: 1 });
  if (!id) failDomain('internal', 'internal_error');
  const bis = k.clock.now() + (o.waitMs ?? IMPORT_WAIT_MS);
  const report = onChange(o.progress);
  for (;;) {
    const s = await k.jobs.jobStatus(id, uid);
    report(s?.progress as Progress | null | undefined);
    const stored = outcome(s, k.clock.now() > bis);
    if (stored) {
      // Read is read: the result carries names and numbers from the file.
      await k.jobs.writeResult(id, null);
      return (stored.result ?? {}) as T;
    }
    await new Promise(r => setTimeout(r, TICK_MS));
  }
}
