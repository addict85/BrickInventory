/** Per key one waiting job that keeps counting across jobs (`versuch` in the
 * payload): whoever wants to ask a remote side again later queues until the limit is reached. */
import type { JobKind, PayloadInput } from './jobs';
import { wakeWorker, pullBefore } from './service';
import type { JobsContext } from './context';

/** @returns vorgemerkt false if the key was already queued `hoechstens` times */
export async function rememberBefore<A extends JobKind>(
  k: JobsContext,
  kind: A,
  key: string,
  payload: (versuch: number) => PayloadInput<A>,
  o: { dueAb: Date; error: string; hoechstens: number },
): Promise<{ versuch: number; vorgemerkt: boolean }> {
  const versuch = (await k.jobs.highestCounter(key, 'versuch')) + 1;
  if (versuch > o.hoechstens) {
    await k.jobs.openDelete(key);
    return { versuch, vorgemerkt: false };
  }
  const n = k.arten.check(kind, payload(versuch));
  await k.jobs.writeResubmission(kind, key, n as object, {
    dueAb: o.dueAb,
    error: o.error,
    maxAttempts: 3,
  });
  await wakeWorker(k, kind);
  return { versuch, vorgemerkt: true };
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

export async function numbers(k: JobsContext, kind: JobKind): Promise<{ wartend: number; faellig: number }> {
  const z = await k.jobs.numbersTheKind(kind);
  return { wartend: z?.wartend ?? 0, faellig: z?.faellig ?? 0 };
}
