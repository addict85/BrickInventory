/** Je Schlüssel ein wartender Auftrag, der über Aufträge hinweg mitzählt (`versuch` in der
 * Nutzlast): Wer eine Gegenseite später erneut fragen will, merkt vor, bis die Grenze erreicht ist. */
import type { JobKind, PayloadInput } from './auftraege';
import { wakeWorker, pullBefore } from './dienst';
import type { JobsContext } from './kontext';

/** @returns vorgemerkt false, wenn der Schlüssel schon `hoechstens` Mal vorgemerkt war */
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

/** Fällig ab sofort, ohne Schlüssel die ganze Art; eine Pause der Art bleibt. */
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
