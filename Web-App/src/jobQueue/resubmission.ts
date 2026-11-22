/** Per key one waiting job that keeps counting across jobs (`versuch` in the
 * payload): whoever wants to ask a remote side again later queues until the limit is reached. */
import type { JobKind, PayloadInput } from './jobs';
import { wakeWorker, pullBefore } from './service';
import type { JobsContext } from './context';

/** @returns vorgemerkt false if the key was already queued `hoechstens` times */
export async function rememberBefore<A extends JobKind>(
  k: JobsContext,
  art: A,
  schluessel: string,
  nutzlast: (versuch: number) => PayloadInput<A>,
  o: { dueAb: Date; fehler: string; hoechstens: number },
): Promise<{ versuch: number; vorgemerkt: boolean }> {
  const versuch = (await k.auftraege.highestCounter(schluessel, 'versuch')) + 1;
  if (versuch > o.hoechstens) {
    await k.auftraege.openDelete(schluessel);
    return { versuch, vorgemerkt: false };
  }
  const n = k.arten.pruefe(art, nutzlast(versuch));
  await k.auftraege.writeResubmission(art, schluessel, n as object, {
    dueAb: o.dueAb,
    fehler: o.fehler,
    maxAttempts: 3,
  });
  await wakeWorker(k, art);
  return { versuch, vorgemerkt: true };
}

export async function vergiss(k: JobsContext, schluessel: string): Promise<void> {
  await k.auftraege.openDelete(schluessel);
}

/** Due right away, without a key the whole kind; a pause of the kind stays. */
export async function jetzt(k: JobsContext, art: JobKind, schluessel?: string): Promise<number> {
  return pullBefore(k, art, schluessel);
}

export async function prefer(k: JobsContext, art: JobKind, bis: Date): Promise<void> {
  await k.auftraege.pullAppointmentsBefore(art, bis);
}

export function wartende(k: JobsContext, art: JobKind) {
  return k.auftraege.waitingTheKind(art);
}

export async function zahlen(k: JobsContext, art: JobKind): Promise<{ wartend: number; faellig: number }> {
  const z = await k.auftraege.numbersTheKind(art);
  return { wartend: z?.wartend ?? 0, faellig: z?.faellig ?? 0 };
}
