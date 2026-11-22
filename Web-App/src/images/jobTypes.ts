import { z } from 'zod';
import { jobKind, type Login } from '../jobQueue';
import { processImageDemand } from './imageDemandRun';
import type { ImagesContext } from './context';

const LEER = z.object({});

declare module '../jobQueue/jobs' {
  interface JobPayloads {
    image_demand: typeof LEER;
  }
}

export function imagesJobTypes(k: ImagesContext): Login[] {
  return [
    jobKind({
      kind: 'image_demand',
      payload: LEER,
      ausfuehren: (_n, l) => processImageDemand(k, l),
      exklusiv: true,
      kontouebergreifend: 'Bildbedarf aller Bestände',
    }),
  ];
}
