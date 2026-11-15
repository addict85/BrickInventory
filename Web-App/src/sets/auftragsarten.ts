/** Die Aufträge der Sets: Nacharbeit nach dem Erfassen und die Bilder eines Sets. */
import { z } from 'zod';
import { auftragsart, type Anmeldung } from '../auftraege';
import { BilderNutzlast, type KatalogDienste } from '../katalog';
import type { SetsDienste } from './bereich';

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

export function setsAuftragsarten(d: SetsDienste, katalog: KatalogDienste): Anmeldung[] {
  return [
    auftragsart({
      art: 'nacharbeit',
      nutzlast: NacharbeitNutzlast,
      ausfuehren: (n, k) => d.zieheNach(n.set_number, n.user_id, n.art ?? 'neu', k),
    }),
    auftragsart({
      art: 'bilder',
      nutzlast: BilderNutzlast,
      ausfuehren: async (n, k) => {
        if (n.nur_bilder) await katalog.ladeSetBilder(n.set_number);
        else await d.ladeSetBilder(n.set_number, k);
      },
    }),
  ];
}
