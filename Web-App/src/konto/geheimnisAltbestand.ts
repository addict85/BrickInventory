import { umschluesseln } from '../infra/geheimnis';
import { verschluesseleGlobaleAltwerte } from '../einstellungen/settings';
import { faktorKontext } from './zweiterFaktor';
import { kontoBereich } from './prozess';

/** Klartext und v1 (ohne Kontext) auf v2 bringen, bevor eine Anfrage sie liest:
 * entschluessele() nimmt nur noch v2. Läuft bei jedem Start; v2 bleibt, wie es ist. */
export async function verschluesseleAltbestand(o: { alle?: boolean } = {}): Promise<number> {
  let n = await verschluesseleGlobaleAltwerte();
  for (const z of await kontoBereich().altgeheimnisse.alteFaktorGeheimnisse(o.alle)) {
    const neu = umschluesseln(z.v, faktorKontext(z.uid));
    if (neu) n += await kontoBereich().altgeheimnisse.ersetzeFaktorGeheimnis(z.uid, z.v, neu);
  }
  return n;
}
