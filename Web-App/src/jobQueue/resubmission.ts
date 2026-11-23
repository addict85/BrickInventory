/** Per key one waiting job that keeps counting across jobs (`versuch` in the
 * payload): whoever wants to ask a remote side again later queues until the limit is reached. */
import type { JobKind, PayloadInput } from './jobs';
import { wakeWorker, pullBefore } from './service';
import type { JobsContext } from './context';

/** @returns queued false if the key was already queued `atMost` times */
export async function rememberBefore<A extends JobKind>(
  k: JobsContext,
  kind: A,
  key: string,
  payload: (attempt: number) => PayloadInput<A>,
  o: { dueFrom: Date; error: string; atMost: number },
): Promise<{ attempt: number; queued: boolean }> {
  const attempt = (await k.jobs.highestCounter(key, 'versuch')) + 1;
  if (attempt > o.atMost) {
    await k.jobs.openDelete(key);
    return { attempt, queued: false };
  }
  const n = k.kinds.check(kind, payload(attempt));
  await k.jobs.writeResubmission(kind, key, n as object, {
    dueFrom: o.dueFrom,
    error: o.error,
    maxAttempts: 3,
  });
  await wakeWorker(k, kind);
  return { attempt, queued: true };
}

export async function forget(k: JobsContext, key: string): Promise<void> {
  await k.jobs.openDelete(key);
}

/** Due right away, without a key the whole kind; a pause of the kind stays. */
export async function now(k: JobsContext, kind: JobKind, key?: string): Promise<number> {
  return pullBefore(k, kind, key);
}

export async function prefer(k: JobsContext, kind: JobKind, bis: Date): Promise<void> {
  await k.jobs.pullAppointmentsBefore(kind, bis);
}

export function waiting(k: JobsContext, kind: JobKind) {
  return k.jobs.waitingTheKind(kind);
}

export async function numbers(k: JobsContext, kind: JobKind): Promise<{ waiting: number; due: number }> {
  const z = await k.jobs.numbersTheKind(kind);
  return { waiting: z?.waiting ?? 0, due: z?.due ?? 0 };
}
