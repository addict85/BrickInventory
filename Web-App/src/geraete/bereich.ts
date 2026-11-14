/** Die Fabrik des Bereichs: Dienste als Closure über k (baueBereich, src/infra/bereich.ts). */
import { mit, baueBereich, type Einblick } from '../infra/bereich';
import * as geraeteChallenge from './geraeteChallenge';
import { zugang, type GeraeteAbhaengigkeiten, type GeraeteKontext } from './kontext';

export type { GeraeteAbhaengigkeiten, GeraeteKontext } from './kontext';

export function erzeugeGeraete(a: GeraeteAbhaengigkeiten, einblick?: Einblick<GeraeteKontext>) {
  return baueBereich(
    a,
    zugang,
    (k: GeraeteKontext) => ({
      neueNonce: mit(k)(geraeteChallenge.neueNonce),
      hinterlegeSchluessel: mit(k)(geraeteChallenge.hinterlegeSchluessel),
      neueChallenge: mit(k)(geraeteChallenge.neueChallenge),
      loeseEin: mit(k)(geraeteChallenge.loeseEin),
      pruefeFreigabe: mit(k)(geraeteChallenge.pruefeFreigabe),
      familieDesTokens: k.geraeteSchluessel.familieDesTokens,
    }),
    einblick,
  );
}

export type GeraeteDienste = ReturnType<typeof erzeugeGeraete>;
