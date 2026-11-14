/** Die Nutzlast überlebt Deploys: Einsteller und Worker prüfen gegen dasselbe Schema.
 * Nicht strikt, damit ein Altfeld keinen offenen Auftrag scheitern lässt. */
import { z } from 'zod';
import type { AuftragsArt } from './auftraege';

const KONTO = z.number().int().positive();
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

const CsvZeile = z.object({
  sn: z.string(),
  qty: z.number().int(),
  purchasePrice: z.number().nullable(),
  condition: z.string().nullable(),
  acquiredAt: z.string().nullable(),
  // Zeile der Datei und, wenn sie schon beim Lesen scheiterte, warum: Das Ergebnis nennt sie dann an ihrem Platz.
  zeile: z.number().int().optional(),
  fehler: z
    .object({ code: z.enum(['csv_menge_ungueltig', 'csv_keine_setnummer']), wert: z.string().optional() })
    .optional(),
});

/** Eine Korrektur der Wanted-Vorschau; der Import gleicht `blId` mit dem Posten ab. */
export const WantedKorrektur = z.object({
  index: z.number().int().min(0),
  blId: z.string().max(64),
  art: z.enum(['part', 'fig', 'set']),
  rbId: z.string().max(64).nullish(),
  rbFarbe: z.number().int().nullish(),
  menge: z.number().optional(),
  zustand: z.string().max(16).nullish(),
  kaufpreis: z.number().nullish(),
});

export const WantedKorrekturen = z.array(WantedKorrektur).max(100_000);

const text = z.string();
/** Ein Import, auf den eine Anfrage wartet (importAlsAuftrag); je Quelle eine Eingabe. */
export const ImportNutzlast = z.discriminatedUnion('quelle', [
  z.object({ user_id: KONTO, quelle: z.literal('teile_csv'), eingabe: z.object({ text }) }),
  z.object({ user_id: KONTO, quelle: z.literal('figuren_csv'), eingabe: z.object({ text }) }),
  z.object({ user_id: KONTO, quelle: z.literal('merkliste_csv'), eingabe: z.object({ text, owner: KONTO }) }),
  z.object({
    user_id: KONTO,
    quelle: z.literal('alarme_csv'),
    eingabe: z.object({ text, waehrung: z.string().min(1).max(8) }),
  }),
  z.object({
    user_id: KONTO,
    quelle: z.literal('wanted_xml'),
    eingabe: z.object({
      xml: text,
      dateiName: z.string().max(200),
      schreiben: z.boolean(),
      ueberRebrickable: z.boolean(),
      korrekturen: WantedKorrekturen.optional(),
    }),
  }),
]);
export const SetCsvNutzlast = z.object({ user_id: KONTO, lauf: z.string().min(1), rows: z.array(CsvZeile) });

/** Preise, die eine Bewertung im Cache nicht fand; geholt werden sie im Job-Prozess. */
export const PreisPosten = z.discriminatedUnion('art', [
  z.object({ art: z.literal('set'), nummer: SETNR, zustand: z.enum(['N', 'U']) }),
  z.object({ art: z.literal('teil'), nummer: SETNR, farbe: z.number().int(), zustand: z.enum(['N', 'U']) }),
  z.object({ art: z.literal('figur'), nummer: SETNR, zustand: z.enum(['N', 'U']) }),
  z.object({ art: z.literal('schaetzung'), nummer: SETNR, zustand: z.enum(['N', 'U']) }),
]);
export const PREISPOSTEN_HOECHSTENS = 2000;
const PreiseNachladen = z.object({
  user_id: KONTO,
  waehrung: z.string().min(3).max(3),
  posten: z.array(PreisPosten).max(PREISPOSTEN_HOECHSTENS),
});

/** Die Schritte des Nachlaufs nach dem Start; src/verwaltung/startNachlaeufe.ts hält genau diese. */
export const NACHLAUF_SCHRITTE = [
  'geheimnisse',
  'vorschauen',
  'katalog',
  'anleitungen',
  'set_bilder',
  'kaufpreise',
] as const;

export const NUTZLASTEN = {
  nacharbeit: z.object({
    set_number: SETNR,
    user_id: KONTO,
    art: z.enum(['zweit', 'neu', 'csv', 'ergaenzen']).optional(),
  }),
  bilder: z.object({ set_number: SETNR, nur_bilder: z.boolean().optional() }),
  pdf: z.object({
    job_id: z.string().min(1),
    user_id: KONTO,
    sets: z.array(z.object({ set_number: z.string(), name: z.string().nullish() })),
    parts: z.array(PdfTeil),
  }),
  csv_import: z.union([ImportNutzlast, SetCsvNutzlast]),
  wechselkurse: LEER,
  anleitung: z.object({ set_number: SETNR, nur_ausweichquelle: z.boolean().optional() }),
  brickset: z.object({ set_number: SETNR, versuch: z.number().int().optional() }),
  bildbedarf: LEER,
  bilder_neu_laden: LEER,
  nachlauf: z.object({ schritt: z.enum(NACHLAUF_SCHRITTE) }),
  csv_sync: z.object({ beimStart: z.boolean().optional() }),
  preise: LEER,
  bild_nachlauf: LEER,
  aufraeumen: LEER,
  aufraeumen_taeglich: LEER,
  konto_dateien: z.object({ user_id: KONTO }),
  preise_nachladen: PreiseNachladen,
  widerrufsliste: LEER,
} satisfies Record<AuftragsArt, z.ZodType>;

export type Nutzlast<A extends AuftragsArt> = z.output<(typeof NUTZLASTEN)[A]>;
export type NutzlastEingabe<A extends AuftragsArt> = z.input<(typeof NUTZLASTEN)[A]>;

/** Wirft schon beim Einstellen, nicht erst Stunden später im Worker. */
export function pruefeNutzlast<A extends AuftragsArt>(art: A, roh: unknown): Nutzlast<A> {
  const schema: z.ZodType | undefined = Object.hasOwn(NUTZLASTEN, art) ? NUTZLASTEN[art] : undefined;
  if (!schema) throw new NutzlastUngueltig(`unbekannte Auftragsart ${art}`);
  const r = schema.safeParse(roh);
  if (r.success) return r.data as Nutzlast<A>;
  const i = r.error.issues[0];
  throw new NutzlastUngueltig(`Nutzlast für ${art} ungültig: ${i?.path.join('.') || '$'}: ${i?.message ?? ''}`);
}

/** Ein Auftrag mit dieser Nutzlast wird nie gelingen: Der Worker versucht ihn nicht erneut. */
export class NutzlastUngueltig extends Error {}
