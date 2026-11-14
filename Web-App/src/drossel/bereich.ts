/** Die Fabrik des Bereichs: Dienste als Closure über k (baueBereich, src/infra/bereich.ts). */
import { baueBereich, type Einblick } from '../infra/bereich';
import { zugang, type DrosselAbhaengigkeiten, type DrosselKontext } from './kontext';

export type { DrosselAbhaengigkeiten, DrosselKontext } from './kontext';

/** Die Zähler in rate_limit_attempts: Anmeldung, Guthabenabfrage und Quellenabruf zählen in
 * derselben Tabelle, also schreibt sie nur dieser Bereich. In einer Transaktion über `t.drossel`. */
export function erzeugeDrossel(a: DrosselAbhaengigkeiten, einblick?: Einblick<DrosselKontext>) {
  return baueBereich(a, zugang, (k: DrosselKontext) => ({ ...k.zaehler }), einblick);
}

export type DrosselDienste = ReturnType<typeof erzeugeDrossel>;
