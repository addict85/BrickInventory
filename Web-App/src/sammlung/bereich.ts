/** Die Fabrik des Bereichs: Dienste als Closure über k (baueBereich, src/infra/bereich.ts). */
import { mit, baueBereich, type Einblick } from '../infra/bereich';
import * as erfassungenDienst from './erfassungen';
import * as loeschenDienst from './loeschen';
import * as importAuftraege from './importAuftraege';
import { zugang, type SammlungAbhaengigkeiten, type SammlungKontext } from './kontext';

export type { SammlungAbhaengigkeiten, SammlungKontext } from './kontext';

export function erzeugeSammlung(a: SammlungAbhaengigkeiten, einblick?: Einblick<SammlungKontext>) {
  return baueBereich(
    a,
    zugang,
    (k: SammlungKontext) => ({
      erfassungAendern: mit(k)(erfassungenDienst.erfassungAendern),
      erfassungLoeschen: mit(k)(erfassungenDienst.erfassungLoeschen),
      setErfassungen: mit(k)(erfassungenDienst.setErfassungen),
      loescheTeil: mit(k)(loeschenDienst.loescheTeil),
      loescheFigur: mit(k)(loeschenDienst.loescheFigur),
      loescheAllesEigene: mit(k)(loeschenDienst.loescheAllesEigene),
      fuehreImportAus: mit(k)(importAuftraege.fuehreImportAus),
    }),
    einblick,
  );
}

export type SammlungDienste = ReturnType<typeof erzeugeSammlung>;
