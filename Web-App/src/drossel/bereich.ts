/** Die Fabrik des Bereichs: Dienste als Closure über k (baueBereich, src/infra/bereich.ts). */
import { baueBereich, type Einblick } from '../infra/bereich';
import { zugang, type DrosselAbhaengigkeiten, type DrosselKontext } from './kontext';

export type { DrosselAbhaengigkeiten, DrosselKontext } from './kontext';

/** Anmeldung, Guthabenabfrage und Quellenabruf zählen in einer Tabelle; schreiben darf nur dieser Bereich. */
export function erzeugeDrossel(a: DrosselAbhaengigkeiten, einblick?: Einblick<DrosselKontext>) {
  return baueBereich(a, zugang, (k: DrosselKontext) => ({ ...k.zaehler }), einblick);
}

export type DrosselDienste = ReturnType<typeof erzeugeDrossel>;
