import { z } from 'zod';
import type { PayloadInput } from '../auftraege';
import type { FinancesContext } from './kontext';

const SETNR = z.string().min(1).max(64);
const ZUSTAND = z.enum(['N', 'U']);
const PriceItem = z.discriminatedUnion('art', [
  z.object({ art: z.literal('set'), nummer: SETNR, zustand: ZUSTAND }),
  z.object({ art: z.literal('teil'), nummer: SETNR, farbe: z.number().int(), zustand: ZUSTAND }),
  z.object({ art: z.literal('figur'), nummer: SETNR, zustand: ZUSTAND }),
  z.object({ art: z.literal('schaetzung'), nummer: SETNR, zustand: ZUSTAND }),
]);
export const PRICE_ITEM_AT_MOST = 2000;
export const PricesReload = z.object({
  user_id: z.number().int().positive(),
  waehrung: z.string().min(3).max(3),
  posten: z.array(PriceItem).max(PRICE_ITEM_AT_MOST),
});

declare module '../auftraege/auftraege' {
  interface JobPayloads {
    preise_nachladen: typeof PricesReload;
  }
}

/** Fehlende Preise eines Kontos in einer Währung: höchstens ein wartender Auftrag, der jede neue Meldung aufnimmt. */
export function rememberPricesBefore(k: FinancesContext, n: PayloadInput<'preise_nachladen'>): Promise<string> {
  return k.auftraege.supplementListenJob('preise_nachladen', n, {
    schluessel: `preise_nachladen:${n.user_id}:${n.waehrung}`,
    liste: 'posten',
    hoechstens: PRICE_ITEM_AT_MOST,
    userId: n.user_id,
  });
}
