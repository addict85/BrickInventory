/** Die öffentliche Seite des Bereichs: Andere Bereiche importieren nur von hier,
 * damit die Aufteilung der Dateien darunter frei bleibt. */
import { gutscheineBereich } from './prozess';
import { dienstePerAufruf } from '../infra/bereich';
export { verschluesseleGutscheinAltbestand } from './gutscheinDateien';
export type { AusPdf, GutscheinAenderung, GutscheinZeile, GuthabenErgebnis } from './dienst';
export { PIN_MASKE, maskiert, pruefeWerte } from './dienst';
export {
  VOUCHER_DIR,
  gutscheinDatei,
  liesGutscheinPdf,
  liesGutscheinPdfOderNichts,
  schreibeGutscheinPdf,
} from './gutscheinDateien';
export { landErlaubt, landFuerWaehrung } from './gutscheinGuthaben';
export { ABSTAND_SEK } from './gutscheinGuthabenSchranke';
export type { GutscheinWerte } from './gutscheinPdf';
export { verbindeGutscheine } from './gutscheinPdfSchreiben';
export type { ExportGutschein } from './gutscheinPdfSchreiben';
export { HOECHSTENS_SEITEN, liesImHintergrund } from './pdfLesen';
export { TICKET_SEK, loeseTicketEin, stelleTicketAus } from './pdfTicket';
export { erzeugeGutscheine } from './bereich';
export type { GutscheineDienste, GutscheineKontext } from './bereich';
export { gutscheineBereich } from './prozess';

/** Für Wege ohne eigenen Kontext (HTTP-Seiten, Tests): die Dienste des Prozesses. */
export const {
  exportFreigeben,
  frageGuthabenAb,
  guthabenAbfragen,
  gutscheinAusPdf,
  gutscheinBearbeiten,
  gutscheinEntfernen,
  gutscheinErfassen,
  gutscheinKlartext,
  gutscheinListe,
  gutscheinMitPdfAnlegen,
  gutscheinPdf,
  gutscheineExportieren,
  pdfFreigeben,
  stapelAnlegen,
} = dienstePerAufruf(gutscheineBereich, [
  'exportFreigeben',
  'frageGuthabenAb',
  'guthabenAbfragen',
  'gutscheinAusPdf',
  'gutscheinBearbeiten',
  'gutscheinEntfernen',
  'gutscheinErfassen',
  'gutscheinKlartext',
  'gutscheinListe',
  'gutscheinMitPdfAnlegen',
  'gutscheinPdf',
  'gutscheineExportieren',
  'pdfFreigeben',
  'stapelAnlegen',
]);
