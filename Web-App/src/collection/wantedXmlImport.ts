/** The Wanted XML import as a job: it creates parts, figures and sets and
 * asks Rebrickable on request — neither belongs in the web process. */
import type { Payload, JobContext } from '../jobQueue';
import { logAndContinue } from '../infra/error';
import type { CollectionContext } from './context';

export type WantedXmlInput = Extract<Payload<'csv_import'>, { quelle: 'wanted_xml' }>['eingabe'];

async function importWantedXml(
  kx: CollectionContext,
  uid: number,
  e: WantedXmlInput,
  k: JobContext,
): Promise<Record<string, unknown>> {
  // Two flags: requested (for the chain) and running (for the abort).
  let jobRequested = false;
  let jobRunning = false;
  // Via a chain, because the callback is synchronous and the writing is not;
  // otherwise the bar would show a smaller number after a larger one.
  let chain: Promise<unknown> = Promise.resolve();
  // Bar and state are display only: a failed step holds up neither the import nor the next ones.
  const after = (wo: string, step: () => Promise<unknown>) => {
    chain = chain.then(step).catch(logAndContinue(wo));
  };
  // Wait for the chain first, then close: otherwise the bar would still show "running" elsewhere.
  const closeBar = async (
    details: Parameters<CollectionContext['jobQueue']['finishJob']>[1],
    rows?: Parameters<CollectionContext['jobQueue']['finishJob']>[2],
  ) => {
    await chain;
    if (jobRunning) await kx.jobQueue.finishJob(uid, details, rows).catch(logAndContinue('wanted-import:auftrag-ende'));
  };
  let lastUsed = 0,
    lastPhase = '';
  const toBar = (stand: { fertig: number; gesamt: number }, unconditional = false) => {
    if (!jobRunning) return;
    after('wanted-import:auftrag', () =>
      kx.jobQueue.reportJob(uid, { done: stand.fertig, total: stand.gesamt }, unconditional),
    );
  };
  try {
    const report = await kx.wanted.importWantedList(uid, e.xml, {
      vorschau: !e.schreiben,
      viaRebrickable: e.viaRebrickable,
      ...(e.korrekturen ? { korrekturen: e.korrekturen } : {}),
      // An account's correction applies only to it; shared only what Rebrickable has confirmed.
      rememberNumber: (art, rbId, blId, source) =>
        source === 'korrigiert'
          ? kx.catalog.rememberOwnBlNumber(uid, art, rbId, blId)
          : kx.catalog.rememberBlNumber(art, rbId, blId),
      progress: stand => {
        // The state travels via the job to the waiting request (and its stream);
        // at most five times per second, the last one of each phase always.
        const now = kx.uhr.jetzt();
        if (now - lastUsed >= 200 || stand.fertig === stand.gesamt || stand.phase !== lastPhase) {
          lastUsed = now;
          lastPhase = stand.phase;
          const f = { ...stand, erledigt: stand.fertig };
          after('wanted-import:stand', () => k.progress(f));
        }
        // Created on the FIRST write progress: before that the denominator is unknown.
        if (e.schreiben && !jobRequested && stand.phase === 'schreiben') {
          jobRequested = true;
          after('wanted-import:auftrag', async () => {
            jobRunning = await kx.jobQueue.startJob(uid, { total: stand.gesamt, current: e.fileName });
          });
        }
        toBar(stand);
      },
      ...(e.schreiben ? { cancellation: async () => jobRunning && (await kx.jobQueue.isAborted(uid)) } : {}),
      creator: {
        teil: (u, body) => kx.parts.addManualPart(u, body),
        minifig: (u, body) => kx.minifigs.addManualMinifig(u, body),
        // The purchase price is MAXPRICE from the file.
        set: (u, sn, menge, zustand, kaufpreis) =>
          kx.sets.acquireSet({
            requester: u,
            setNumber: sn,
            menge,
            kaufpreis,
            zustand,
            ifPresent: 'aufstocken',
          }),
      },
    });
    await closeBar(
      {
        ok: report.angelegt + report.aufgestockt,
        // Open items are a note (⚠), neither created nor failed.
        warn: report.posten.filter(p => p.ausgang === 'offen').length,
        fehler: report.fehler,
        // The PROCESSED items, otherwise the bar would stop before the end.
        done: report.posten.length,
        abgebrochen: !!report.abgebrochen,
      },
      // One readable line per item for the bar's log.
      report.posten.map(p =>
        p.ausgang === 'angelegt' || p.ausgang === 'aufgestockt'
          ? { success: true, set_number: p.blId, action: p.ausgang === 'angelegt' ? 'added' : 'updated' }
          : { success: false, isWarning: p.ausgang === 'offen', set_number: p.blId, error: p.grund || '' },
      ),
    );
    return { ...report };
  } catch (f) {
    // The bar MUST be closed, even after an error, otherwise it would show everywhere
    // an import that no longer exists.
    await closeBar({ ok: 0, fehler: 0, done: 0, abgebrochen: true });
    throw f;
  }
}

export { importWantedXml };
