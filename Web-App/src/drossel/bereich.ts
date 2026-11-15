/** Die Fabrik des Bereichs: Dienste als Closure über k (baueBereich, src/infra/bereich.ts). */
import { baueBereich, mit, type Einblick } from '../infra/bereich';
import * as zaehler from './zaehler';
import { zugang, type DrosselAbhaengigkeiten, type DrosselKontext } from './kontext';

export type { DrosselAbhaengigkeiten, DrosselKontext } from './kontext';

/** Anmeldung, Guthabenabfrage und Quellenabruf zählen in einer Tabelle; schreiben darf nur dieser Bereich. */
export function erzeugeDrossel(a: DrosselAbhaengigkeiten, einblick?: Einblick<DrosselKontext>) {
  return baueBereich(
    a,
    zugang,
    (k: DrosselKontext) => ({
      stand: mit(k)(zaehler.stand),
      zaehle: mit(k)(zaehler.zaehle),
      reserviere: mit(k)(zaehler.reserviere),
      gibFrei: mit(k)(zaehler.gibFrei),
      vergiss: mit(k)(zaehler.vergiss),
      zaehleAnfrage: mit(k)(zaehler.zaehleAnfrage),
      raeumeAuf: mit(k)(zaehler.raeumeAuf),
      einmalJeTag: mit(k)(zaehler.einmalJeTag),
      // Die Guthabenschranke prüft und zählt in ihrer eigenen Transaktion (src/gutscheine).
      stundenStand: k.zaehler.stundenStand,
      zaehleStunde: k.zaehler.zaehleStunde,
    }),
    einblick,
  );
}

export type DrosselDienste = ReturnType<typeof erzeugeDrossel>;
