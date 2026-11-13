import { umschluesseln } from '../infra/geheimnis';
import { faktorKontext } from './zweiterFaktor';
import type { KontoKontext } from './kontext';

/** Klartext und v1 (ohne Kontext) auf v2 bringen, bevor eine Anfrage sie liest:
 * entschluessele() nimmt nur noch v2. Läuft bei jedem Start; v2 bleibt, wie es ist. */
export async function verschluesseleAltbestand(k: KontoKontext, o: { alle?: boolean } = {}): Promise<number> {
  let n = await k.einstellungen.verschluesseleGlobaleAltwerte();
  for (const z of await k.altgeheimnisse.alteFaktorGeheimnisse(o.alle)) {
    const neu = umschluesseln(z.v, faktorKontext(z.uid));
    if (neu) n += await k.altgeheimnisse.ersetzeFaktorGeheimnis(z.uid, z.v, neu);
  }
  return n;
}
