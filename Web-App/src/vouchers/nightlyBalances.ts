/** The nightly balance run (job voucher_balances): every live card with a PIN of every
 * account, one after another through the same throttle as the button, so the night
 * never asks LEGO more often than a user could. */
import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import { checkAbort, jobKind, type JobRun, type Login } from '../jobQueue';
import { errorMessage } from '../infra/error';
import { checkBalance, voucherList } from './service';
import type { VoucherContext } from './context';

const EMPTY = z.object({});

declare module '../jobQueue/jobs' {
  interface JobPayloads {
    voucher_balances: typeof EMPTY;
  }
}

/** Quiet hour before the catalog sync (03:00) and the Brickset retry (04:00). */
export const VOUCHER_BALANCES_TIME_OF_DAY = { setting: 'job_time_voucher_balances', preset: '02:00' } as const;

/** Waits per card while the throttle says "not yet": beyond that someone else keeps the
 * slot busy, and the card is simply checked again next night. */
const MAX_WAITS = 10;

export type Pause = (seconds: number, signal?: AbortSignal) => Promise<void>;
const pauseFor: Pause = (seconds, signal) => sleep(seconds * 1000, undefined, signal ? { signal } : {});

/** A failed card is a value, not an exception: one unreadable card must not cost every
 * other account its check, and its reason still reaches the job's progress and the log. */
type Outcome = 'checked' | 'removed' | 'stop' | { error: string };
export interface NightlyReport {
  checked: number;
  removed: number;
  failed: number;
  stopped: boolean;
  /** `voucher <id>: <reason>`; the lookup has already redacted number and PIN. */
  errors: string[];
}

async function lookup(k: VoucherContext, uid: number, id: number) {
  try {
    return await checkBalance(k, uid, id);
  } catch (e) {
    return { kind: 'fehler' as const, error: errorMessage(e) };
  }
}

async function oneCard(
  k: VoucherContext,
  uid: number,
  id: number,
  run: JobRun | undefined,
  pause: Pause,
): Promise<Outcome> {
  for (let waits = 0; waits <= MAX_WAITS; waits++) {
    checkAbort(run);
    const r = await lookup(k, uid, id);
    if (r.kind === 'fehler') return { error: r.error };
    if (r.kind === 'guthaben') return r.removed ? 'removed' : 'checked';
    // Bot protection: every further card would hit the same wall and prolong the block.
    if (r.reason === 'botschutz') return 'stop';
    await pause(r.waitSeconds, run?.signal);
  }
  return { error: 'throttle stayed busy' };
}

function tally(report: NightlyReport, id: number, outcome: Outcome): void {
  if (outcome === 'stop') report.stopped = true;
  else if (typeof outcome === 'string') report[outcome]++;
  else {
    report.failed++;
    report.errors.push(`voucher ${id}: ${outcome.error}`);
  }
}

/** Each account under its own row security (inNamesOfJob), as a job of that account would run. */
export async function nightlyBalances(k: VoucherContext, run?: JobRun, pause: Pause = pauseFor) {
  const accounts = await k.vouchers.accountsWithCards();
  const total = accounts.reduce((n, a) => n + a.cards, 0);
  const report: NightlyReport = { checked: 0, removed: 0, failed: 0, stopped: false, errors: [] };
  for (const { user_id: uid } of accounts) {
    await k.jobQueue.inNamesOfJob({ type: 'voucher_balances', user_id: uid }, async () => {
      for (const card of await voucherList(k, uid, 'aelteste')) {
        if (!card.pin || report.stopped) continue;
        tally(report, card.id, await oneCard(k, uid, card.id, run, pause));
        const done = report.checked + report.removed + report.failed;
        await run?.progress?.({ done, total, failed: report.failed, text: report.errors.at(-1) ?? null });
      }
    });
    if (report.stopped) break;
  }
  console.log(
    `[vouchers] nightly balances: ${report.checked} checked, ${report.removed} empty removed, ${report.failed} failed` +
      (report.stopped ? ', stopped by bot protection' : '') +
      (report.errors.length ? ` (${report.errors.join('; ')})` : ''),
  );
  return report;
}

export function voucherJobKinds(k: VoucherContext): Login[] {
  return [
    jobKind({
      kind: 'voucher_balances',
      payload: EMPTY,
      run: async (_n, l) => void (await nightlyBalances(k, l)),
      exclusive: true,
      crossAccount: 'voucher balances of all accounts',
      schedule: { daily: VOUCHER_BALANCES_TIME_OF_DAY },
    }),
  ];
}
