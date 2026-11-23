import { z } from 'zod';
import type { PayloadInput } from '../jobQueue';
import type { FinancesContext } from './context';

const SET_NUMBER = z.string().min(1).max(64);
const CONDITION = z.enum(['N', 'U']);
const PriceItem = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('set'), number: SET_NUMBER, condition: CONDITION }),
  z.object({ kind: z.literal('teil'), number: SET_NUMBER, farbe: z.number().int(), condition: CONDITION }),
  z.object({ kind: z.literal('figur'), number: SET_NUMBER, condition: CONDITION }),
  z.object({ kind: z.literal('schaetzung'), number: SET_NUMBER, condition: CONDITION }),
]);
export const PRICE_ITEM_AT_MOST = 2000;
export const PricesReload = z.object({
  user_id: z.number().int().positive(),
  currency: z.string().min(3).max(3),
  items: z.array(PriceItem).max(PRICE_ITEM_AT_MOST),
});

declare module '../jobQueue/jobs' {
  interface JobPayloads {
    price_refresh: typeof PricesReload;
  }
}

/** Missing prices of an account in one currency: at most one waiting job that picks up every new report. */
export function rememberPricesBefore(k: FinancesContext, n: PayloadInput<'price_refresh'>): Promise<string> {
  return k.jobQueue.supplementListenJob('price_refresh', n, {
    key: `price_refresh:${n.user_id}:${n.currency}`,
    list: 'items',
    atMost: PRICE_ITEM_AT_MOST,
    userId: n.user_id,
  });
}
