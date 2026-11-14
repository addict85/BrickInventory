/** Die Fabrik des Bereichs: Dienste als Closure über k (baueBereich, src/infra/bereich.ts). */
import { mit, baueBereich, type Einblick } from '../infra/bereich';
import * as dienst from './dienst';
import { zugang, type IdempotenzAbhaengigkeiten, type IdempotenzKontext } from './kontext';

export type { IdempotenzAbhaengigkeiten, IdempotenzKontext } from './kontext';

export function erzeugeIdempotenz(a: IdempotenzAbhaengigkeiten, einblick?: Einblick<IdempotenzKontext>) {
  return baueBereich(
    a,
    zugang,
    (k: IdempotenzKontext) => ({
      alteAbdrueckeLoeschen: mit(k)(dienst.alteAbdrueckeLoeschen),
      antwortenUmschluesseln: mit(k)(dienst.antwortenUmschluesseln),
      alleVergessen: mit(k)(dienst.alleVergessen),
      raeumeIdempotenzAuf: mit(k)(dienst.raeumeIdempotenzAuf),
      beginne: mit(k)(dienst.beginne),
      beende: mit(k)(dienst.beende),
      gibFrei: mit(k)(dienst.gibFrei),
      mitWirkungsVermerk: mit(k)(dienst.mitWirkungsVermerk),
    }),
    einblick,
  );
}

export type IdempotenzDienste = ReturnType<typeof erzeugeIdempotenz>;
