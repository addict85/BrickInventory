import { z } from 'zod';
import { jobKind, type Login } from '../jobQueue';
import { processImageDemand } from './imageDemandRun';
import type { ImagesContext } from './context';

const LEER = z.object({});

declare module '../jobQueue/jobs' {
  interface JobPayloads {
    bildbedarf: typeof LEER;
  }
}

export function imagesJobTypes(k: ImagesContext): Login[] {
  return [
    jobKind({
      art: 'bildbedarf',
      payload: LEER,
      ausfuehren: (_n, l) => processImageDemand(k, l),
      exklusiv: true,
      kontouebergreifend: 'Bildbedarf aller Bestände',
    }),
  ];
}
