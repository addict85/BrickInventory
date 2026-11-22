/** Prices that a valuation did not find in the cache (src/finances/calculation/valuation.ts):
 * fetched here in the job process, with quota and abort, not in the request. */
import { fetchPrice, fetchPartPrice, fetchMinifigPrice } from './calculation/prices';
import { estimateMinifigsPrice } from './marketPrice';
import { checkAbort, JobMove, type JobContext, type Payload } from '../jobQueue';
import { reportError } from '../infra/error';
import type { FinancesContext } from './context';

type Item = Payload<'preise_nachladen'>['posten'][number];

async function fetchOne(k: FinancesContext, p: Item, uid: number, currency: string, ttl: string): Promise<void> {
  if (p.art === 'set') await fetchPrice(k, p.nummer, p.zustand, 'sold', currency, ttl);
  else if (p.art === 'teil') await fetchPartPrice(k, p.nummer, p.farbe, p.zustand, currency, ttl);
  else if (p.art === 'figur') await fetchMinifigPrice(k, p.nummer, p.zustand, currency, ttl);
  else await estimateMinifigsPrice(k, p.nummer, uid, p.zustand);
}

/** If the daily quota is exhausted, the rest waits until tomorrow; a single failure does not stop the list. */
async function reloadPrices(kx: FinancesContext, n: Payload<'preise_nachladen'>, k: JobContext): Promise<void> {
  const ttl = (await kx.einstellungen.globalValue('price_cache_ttl', '24')) || '24';
  for (const [i, p] of n.posten.entries()) {
    checkAbort(k);
    if (!(await kx.externalSources.quotaFree('bricklink')).allowed)
      throw new JobMove(new Date(kx.uhr.jetzt() + 6 * 3600_000), 'BrickLink-Tageskontingent erschöpft');
    await fetchOne(kx, p, n.user_id, n.waehrung, ttl).catch((e: unknown) =>
      reportError(`preise-nachladen:${p.art} ${p.nummer}`, e),
    );
    if (i % 10 === 9) await k.progress({ erledigt: i + 1, gesamt: n.posten.length });
  }
}

export { reloadPrices };
