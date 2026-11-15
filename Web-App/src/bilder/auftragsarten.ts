/** Der eine Auftrag der Bilder: den gemerkten Bildbedarf in Stapeln abarbeiten. */
import { z } from 'zod';
import { auftragsart, type Anmeldung } from '../auftraege';
import type { BilderDienste } from './bereich';

const LEER = z.object({});

declare module '../auftraege/auftraege' {
  interface AuftragsNutzlasten {
    bildbedarf: typeof LEER;
  }
}

export function bilderAuftragsarten(d: BilderDienste): Anmeldung[] {
  return [
    auftragsart({
      art: 'bildbedarf',
      nutzlast: LEER,
      ausfuehren: (_n, k) => d.bildbedarfAbarbeiten(k),
      exklusiv: true,
      kontouebergreifend: 'Bildbedarf aller Bestände',
    }),
  ];
}
