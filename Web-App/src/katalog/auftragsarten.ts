/** Nicht strikt: Die Nutzlast überlebt Deploys, ein Altfeld soll keinen offenen Auftrag scheitern lassen. */
import { z } from 'zod';
import { auftragsart, type Anmeldung } from '../auftraege';
import { bricksetAuftragsart } from '../fremdquellen';
import * as anleitungLaden from './anleitungLaden';
import * as bildNachlauf from './bildNachlauf';
import * as bilderNachladen from './bilderNachladen';
import * as bricksetNachlauf from './bricksetNachlauf';
import * as csvAbgleich from './csvAbgleich';
import * as pdfErzeugung from './pdf/pdfErzeugung';
import * as widerrufsliste from './widerrufsliste';
import type { KatalogKontext } from './kontext';

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

export const PdfNutzlast = z.object({
  job_id: z.string().min(1),
  user_id: z.number().int().positive(),
  sets: z.array(z.object({ set_number: z.string(), name: z.string().nullish() })),
  parts: z.array(PdfTeil),
});
/** Eingereiht vom Katalog und von den Sets; ausgeführt von den Sets (src/sets/auftragsarten.ts). */
export const BilderNutzlast = z.object({ set_number: SETNR, nur_bilder: z.boolean().optional() });
const AnleitungNutzlast = z.object({ set_number: SETNR, nur_ausweichquelle: z.boolean().optional() });
const KatalogAbgleichNutzlast = z.object({ beimStart: z.boolean().optional() });

declare module '../auftraege/auftraege' {
  interface AuftragsNutzlasten {
    pdf: typeof PdfNutzlast;
    bilder: typeof BilderNutzlast;
    anleitung: typeof AnleitungNutzlast;
    bilder_neu_laden: typeof LEER;
    csv_sync: typeof KatalogAbgleichNutzlast;
    bild_nachlauf: typeof LEER;
    widerrufsliste: typeof LEER;
  }
}

export const KATALOG_ABGLEICH_UHRZEIT = { einstellung: 'job_time_csv_sync', vorgabe: '03:00' } as const;

/** Exklusiv sind Arten, die eine Gegenseite schonen oder Tabellen tauschen. */
export function katalogAuftragsarten(k: KatalogKontext, importProzess: string): Anmeldung[] {
  return [
    auftragsart({
      art: 'pdf',
      nutzlast: PdfNutzlast,
      ausfuehren: (n, l) => pdfErzeugung.erzeugePdf(k, n, l),
      aufgegeben: (n, fehler) => pdfErzeugung.pdfAufgegeben(n, fehler),
      nutzlastVerwerfen: true,
    }),
    auftragsart({
      art: 'anleitung',
      nutzlast: AnleitungNutzlast,
      ausfuehren: (n, l) => anleitungLaden.anleitungLaden(k, n, l),
      exklusiv: true,
    }),
    bricksetAuftragsart((n, l) => bricksetNachlauf.bricksetNachlauf(k, n, l)),
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
      nutzlast: KatalogAbgleichNutzlast,
      ausfuehren: (n, l) => csvAbgleich.csvAbgleich(k, n, l, importProzess),
      exklusiv: true,
      kontouebergreifend: 'BrickLink-Nummern der Teile aller Konten',
      zeitplan: { taeglich: KATALOG_ABGLEICH_UHRZEIT },
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
      ausfuehren: (_n, l) => widerrufsliste.ladeWiderrufsliste(k, l),
      zeitplan: { minuten: { vorgabe: 6 * 60 } },
    }),
  ];
}
