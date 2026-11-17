/** Die Importe ausser dem Set-CSV (das in setCsvImport.ts zeilenweise
 * fortsetzt). Die Route reicht ein und wartet (importiere). */
import { csvImportBericht } from '../infra/csvExport';
import { Fachfehler } from '../infra/fehlerTexte';
import { z } from 'zod';
import type { AuftragsZeile, AuftragsKontext, Fortschritt } from '../auftraege';
import { SetCsvNutzlast } from '../sets';
import { importiereWantedXml } from './wantedXmlImport';
import type { SammlungKontext } from './kontext';

const KONTO = z.number().int().positive();
const text = z.string();

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

const ImportNutzlastSchema = z.discriminatedUnion('quelle', [
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
export const CsvImportNutzlast = z.union([ImportNutzlastSchema, SetCsvNutzlast]);

declare module '../auftraege/auftraege' {
  interface AuftragsNutzlasten {
    csv_import: typeof CsvImportNutzlast;
  }
}

export type ImportQuelle = z.input<typeof ImportNutzlastSchema>['quelle'];
/** Was der Import der Quelle braucht. */
export type ImportEingabe<Q extends ImportQuelle> = Extract<
  z.input<typeof ImportNutzlastSchema>,
  { quelle: Q }
>['eingabe'];

/** Die Route reicht ein und wartet; der Import läuft im Job-Prozess. */
export function importiere<T = Record<string, unknown>, Q extends ImportQuelle = ImportQuelle>(
  k: SammlungKontext,
  uid: number,
  quelle: Q,
  eingabe: ImportEingabe<Q>,
  o: { fortschritt?: (f: Fortschritt) => void; wartenMs?: number } = {},
): Promise<T> {
  // tsc verbindet Q nicht mit dem Zweig der Union; geprüft wird beim Einstellen.
  const nutzlast = { user_id: uid, quelle, eingabe } as z.input<typeof ImportNutzlastSchema>;
  return k.auftraege.warteAufAuftrag<T, 'csv_import'>('csv_import', nutzlast, { ...o, userId: uid });
}

export type ImportNutzlast = z.output<typeof ImportNutzlastSchema>;

async function ergebnisVon(
  kx: SammlungKontext,
  n: ImportNutzlast,
  k: AuftragsKontext,
): Promise<Record<string, unknown>> {
  const uid = n.user_id;
  switch (n.quelle) {
    case 'teile_csv':
      return csvImportBericht(await kx.teile.importiereTeileCsv(uid, n.eingabe.text));
    case 'figuren_csv':
      return csvImportBericht(await kx.minifigs.importMinifigsCsv(uid, n.eingabe.text));
    case 'merkliste_csv':
      return csvImportBericht(await kx.merkliste.importiereMerklisteCsv(n.eingabe.owner, n.eingabe.text));
    case 'alarme_csv':
      return kx.finanzen.preisalarm.alarmeAusCsv(uid, n.eingabe.waehrung, n.eingabe.text);
    case 'wanted_xml':
      return importiereWantedXml(kx, uid, n.eingabe, k);
  }
}

/** Ein Fachfehler ist ein Ergebnis (die Anfrage meldet ihn mit Code), kein Fehlschlag des Auftrags. */
async function fuehreImportAus(
  kx: SammlungKontext,
  n: ImportNutzlast,
  k: AuftragsKontext,
  a: AuftragsZeile,
): Promise<void> {
  try {
    await kx.auftraege.setzeErgebnis(a.id, await ergebnisVon(kx, n, k));
  } catch (e) {
    if (!(e instanceof Fachfehler)) throw e;
    await kx.auftraege.setzeFachfehler(a.id, e);
  }
}

export { fuehreImportAus };
