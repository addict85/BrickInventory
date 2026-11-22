/** The Wanted XML import as a job: it creates parts, figures and sets and
 * asks Rebrickable on request — neither belongs in the web process. */
import type { Payload, JobContext } from '../jobQueue';
import { logAndContinue } from '../infra/error';
import type { CollectionContext } from './context';

export type WantedXmlInput = Extract<Payload<'csv_import'>, { source: 'wanted_xml' }>['eingabe'];

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
  const after = (where: string, step: () => Promise<unknown>) => {
    chain = chain.then(step).catch(logAndContinue(where));
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
  const toBar = (state: { done: number; total: number }, unconditional = false) => {
    if (!jobRunning) return;
    after('wanted-import:auftrag', () =>
      kx.jobQueue.reportJob(uid, { done: state.done, total: state.total }, unconditional),
    );
  };
  try {
    const report = await kx.wanted.importWantedList(uid, e.xml, {
      preview: !e.write,
      viaRebrickable: e.viaRebrickable,
      ...(e.corrections ? { corrections: e.corrections } : {}),
      // An account's correction applies only to it; shared only what Rebrickable has confirmed.
      rememberNumber: (kind, rbId, blId, source) =>
        source === 'korrigiert'
          ? kx.catalog.rememberOwnBlNumber(uid, kind, rbId, blId)
          : kx.catalog.rememberBlNumber(kind, rbId, blId),
      progress: state => {
        // The state travels via the job to the waiting request (and its stream);
        // at most five times per second, the last one of each phase always.
        const now = kx.clock.now();
        if (now - lastUsed >= 200 || state.done === state.total || state.phase !== lastPhase) {
          lastUsed = now;
          lastPhase = state.phase;
          const f = { ...state };
          after('wanted-import:stand', () => k.progress(f));
        }
        // Created on the FIRST write progress: before that the denominator is unknown.
        if (e.write && !jobRequested && state.phase === 'write') {
          jobRequested = true;
          after('wanted-import:auftrag', async () => {
            jobRunning = await kx.jobQueue.startJob(uid, { total: state.total, current: e.fileName });
          });
        }
        toBar(state);
      },
      ...(e.write ? { cancellation: async () => jobRunning && (await kx.jobQueue.isAborted(uid)) } : {}),
      creator: {
        part: (u, body) => kx.parts.addManualPart(u, body),
        minifig: (u, body) => kx.minifigs.addManualMinifig(u, body),
        // The purchase price is MAXPRICE from the file.
        set: (u, sn, quantity, condition, purchasePrice) =>
          kx.sets.acquireSet({
            requester: u,
            setNumber: sn,
            quantity,
            purchasePrice,
            condition,
            ifPresent: 'aufstocken',
          }),
      },
    });
    await closeBar(
      {
        ok: report.created + report.topped_up,
        // Open items are a note (⚠), neither created nor failed.
        warn: report.items.filter(p => p.outcome === 'open').length,
        error: report.failed,
        // The PROCESSED items, otherwise the bar would stop before the end.
        done: report.items.length,
        aborted: !!report.aborted,
      },
      // One readable line per item for the bar's log.
      report.items.map(p =>
        p.outcome === 'created' || p.outcome === 'topped_up'
          ? { success: true, set_number: p.blId, action: p.outcome === 'created' ? 'added' : 'updated' }
          : { success: false, isWarning: p.outcome === 'open', set_number: p.blId, error: p.reason || '' },
      ),
    );
    return { ...report };
  } catch (f) {
    // The bar MUST be closed, even after an error, otherwise it would show everywhere
    // an import that no longer exists.
    await closeBar({ ok: 0, error: 0, done: 0, aborted: true });
    throw f;
  }
}

export { importWantedXml };
