import { z } from 'zod';
import { auftragsart, type Anmeldung } from '../auftraege';
import { BilderNutzlast } from '../katalog';
import * as nachErfassung from './nachErfassung';
import type { SetsKontext } from './kontext';

const KONTO = z.number().int().positive();
const SETNR = z.string().min(1).max(64);

const NacharbeitNutzlast = z.object({
  set_number: SETNR,
  user_id: KONTO,
  art: z.enum(['zweit', 'neu', 'csv', 'ergaenzen']).optional(),
});

declare module '../auftraege/auftraege' {
  interface AuftragsNutzlasten {
    nacharbeit: typeof NacharbeitNutzlast;
  }
}

export function setsAuftragsarten(sk: SetsKontext): Anmeldung[] {
  return [
    auftragsart({
      art: 'nacharbeit',
      nutzlast: NacharbeitNutzlast,
      ausfuehren: (n, l) => nachErfassung.zieheNach(sk, n.set_number, n.user_id, n.art ?? 'neu', l),
    }),
    auftragsart({
      art: 'bilder',
      nutzlast: BilderNutzlast,
      ausfuehren: async (n, l) => {
        if (n.nur_bilder) await sk.katalog.ladeSetBilder(n.set_number);
        else await nachErfassung.ladeSetBilder(sk, n.set_number, l);
      },
    }),
  ];
}
