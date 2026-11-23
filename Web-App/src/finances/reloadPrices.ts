/** Prices that a valuation did not find in the cache (src/finances/calculation/valuation.ts):
 * fetched here in the job process, with quota and abort, not in the request. */
import { fetchPrice, fetchPartPrice, fetchMinifigPrice } from './calculation/prices';
import { estimateMinifigsPrice } from './marketPrice';
import { checkAbort, JobMove, type JobContext, type Payload } from '../jobQueue';
import { reportError } from '../infra/error';
import type { FinancesContext } from './context';

type Item = Payload<'price_refresh'>['items'][number];

async function fetchOne(k: FinancesContext, p: Item, uid: number, currency: string, ttl: string): Promise<void> {
  if (p.kind === 'set') await fetchPrice(k, p.number, p.condition, 'sold', currency, ttl);
  else if (p.kind === 'teil') await fetchPartPrice(k, p.number, p.farbe, p.condition, currency, ttl);
  else if (p.kind === 'figur') await fetchMinifigPrice(k, p.number, p.condition, currency, ttl);
  else await estimateMinifigsPrice(k, p.number, uid, p.condition);
}

/** If the daily quota is exhausted, the rest waits until tomorrow; a single failure does not stop the list. */
async function reloadPrices(kx: FinancesContext, n: Payload<'price_refresh'>, k: JobContext): Promise<void> {
  const ttl = (await kx.settings.globalValue('price_cache_ttl', '24')) || '24';
  for (const [i, p] of n.items.entries()) {
    checkAbort(k);
    if (!(await kx.externalSources.quotaFree('bricklink')).allowed)
      throw new JobMove(new Date(kx.clock.now() + 6 * 3600_000), 'BrickLink-Tageskontingent erschöpft');
    await fetchOne(kx, p, n.user_id, n.currency, ttl).catch((e: unknown) =>
      reportError(`preise-nachladen:${p.kind} ${p.number}`, e),
    );
    if (i % 10 === 9) await k.progress({ done: i + 1, total: n.items.length });
  }
}

export { reloadPrices };
