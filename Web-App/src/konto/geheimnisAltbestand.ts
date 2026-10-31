import { verschluessele, istVerschluesselt } from '../infra/geheimnis';
import { verschluesseleGlobaleAltwerte } from './settings';
import * as repo from './repository/altgeheimnisse';

/** Ohne das läge ein alter PIN-Bestand weiter lesbar in jedem Datenbank-Abzug.
 * Läuft bei jedem Start; Verschlüsseltes bleibt, wie es ist. */
export async function verschluesseleAltbestand(): Promise<number> {
  let n = await verschluesseleGlobaleAltwerte();
  for (const z of await repo.klartextKandidaten()) {
    if (!z.v || istVerschluesselt(z.v)) continue;
    n += await repo.ersetzeGeheimnis(z.art, z.k, z.v, verschluessele(z.v));
  }
  return n;
}
