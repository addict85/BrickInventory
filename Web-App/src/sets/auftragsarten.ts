import { z } from 'zod';
import { auftragsart, type Anmeldung } from '../auftraege';
import { ImagesPayload } from '../catalog';
import * as nachErfassung from './nachErfassung';
import type { SetsContext } from './kontext';

const KONTO = z.number().int().positive();
const SETNR = z.string().min(1).max(64);

const ReworkPayload = z.object({
  set_number: SETNR,
  user_id: KONTO,
  art: z.enum(['zweit', 'neu', 'csv', 'ergaenzen']).optional(),
});

declare module '../auftraege/auftraege' {
  interface JobPayloads {
    nacharbeit: typeof ReworkPayload;
  }
}

export function setsJobTypes(sk: SetsContext): Anmeldung[] {
  return [
    auftragsart({
      art: 'nacharbeit',
      nutzlast: ReworkPayload,
      ausfuehren: (n, l) => nachErfassung.pullAfter(sk, n.set_number, n.user_id, n.art ?? 'neu', l),
    }),
    auftragsart({
      art: 'bilder',
      nutzlast: ImagesPayload,
      ausfuehren: async (n, l) => {
        if (n.only_images) await sk.catalog.loadSetImages(n.set_number);
        else await nachErfassung.loadSetImages(sk, n.set_number, l);
      },
    }),
  ];
}
