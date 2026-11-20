import { z } from 'zod';
import { auftragsart, type Anmeldung } from '../auftraege';
import { processImageDemand } from './imageDemandRun';
import type { ImagesContext } from './context';

const LEER = z.object({});

declare module '../auftraege/auftraege' {
  interface JobPayloads {
    bildbedarf: typeof LEER;
  }
}

export function imagesJobTypes(k: ImagesContext): Anmeldung[] {
  return [
    auftragsart({
      art: 'bildbedarf',
      nutzlast: LEER,
      ausfuehren: (_n, l) => processImageDemand(k, l),
      exklusiv: true,
      kontouebergreifend: 'Bildbedarf aller Bestände',
    }),
  ];
}
