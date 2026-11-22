import { z } from 'zod';
import { jobKind, type Login } from '../jobQueue';
import { ImagesPayload } from '../catalog';
import * as afterAcquisition from './afterAdd';
import type { SetsContext } from './context';

const ACCOUNT = z.number().int().positive();
const SET_NUMBER = z.string().min(1).max(64);

const ReworkPayload = z.object({
  set_number: SET_NUMBER,
  user_id: ACCOUNT,
  art: z.enum(['zweit', 'neu', 'csv', 'ergaenzen']).optional(),
});

declare module '../jobQueue/jobs' {
  interface JobPayloads {
    nacharbeit: typeof ReworkPayload;
  }
}

export function setsJobTypes(sk: SetsContext): Login[] {
  return [
    jobKind({
      art: 'nacharbeit',
      payload: ReworkPayload,
      ausfuehren: (n, l) => afterAcquisition.pullAfter(sk, n.set_number, n.user_id, n.art ?? 'neu', l),
    }),
    jobKind({
      art: 'bilder',
      payload: ImagesPayload,
      ausfuehren: async (n, l) => {
        if (n.only_images) await sk.catalog.loadSetImages(n.set_number);
        else await afterAcquisition.loadSetImages(sk, n.set_number, l);
      },
    }),
  ];
}
