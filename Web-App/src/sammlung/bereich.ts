/** Die Fabrik des Bereichs: Jeder Dienst nimmt den Kontext (kontext.ts) als ersten
 * Parameter; erzeugeSammlung bindet ihn einmal für alle. So greift kein Dienst auf den
 * Prozess zu, und ein Test gibt einen eigenen Zugang. */
import { baueKontext, bindeZugang, type Einblick } from '../infra/bereich';
import * as erfassungenDienst from './erfassungen';
import * as loeschenDienst from './loeschen';
import * as importAuftraege from './importAuftraege';
import { zugang, type SammlungAbhaengigkeiten, type SammlungKontext } from './kontext';

export type { SammlungAbhaengigkeiten, SammlungKontext } from './kontext';

export function erzeugeSammlung(a: SammlungAbhaengigkeiten, einblick?: Einblick<SammlungKontext>) {
  const k: SammlungKontext = baueKontext(a, zugang);
  einblick?.(k);
  return {
    ...bindeZugang(k, erfassungenDienst, ['erfassungAendern', 'erfassungLoeschen', 'setErfassungen']),
    ...bindeZugang(k, loeschenDienst, ['loescheTeil', 'loescheFigur', 'loescheAllesEigene']),
    ...bindeZugang(k, importAuftraege, ['fuehreImportAus']),
  };
}

export type SammlungDienste = ReturnType<typeof erzeugeSammlung>;
