/** As a job, so that a failure is retried and stays visible. */
import type { JobRun } from '../jobQueue';
import {
  ECB_HISTORY,
  ECB_DAILY_RATES,
  firstZipFile,
  readHistory,
  readDailyRates,
  type Fetch,
  type Rate,
} from '../externalSources';
import type { FinancesContext } from './context';

const BLOCK = 5000;

/** An existing day is overwritten: the ECB rarely corrects, but it does. */
export async function saveRates(kx: FinancesContext, rates: Rate[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < rates.length; i += BLOCK) {
    const teil = rates.slice(i, i + BLOCK);
    const r = await kx.exchangeRates.writeRates(
      teil.map(k => k.tag),
      teil.map(k => k.currency),
      teil.map(k => String(k.je_eur)),
    );
    n += r?.changes ?? 0;
  }
  return n;
}

export async function reloadRates(
  k: FinancesContext,
  download: Fetch = k.externalSources.sources.ecbFetch,
  signal?: AbortSignal,
): Promise<{ source: 'historie' | 'tag'; rates: number }> {
  const leer = !(await k.exchangeRates.givesEsRates());
  const rates = leer
    ? readHistory(firstZipFile(await download(ECB_HISTORY, signal)).toString('utf8'))
    : readDailyRates((await download(ECB_DAILY_RATES, signal)).toString('utf8'));
  if (!rates.length) throw new Error(`EZB lieferte keine Kurse (${leer ? 'Historie' : 'Tageskurse'})`);
  return { source: leer ? 'historie' : 'tag', rates: await saveRates(k, rates) };
}

/** 15:30 UTC is after the ECB's publication. One key of its own per
 * day: a failed attempt must not block the next day. */
export async function scheduleRateFetch(
  k: FinancesContext,
  now = k.clock.datum(),
  morgen = false,
): Promise<string | null> {
  const target = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + (morgen ? 1 : 0), 15, 30),
  );
  const sec = Math.max(0, Math.round((target.getTime() - now.getTime()) / 1000));
  return k.jobQueue.placeJobOne(
    'exchange_rates',
    {},
    {
      key: `exchange_rates:${target.toISOString().slice(0, 10)}`,
      afterSeconds: morgen ? sec : 0,
      maxAttempts: 6,
    },
  );
}

/** Schedule the next day first, then load: if loading fails, the schedule is already in place. */
export async function rateJob(
  k: FinancesContext,
  download: Fetch = k.externalSources.sources.ecbFetch,
  lauf?: JobRun,
): Promise<void> {
  await scheduleRateFetch(k, k.clock.datum(), true);
  const r = await reloadRates(k, download, lauf?.signal);
  console.log(`[wechselkurse] ${r.rates} Kurse aus der EZB-${r.source === 'historie' ? 'Historie' : 'Tagesdatei'}`);
}
