/** Per key one waiting job that keeps counting across jobs (`versuch` in the
 * payload): whoever wants to ask a remote side again later queues until the limit is reached. */
import type { JobKind, PayloadInput } from './jobs';
import { wakeWorker, pullBefore } from './service';
import type { JobsContext } from './context';

/** @returns vorgemerkt false if the key was already queued `hoechstens` times */
export async function rememberBefore<A extends JobKind>(
  k: JobsContext,
  art: A,
  key: string,
  payload: (versuch: number) => PayloadInput<A>,
  o: { dueAb: Date; fehler: string; hoechstens: number },
): Promise<{ versuch: number; vorgemerkt: boolean }> {
  const versuch = (await k.jobs.highestCounter(key, 'versuch')) + 1;
  if (versuch > o.hoechstens) {
    await k.jobs.openDelete(key);
    return { versuch, vorgemerkt: false };
  }
  const n = k.arten.check(art, payload(versuch));
  await k.jobs.writeResubmission(art, key, n as object, {
    dueAb: o.dueAb,
    fehler: o.fehler,
    maxAttempts: 3,
  });
  await wakeWorker(k, art);
  return { versuch, vorgemerkt: true };
}

export async function forget(k: JobsContext, key: string): Promise<void> {
  await k.jobs.openDelete(key);
}

/** Due right away, without a key the whole kind; a pause of the kind stays. */
export async function now(k: JobsContext, art: JobKind, key?: string): Promise<number> {
  return pullBefore(k, art, key);
}

export async function prefer(k: JobsContext, art: JobKind, bis: Date): Promise<void> {
  await k.jobs.pullAppointmentsBefore(art, bis);
}

export function waiting(k: JobsContext, art: JobKind) {
  return k.jobs.waitingTheKind(art);
}

export async function numbers(k: JobsContext, art: JobKind): Promise<{ wartend: number; faellig: number }> {
  const z = await k.jobs.numbersTheKind(art);
  return { wartend: z?.wartend ?? 0, faellig: z?.faellig ?? 0 };
}
