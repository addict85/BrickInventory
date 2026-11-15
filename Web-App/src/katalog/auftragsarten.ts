/** Die Aufträge des Katalogs: Nutzlast und Ausführer. Die Nutzlast überlebt Deploys, Einsteller
 * und Worker prüfen gegen dasselbe Schema; nicht strikt, damit ein Altfeld keinen offenen scheitern lässt. */
import { z } from 'zod';
import { auftragsart, type Anmeldung } from '../auftraege';
import { BricksetNutzlast } from '../fremdquellen';
import type { KatalogDienste } from './bereich';

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

/** Exklusiv sind Arten, die eine Gegenseite schonen oder Tabellen tauschen.
 * @param importProzess Einstieg des Katalog-Imports, der in einem eigenen Prozess läuft */
export function katalogAuftragsarten(d: KatalogDienste, importProzess: string): Anmeldung[] {
  return [
    auftragsart({
      art: 'pdf',
      nutzlast: PdfNutzlast,
      ausfuehren: (n, k) => d.erzeugePdf(n, k),
      aufgegeben: (n, fehler) => d.pdfAufgegeben(n, fehler),
    }),
    auftragsart({
      art: 'anleitung',
      nutzlast: AnleitungNutzlast,
      ausfuehren: (n, k) => d.anleitungLaden(n, k),
      exklusiv: true,
    }),
    auftragsart({
      art: 'brickset',
      nutzlast: BricksetNutzlast,
      ausfuehren: (n, k) => d.bricksetNachlauf(n, k),
      exklusiv: true,
    }),
    auftragsart({
      art: 'bilder_neu_laden',
      nutzlast: LEER,
      ausfuehren: async (_n, k) => {
        await d.redownloadMissingImages(k);
      },
      exklusiv: true,
      kontouebergreifend: 'fehlende Bilder aller Bestände',
    }),
    auftragsart({
      art: 'csv_sync',
      nutzlast: KatalogAbgleichNutzlast,
      ausfuehren: (n, k) => d.csvAbgleich(n, k, importProzess),
      exklusiv: true,
      kontouebergreifend: 'BrickLink-Nummern der Teile aller Konten',
      zeitplan: { taeglich: KATALOG_ABGLEICH_UHRZEIT },
    }),
    auftragsart({
      art: 'bild_nachlauf',
      nutzlast: LEER,
      ausfuehren: (_n, k) => d.bildNachlauf(k),
      exklusiv: true,
      kontouebergreifend: 'Bilder aller Bestände',
      zeitplan: { minuten: { vorgabe: 60 } },
    }),
    auftragsart({
      art: 'widerrufsliste',
      nutzlast: LEER,
      ausfuehren: (_n, k) => d.ladeWiderrufsliste(k),
      zeitplan: { minuten: { vorgabe: 6 * 60 } },
    }),
  ];
}
