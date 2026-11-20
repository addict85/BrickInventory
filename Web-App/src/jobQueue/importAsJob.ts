/** A job whose result the request waits for (e.g. an import): if the web process
 * aborts, it keeps running, and third-party fetches do not burden the process that serves the pages. */
import { placeJobOne } from './service';
import type { JobKind, Fortschritt, PayloadInput } from './jobs';
import { Fachfehler, fachfehler, type ErrorKind, type ErrorCode } from '../infra/errorTexts';
import type { JobsContext } from './context';

/** The request waits this long; afterwards the job keeps running in the background. */
export const IMPORT_WAIT_MS = 10 * 60_000;
const TAKT_MS = 150;

/** What the job stores: the result, or the domain error the route reports. */
type Abgelegt = {
  ergebnis?: Record<string, unknown>;
  fachfehler?: { code: ErrorCode; art: ErrorKind; vars?: Record<string, string | number> };
};

export async function setResult(k: JobsContext, id: string, ergebnis: Record<string, unknown>): Promise<void> {
  await k.auftraege.writeResult(id, { ergebnis } satisfies Abgelegt);
}

/** A domain error (wrong file, missing right) arrives at the request with a code. */
export async function setSlotError(k: JobsContext, id: string, e: Fachfehler): Promise<void> {
  await k.auftraege.writeResult(id, {
    fachfehler: { code: e.code, art: e.art, ...(e.vars ? { vars: e.vars } : {}) },
  } satisfies Abgelegt);
}

/** @typeParam T the response the job stores; the contract checks it in the test run. */
export async function waitOnJob<T, A extends JobKind>(
  k: JobsContext,
  art: A,
  nutzlast: PayloadInput<A>,
  o: { userId: number; fortschritt?: (f: Fortschritt) => void; wartenMs?: number },
): Promise<T> {
  const uid = o.userId;
  // One attempt: a second run would create already created items once more.
  const id = await placeJobOne(k, art, nutzlast, { userId: uid, maxAttempts: 1 });
  if (!id) fachfehler('intern', 'interner_fehler');
  const bis = k.uhr.jetzt() + (o.wartenMs ?? IMPORT_WAIT_MS);
  let zuletzt = '';
  for (;;) {
    const s = await k.auftraege.jobStatus(id, uid);
    if (s?.progress && o.fortschritt) {
      const j = JSON.stringify(s.progress);
      if (j !== zuletzt) {
        zuletzt = j;
        o.fortschritt(s.progress);
      }
    }
    const abgelegt = (s?.result ?? {}) as Abgelegt;
    if (abgelegt.fachfehler)
      throw new Fachfehler(abgelegt.fachfehler.art ?? 'ungueltig', abgelegt.fachfehler.code, abgelegt.fachfehler.vars);
    if (s?.status === 'erledigt') {
      // Read is read: the result carries names and numbers from the file.
      await k.auftraege.writeResult(id, null);
      return (abgelegt.ergebnis ?? {}) as T;
    }
    if (!s || s.status === 'abgebrochen') fachfehler('konflikt', 'import_abgebrochen');
    if (s.status === 'fehler') fachfehler('intern', 'import_fehlgeschlagen');
    if (k.uhr.jetzt() > bis) fachfehler('zeitueberschreitung', 'import_laeuft_noch');
    await new Promise(r => setTimeout(r, TAKT_MS));
  }
}
