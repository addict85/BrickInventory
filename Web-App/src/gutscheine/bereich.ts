/** Die Fabrik des Bereichs: Dienste als Closure über k (baueBereich, src/infra/bereich.ts). */
import { mit, baueBereich, type Einblick } from '../infra/bereich';
import { Faecher } from '../infra/zwischenspeicher';
import * as dienst from './dienst';
import * as pdfTicket from './pdfTicket';
import * as gutscheinGuthabenSchranke from './gutscheinGuthabenSchranke';
import { zugang, type GutscheineAbhaengigkeiten, type GutscheineKontext } from './kontext';

export type { GutscheineAbhaengigkeiten, GutscheineKontext } from './kontext';

export function erzeugeGutscheine(
  a: Omit<GutscheineAbhaengigkeiten, 'faecher'>,
  einblick?: Einblick<GutscheineKontext>,
) {
  return baueBereich(
    { ...a, faecher: new Faecher() },
    zugang,
    (k: GutscheineKontext) => ({
      gutscheinMitPdfAnlegen: mit(k)(dienst.gutscheinMitPdfAnlegen),
      gutscheinBearbeiten: mit(k)(dienst.gutscheinBearbeiten),
      gutscheinKlartext: mit(k)(dienst.gutscheinKlartext),
      pdfFreigeben: mit(k)(dienst.pdfFreigeben),
      exportFreigeben: mit(k)(dienst.exportFreigeben),
      guthabenAbfragen: mit(k)(dienst.guthabenAbfragen),
      gutscheinListe: mit(k)(dienst.gutscheinListe),
      gutscheinErfassen: mit(k)(dienst.gutscheinErfassen),
      stapelAnlegen: mit(k)(dienst.stapelAnlegen),
      gutscheinEntfernen: mit(k)(dienst.gutscheinEntfernen),
      gutscheinAusPdf: mit(k)(dienst.gutscheinAusPdf),
      gutscheineExportieren: mit(k)(dienst.gutscheineExportieren),
      gutscheinPdf: mit(k)(dienst.gutscheinPdf),
      frageGuthabenAb: mit(k)(gutscheinGuthabenSchranke.frageGuthabenAb),
      loeseTicketEin: mit(k)(pdfTicket.loeseTicketEin),
      // Umschlüsseln beim Start (startup/datenbank.ts): über alle Konten, ohne Anfrage.
      nummernNachverschluesseln: k.gutscheine.nummernNachverschluesseln,
      kopienVerschluesseln: k.gutscheine.kopienVerschluesseln,
      gutscheineNeuVerschluesseln: k.gutscheine.gutscheineNeuVerschluesseln,
    }),
    einblick,
  );
}

export type GutscheineDienste = ReturnType<typeof erzeugeGutscheine>;
