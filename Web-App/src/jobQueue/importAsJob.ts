/** Ein Auftrag, auf dessen Ergebnis die Anfrage wartet (etwa ein Import): Bricht der Web-Prozess
 * ab, läuft er weiter, und Fremdabrufe belasten nicht den Prozess, der die Seiten ausliefert. */
import { placeJobOne } from './service';
import type { JobKind, Fortschritt, PayloadInput } from './jobs';
import { Fachfehler, fachfehler, type ErrorKind, type ErrorCode } from '../infra/fehlerTexte';
import type { JobsContext } from './context';

/** So lange wartet die Anfrage; danach läuft der Auftrag im Hintergrund weiter. */
export const IMPORT_WAIT_MS = 10 * 60_000;
const TAKT_MS = 150;

/** Was der Job ablegt: das Ergebnis, oder der Fachfehler, den die Route meldet. */
type Abgelegt = {
  ergebnis?: Record<string, unknown>;
  fachfehler?: { code: ErrorCode; art: ErrorKind; vars?: Record<string, string | number> };
};

export async function setResult(k: JobsContext, id: string, ergebnis: Record<string, unknown>): Promise<void> {
  await k.auftraege.writeResult(id, { ergebnis } satisfies Abgelegt);
}

/** Ein Fachfehler (falsche Datei, fehlendes Recht) kommt bei der Anfrage mit Code an. */
export async function setSlotError(k: JobsContext, id: string, e: Fachfehler): Promise<void> {
  await k.auftraege.writeResult(id, {
    fachfehler: { code: e.code, art: e.art, ...(e.vars ? { vars: e.vars } : {}) },
  } satisfies Abgelegt);
}

/** @typeParam T die Antwort, die der Job ablegt; der Vertrag prüft sie im Testlauf. */
export async function waitOnJob<T, A extends JobKind>(
  k: JobsContext,
  art: A,
  nutzlast: PayloadInput<A>,
  o: { userId: number; fortschritt?: (f: Fortschritt) => void; wartenMs?: number },
): Promise<T> {
  const uid = o.userId;
  // Ein Versuch: Ein zweiter Lauf legte schon Angelegtes noch einmal an.
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
      // Gelesen ist gelesen: Das Ergebnis trägt Namen und Nummern aus der Datei.
      await k.auftraege.writeResult(id, null);
      return (abgelegt.ergebnis ?? {}) as T;
    }
    if (!s || s.status === 'abgebrochen') fachfehler('konflikt', 'import_abgebrochen');
    if (s.status === 'fehler') fachfehler('intern', 'import_fehlgeschlagen');
    if (k.uhr.jetzt() > bis) fachfehler('zeitueberschreitung', 'import_laeuft_noch');
    await new Promise(r => setTimeout(r, TAKT_MS));
  }
}
