import { z } from 'zod';
import { auftragsart, type Anmeldung } from '../auftraege';
import { bildbedarfAbarbeiten } from './bildbedarfLauf';
import type { BilderKontext } from './kontext';

const LEER = z.object({});

declare module '../auftraege/auftraege' {
  interface AuftragsNutzlasten {
    bildbedarf: typeof LEER;
  }
}

export function bilderAuftragsarten(k: BilderKontext): Anmeldung[] {
  return [
    auftragsart({
      art: 'bildbedarf',
      nutzlast: LEER,
      ausfuehren: (_n, l) => bildbedarfAbarbeiten(k, l),
      exklusiv: true,
      kontouebergreifend: 'Bildbedarf aller Bestände',
    }),
  ];
}
