/** Not strict: the payload survives deploys, a legacy field should not make an open job fail. */
import { z } from 'zod';
import { auftragsart, type Anmeldung } from '../jobQueue';
import { bricksetJobType } from '../externalSources';
import * as anleitungLaden from './loadInstruction';
import * as bildNachlauf from './imageFollowUp';
import * as bilderNachladen from './reloadImages';
import * as bricksetNachlauf from './bricksetFollowUp';
import * as csvAbgleich from './csvSync';
import * as pdfErzeugung from './pdf/pdfGeneration';
import * as widerrufsliste from './revocationList';
import type { CatalogContext } from './context';

const SETNR = z.string().min(1).max(64);
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
export const ImagesPayload = z.object({ set_number: SETNR, only_images: z.boolean().optional() });
const InstructionPayload = z.object({ set_number: SETNR, nur_ausweichquelle: z.boolean().optional() });
const CatalogSyncPayload = z.object({ onStart: z.boolean().optional() });

declare module '../jobQueue/jobs' {
  interface JobPayloads {
    pdf: typeof PdfPayload;
    bilder: typeof ImagesPayload;
    anleitung: typeof InstructionPayload;
    bilder_neu_laden: typeof LEER;
    csv_sync: typeof CatalogSyncPayload;
    bild_nachlauf: typeof LEER;
    widerrufsliste: typeof LEER;
  }
}

export const CATALOG_SYNC_TIME_OF_DAY = { setting: 'job_time_csv_sync', vorgabe: '03:00' } as const;

/** Exclusive are kinds that spare a remote side or swap tables. */
export function catalogJobTypes(k: CatalogContext, importProcess: string): Anmeldung[] {
  return [
    auftragsart({
      art: 'pdf',
      nutzlast: PdfPayload,
      ausfuehren: (n, l) => pdfErzeugung.createPdf(k, n, l),
      aufgegeben: (n, fehler) => pdfErzeugung.pdfGivenUp(n, fehler),
      discardPayload: true,
    }),
    auftragsart({
      art: 'anleitung',
      nutzlast: InstructionPayload,
      ausfuehren: (n, l) => anleitungLaden.anleitungLaden(k, n, l),
      exklusiv: true,
    }),
    bricksetJobType((n, l) => bricksetNachlauf.bricksetNachlauf(k, n, l)),
    auftragsart({
      art: 'bilder_neu_laden',
      nutzlast: LEER,
      ausfuehren: async (_n, l) => {
        await bilderNachladen.redownloadMissingImages(k, l);
      },
      exklusiv: true,
      kontouebergreifend: 'fehlende Bilder aller Bestände',
    }),
    auftragsart({
      art: 'csv_sync',
      nutzlast: CatalogSyncPayload,
      ausfuehren: (n, l) => csvAbgleich.csvAbgleich(k, n, l, importProcess),
      exklusiv: true,
      kontouebergreifend: 'BrickLink-Nummern der Teile aller Konten',
      zeitplan: { taeglich: CATALOG_SYNC_TIME_OF_DAY },
    }),
    auftragsart({
      art: 'bild_nachlauf',
      nutzlast: LEER,
      ausfuehren: (_n, l) => bildNachlauf.bildNachlauf(k, l),
      exklusiv: true,
      kontouebergreifend: 'Bilder aller Bestände',
      zeitplan: { minuten: { vorgabe: 60 } },
    }),
    auftragsart({
      art: 'widerrufsliste',
      nutzlast: LEER,
      ausfuehren: (_n, l) => widerrufsliste.loadRevocationList(k, l),
      zeitplan: { minuten: { vorgabe: 6 * 60 } },
    }),
  ];
}
