/** Brickset and brickinstructions.com want spacing: after a real fetch
 * the whole kind pauses for 15 seconds, after a Cloudflare block for 5–20
 * minutes and then until the next day. */
import { withSessionLock } from '../../db/txLock';
import {
  loadSetInstructions,
  lastFetchWarExtern,
  instructionCount,
  scrapeInstructionsFromFallback,
} from './instructions';
import { errorMessage } from '../infra/error';
import { asFetchError } from '../externalSources';
import { type Payload, type JobRun, JobMove } from '../jobQueue';
import { LOCKS } from '../infra/lockNamespaces';
import type { CatalogContext } from './context';

const TICK_AFTER_FETCH_MS = 15_000;
/** Pauses after the first to fourth Cloudflare block; after that until tomorrow. */
const CF_PAUSES_MS = [5, 10, 15, 20].map(min => min * 60 * 1000);

/** 00:05: by then the daily quota is free again. */
function nextTag(now: Date): Date {
  const z = new Date(now);
  z.setHours(0, 5, 0, 0);
  if (z <= now) z.setDate(z.getDate() + 1);
  return z;
}

/** Two job processes should not share the tick; own connection,
 * because advisory locks are bound to the session. */
function withLock<T>(k: CatalogContext, lauf: () => Promise<T>): Promise<T> {
  return withSessionLock(k.db, LOCKS.INSTRUCTION_QUEUE, lauf, () => {
    throw new JobMove(new Date(k.clock.now() + TICK_AFTER_FETCH_MS), 'Anleitungen laufen in einem anderen Prozess');
  });
}

async function reportInstructions(k: CatalogContext, setNumber: string, lauf?: JobRun): Promise<void> {
  const z = await k.jobQueue.countKind('instructions');
  const open = z.pending + z.running,
    total = open + z.done + z.error;
  await lauf?.progress?.({
    done: total - open + 1,
    total,
    text: open > 1 ? `${setNumber} · ${open - 1} ausstehend` : 'Alle erledigt',
  });
}

/** Throttling postpones the job without counting it as an attempt. */
async function loadInstruction(k: CatalogContext, n: Payload<'instructions'>, lauf?: JobRun): Promise<void> {
  const sn = n.set_number;
  if ((await instructionCount(k, sn)) > 0) return;
  if (n.nur_ausweichquelle) {
    await scrapeInstructionsFromFallback(k, sn);
    return;
  }
  await withLock(k, async () => {
    try {
      // The spacing is kept by the kind's pause, not by the function.
      const count = await loadSetInstructions(k, sn, true);
      console.log(`[instr-queue] ${sn}: ${count} instructions`);
      if (await k.jobQueue.liesPause('instructions')) await k.jobQueue.endPause('instructions');
      if (lastFetchWarExtern(k))
        await k.jobQueue.pauseKind(
          'instructions',
          new Date(k.clock.now() + TICK_AFTER_FETCH_MS),
          'Abstand zwischen zwei Abrufen',
        );
      await reportInstructions(k, sn, lauf);
    } catch (e) {
      await pauseOnThrottle(k, e, lauf);
      throw e;
    }
  });
}

/** Cloudflare pauses in growing steps, a daily limit until tomorrow; both postpone the job (JobMove). */
async function pauseOnThrottle(k: CatalogContext, e: unknown, lauf?: JobRun): Promise<void> {
  const msg = errorMessage(e) || '';
  if (asFetchError(e).isCloudflare || msg.includes('1015')) {
    const level = (await k.jobQueue.liesPause('instructions'))?.level ?? 0;
    const stepped = level < CF_PAUSES_MS.length;
    const bis = stepped ? new Date(k.clock.now() + CF_PAUSES_MS[level]!) : nextTag(k.clock.datum());
    const reason = stepped
      ? `Cloudflare-Sperre: ${Math.round(CF_PAUSES_MS[level]! / 60000)} min warten (Versuch ${level + 1})`
      : 'Cloudflare-Sperre: bis morgen pausiert';
    await k.jobQueue.pauseKind('instructions', bis, reason, stepped ? level + 1 : 0);
    await lauf?.progress?.({ text: reason });
    console.log(`[instr-queue] ${reason}`);
    throw new JobMove(bis, reason);
  }
  if (msg.includes('Tageslimit') || msg.includes('rate limit') || msg.includes('429')) {
    const bis = nextTag(k.clock.datum());
    await k.jobQueue.pauseKind('instructions', bis, 'Tageskontingent erschöpft');
    throw new JobMove(bis, 'Tageskontingent erschöpft');
  }
}

export { TICK_AFTER_FETCH_MS, CF_PAUSES_MS, nextTag, loadInstruction };
