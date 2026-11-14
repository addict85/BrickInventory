/** Die Fabrik des Bereichs: Jeder Dienst nimmt den Kontext (kontext.ts) als ersten
 * Parameter; erzeugeGutscheine bindet ihn einmal für alle. So greift kein Dienst auf den
 * Prozess zu, und ein Test gibt einen eigenen Zugang. */
import { baueKontext, bindeZugang, type Einblick } from '../infra/bereich';
import * as dienst from './dienst';
import * as gutscheinGuthabenSchranke from './gutscheinGuthabenSchranke';
import { zugang, type GutscheineAbhaengigkeiten, type GutscheineKontext } from './kontext';

export type { GutscheineAbhaengigkeiten, GutscheineKontext } from './kontext';

export function erzeugeGutscheine(a: GutscheineAbhaengigkeiten, einblick?: Einblick<GutscheineKontext>) {
  const k: GutscheineKontext = baueKontext(a, zugang);
  einblick?.(k);
  return {
    ...bindeZugang(k, dienst, [
      'gutscheinMitPdfAnlegen',
      'gutscheinBearbeiten',
      'gutscheinKlartext',
      'pdfFreigeben',
      'exportFreigeben',
      'guthabenAbfragen',
      'gutscheinListe',
      'gutscheinErfassen',
      'stapelAnlegen',
      'gutscheinEntfernen',
      'gutscheinAusPdf',
      'gutscheineExportieren',
      'gutscheinPdf',
    ]),
    ...bindeZugang(k, gutscheinGuthabenSchranke, ['frageGuthabenAb']),
    // Umschlüsseln beim Start (startup/datenbank.ts): über alle Konten, ohne Anfrage.
    nummernNachverschluesseln: k.gutscheine.nummernNachverschluesseln,
    kopienVerschluesseln: k.gutscheine.kopienVerschluesseln,
    gutscheineNeuVerschluesseln: k.gutscheine.gutscheineNeuVerschluesseln,
  };
}

export type GutscheineDienste = ReturnType<typeof erzeugeGutscheine>;
