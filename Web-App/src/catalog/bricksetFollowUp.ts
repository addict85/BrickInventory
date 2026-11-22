import { loadSetInstructions, instructionCount } from './instructions';
import { logAndContinue, reportError } from '../infra/error';
import { type Payload, checkAbort, type JobRun, JobMove } from '../jobQueue';
import * as imageState from './imageState';
import type { CatalogContext } from './context';

/** Once the daily quota is used up, the whole kind waits until the
 * configured time of day; the attempt then does not count. */
async function bricksetFollowUp(k: CatalogContext, n: Payload<'brickset'>, lauf?: JobRun): Promise<void> {
  const sn = n.set_number;
  try {
    const [limit, status] = await Promise.all([
      k.externalSources.quotaLimit('brickset'),
      k.externalSources.quotaStatus('brickset'),
    ]);
    if (Math.max(0, limit - (status.count || 0)) <= 0) {
      const bis = await k.externalSources.brickset.dueFrom(false);
      await k.jobQueue.pauseKind('brickset', bis, 'Brickset-Tageskontingent erschöpft');
      throw new JobMove(bis, 'Brickset-Tageskontingent erschöpft');
    }
  } catch (e) {
    if (e instanceof JobMove) throw e;
    reportError('brickset-retry:kontingent', e);
  }

  checkAbort(lauf);
  // If the quota runs out midway, setAngaben queues the set again itself.
  if (await imageState.fillFromBrickset(k, sn)) console.log(`[brickset] Retry OK: ${sn}`);
  checkAbort(lauf);
  if ((await instructionCount(k, sn)) === 0) {
    await loadSetInstructions(k, sn).catch(logAndContinue('brickset-retry:setAnleitungenLaden'));
  }
  await k.jobQueue.pauseKind('brickset', new Date(k.clock.now() + 1000), 'Abstand zwischen zwei Abrufen');
}

const tag = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** In the format of the former table so that the UI stays the same; the names from the catalog. */
async function bricksetList(k: CatalogContext) {
  const waiting = await k.externalSources.brickset.waiting();
  const names = new Map(
    (await k.imageState.setNames([...new Set(waiting.map(w => w.set_number))])).map(z => [z.set_num, z.name]),
  );
  return waiting.map(w => ({
    set_number: w.set_number,
    name: names.get(w.set_number) ?? null,
    attempts: w.attempt,
    retry_after: tag(new Date(w.due_at)),
    last_error: w.error,
    created_at: w.created,
  }));
}

export { bricksetList, bricksetFollowUp };
