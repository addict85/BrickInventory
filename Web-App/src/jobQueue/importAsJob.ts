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
  ergebnis?: Record<string, unknown>;
  fachfehler?: { code: ErrorCode; kind: ErrorKind; vars?: Record<string, string | number> };
};

export async function setResult(k: JobsContext, id: string, ergebnis: Record<string, unknown>): Promise<void> {
  await k.jobs.writeResult(id, { ergebnis } satisfies Stored);
}

/** A domain error (wrong file, missing right) arrives at the request with a code. */
export async function setSlotError(k: JobsContext, id: string, e: DomainError): Promise<void> {
  await k.jobs.writeResult(id, {
    fachfehler: { code: e.code, kind: e.kind, ...(e.vars ? { vars: e.vars } : {}) },
  } satisfies Stored);
}

/** @typeParam T the response the job stores; the contract checks it in the test run. */
export async function waitOnJob<T, A extends JobKind>(
  k: JobsContext,
  kind: A,
  payload: PayloadInput<A>,
  o: { userId: number; progress?: (f: Progress) => void; wartenMs?: number },
): Promise<T> {
  const uid = o.userId;
  // One attempt: a second run would create already created items once more.
  const id = await placeJobOne(k, kind, payload, { userId: uid, maxAttempts: 1 });
  if (!id) failDomain('intern', 'internal_error');
  const bis = k.clock.now() + (o.wartenMs ?? IMPORT_WAIT_MS);
  let lastUsed = '';
  for (;;) {
    const s = await k.jobs.jobStatus(id, uid);
    if (s?.progress && o.progress) {
      const j = JSON.stringify(s.progress);
      if (j !== lastUsed) {
        lastUsed = j;
        o.progress(s.progress);
      }
    }
    const stored = (s?.result ?? {}) as Stored;
    if (stored.fachfehler)
      throw new DomainError(stored.fachfehler.kind ?? 'ungueltig', stored.fachfehler.code, stored.fachfehler.vars);
    if (s?.status === 'done') {
      // Read is read: the result carries names and numbers from the file.
      await k.jobs.writeResult(id, null);
      return (stored.ergebnis ?? {}) as T;
    }
    if (!s || s.status === 'cancelled') failDomain('konflikt', 'import_cancelled');
    if (s.status === 'error') failDomain('intern', 'import_failed');
    if (k.clock.now() > bis) failDomain('zeitueberschreitung', 'import_still_running');
    await new Promise(r => setTimeout(r, TICK_MS));
  }
}
