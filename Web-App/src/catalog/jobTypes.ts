/** Not strict: the payload survives deploys, a legacy field should not make an open job fail. */
import { z } from 'zod';
import { jobKind, type Login } from '../jobQueue';
import { bricksetJobType } from '../externalSources';
import * as loadInstruction from './loadInstruction';
import * as imageFollowUp from './imageFollowUp';
import * as reloadImages from './reloadImages';
import * as bricksetFollowUp from './bricksetFollowUp';
import * as csvReconcile from './csvSync';
import * as pdfGeneration from './pdf/pdfGeneration';
import * as revocationList from './revocationList';
import type { CatalogContext } from './context';

const SET_NUMBER = z.string().min(1).max(64);
const LEER = z.object({});

const PdfTeil = z.object({
  part_number: z.string(),
  bl_part_number: z.string().nullish(),
  part_name: z.string().nullish(),
  color_id: z.number().int().nullish(),
  color_name: z.string().nullish(),
  color_hex: z.string().nullish(),
  quantity: z.union([z.number(), z.string()]).nullish(),
  is_fig: z.union([z.boolean(), z.number()]).nullish(),
  image_url: z.string().nullish(),
  image_local: z.string().nullish(),
});

export const PdfPayload = z.object({
  job_id: z.string().min(1),
  user_id: z.number().int().positive(),
  sets: z.array(z.object({ set_number: z.string(), name: z.string().nullish() })),
  parts: z.array(PdfTeil),
});
/** Queued by the catalog and by the sets; executed by the sets (src/sets/jobTypes.ts). */
export const ImagesPayload = z.object({ set_number: SET_NUMBER, only_images: z.boolean().optional() });
const InstructionPayload = z.object({ set_number: SET_NUMBER, nur_ausweichquelle: z.boolean().optional() });
const CatalogSyncPayload = z.object({ onStart: z.boolean().optional() });

declare module '../jobQueue/jobs' {
  interface JobPayloads {
    pdf: typeof PdfPayload;
    images: typeof ImagesPayload;
    instructions: typeof InstructionPayload;
    images_reload: typeof LEER;
    csv_sync: typeof CatalogSyncPayload;
    image_followup: typeof LEER;
    revocation_list: typeof LEER;
  }
}

export const CATALOG_SYNC_TIME_OF_DAY = { setting: 'job_time_csv_sync', preset: '03:00' } as const;

/** Exclusive are kinds that spare a remote side or swap tables. */
export function catalogJobTypes(k: CatalogContext, importProcess: string): Login[] {
  return [
    jobKind({
      kind: 'pdf',
      payload: PdfPayload,
      run: (n, l) => pdfGeneration.createPdf(k, n, l),
      givenUp: (n, error) => pdfGeneration.pdfGivenUp(n, error),
      discardPayload: true,
    }),
    jobKind({
      kind: 'instructions',
      payload: InstructionPayload,
      run: (n, l) => loadInstruction.loadInstruction(k, n, l),
      exclusive: true,
    }),
    bricksetJobType((n, l) => bricksetFollowUp.bricksetFollowUp(k, n, l)),
    jobKind({
      kind: 'images_reload',
      payload: LEER,
      run: async (_n, l) => {
        await reloadImages.redownloadMissingImages(k, l);
      },
      exclusive: true,
      crossAccount: 'fehlende Bilder aller Bestände',
    }),
    jobKind({
      kind: 'csv_sync',
      payload: CatalogSyncPayload,
      run: (n, l) => csvReconcile.csvReconcile(k, n, l, importProcess),
      exclusive: true,
      crossAccount: 'BrickLink-Nummern der Teile aller Konten',
      schedule: { daily: CATALOG_SYNC_TIME_OF_DAY },
    }),
    jobKind({
      kind: 'image_followup',
      payload: LEER,
      run: (_n, l) => imageFollowUp.imageFollowUp(k, l),
      exclusive: true,
      crossAccount: 'Bilder aller Bestände',
      schedule: { minutes: { preset: 60 } },
    }),
    jobKind({
      kind: 'revocation_list',
      payload: LEER,
      run: (_n, l) => revocationList.loadRevocationList(k, l),
      schedule: { minutes: { preset: 6 * 60 } },
    }),
  ];
}
