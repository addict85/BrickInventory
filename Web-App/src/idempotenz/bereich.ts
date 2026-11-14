/** Die Fabrik des Bereichs: Jeder Dienst nimmt den Kontext (kontext.ts) als ersten
 * Parameter; erzeugeIdempotenz bindet ihn einmal für alle. So greift kein Dienst auf den
 * Prozess zu, und ein Test gibt einen eigenen Zugang. */
import { baueKontext, bindeZugang, type Einblick } from '../infra/bereich';
import * as dienst from './dienst';
import { zugang, type IdempotenzAbhaengigkeiten, type IdempotenzKontext } from './kontext';

export type { IdempotenzAbhaengigkeiten, IdempotenzKontext } from './kontext';

export function erzeugeIdempotenz(a: IdempotenzAbhaengigkeiten, einblick?: Einblick<IdempotenzKontext>) {
  const k: IdempotenzKontext = baueKontext(a, zugang);
  einblick?.(k);
  return {
    ...bindeZugang(k, dienst, [
      'alteAbdrueckeLoeschen',
      'antwortenUmschluesseln',
      'alleVergessen',
      'raeumeIdempotenzAuf',
      'beginne',
      'beende',
      'gibFrei',
      'mitWirkungsVermerk',
    ]),
  };
}

export type IdempotenzDienste = ReturnType<typeof erzeugeIdempotenz>;
