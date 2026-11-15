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
      zaehlerStand: mit(k)(zaehler.zaehlerStand),
      zaehleVersuch: mit(k)(zaehler.zaehleVersuch),
      reserviere: mit(k)(zaehler.reserviere),
      gibPlatzFrei: mit(k)(zaehler.gibPlatzFrei),
      vergissZaehler: mit(k)(zaehler.vergissZaehler),
      zaehleImFenster: mit(k)(zaehler.zaehleImFenster),
      raeumeAuf: mit(k)(zaehler.raeumeAuf),
      einmalJeTag: mit(k)(zaehler.einmalJeTag),
      stundenStand: k.zaehler.stundenStand,
      zaehleStunde: k.zaehler.zaehleStunde,
    }),
    einblick,
  );
}

export type DrosselDienste = ReturnType<typeof erzeugeDrossel>;
