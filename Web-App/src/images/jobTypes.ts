import { z } from 'zod';
import { jobKind, type Login } from '../jobQueue';
import { processImageDemand } from './imageDemandRun';
import type { ImagesContext } from './context';

const EMPTY = z.object({});

declare module '../jobQueue/jobs' {
  interface JobPayloads {
    image_demand: typeof EMPTY;
  }
}

export function imagesJobTypes(k: ImagesContext): Login[] {
  return [
    jobKind({
      kind: 'image_demand',
      payload: EMPTY,
      run: (_n, l) => processImageDemand(k, l),
      exclusive: true,
      crossAccount: 'Bildbedarf aller Bestände',
    }),
  ];
}
