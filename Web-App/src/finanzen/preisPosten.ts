import { z } from 'zod';
import type { NutzlastEingabe } from '../auftraege';
import type { FinanzenKontext } from './kontext';

const SETNR = z.string().min(1).max(64);
const ZUSTAND = z.enum(['N', 'U']);
const PreisPosten = z.discriminatedUnion('art', [
  z.object({ art: z.literal('set'), nummer: SETNR, zustand: ZUSTAND }),
  z.object({ art: z.literal('teil'), nummer: SETNR, farbe: z.number().int(), zustand: ZUSTAND }),
  z.object({ art: z.literal('figur'), nummer: SETNR, zustand: ZUSTAND }),
  z.object({ art: z.literal('schaetzung'), nummer: SETNR, zustand: ZUSTAND }),
]);
export const PREISPOSTEN_HOECHSTENS = 2000;
export const PreiseNachladen = z.object({
  user_id: z.number().int().positive(),
  waehrung: z.string().min(3).max(3),
  posten: z.array(PreisPosten).max(PREISPOSTEN_HOECHSTENS),
});

declare module '../auftraege/auftraege' {
  interface AuftragsNutzlasten {
    preise_nachladen: typeof PreiseNachladen;
  }
}

/** Fehlende Preise eines Kontos in einer Währung: höchstens ein wartender Auftrag, der jede neue Meldung aufnimmt. */
export function merkePreiseVor(k: FinanzenKontext, n: NutzlastEingabe<'preise_nachladen'>): Promise<string> {
  return k.auftraege.ergaenzeListenAuftrag('preise_nachladen', n, {
    schluessel: `preise_nachladen:${n.user_id}:${n.waehrung}`,
    liste: 'posten',
    hoechstens: PREISPOSTEN_HOECHSTENS,
    userId: n.user_id,
  });
}
