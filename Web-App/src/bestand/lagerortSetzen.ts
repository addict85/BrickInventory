/** Den Lagerort setzen: eigene Datei, weil die Funktion den Kontext nimmt, den
 * kontext.ts erst aus den übrigen Lagerort-Diensten baut. */
import * as orte from './repository/lagerort';
import type { Schreiber } from '../haushalt';
import type { LagerArt } from './lagerort';
import type { BestandKontext } from './kontext';

/** Wer schreiben darf, entscheidet src/haushalt/haushalt.ts; diese Funktion
 * bekommt die fertige Menge und fragt nicht nach.
 * @returns wie viele Zeilen betroffen waren (0 = es gibt nichts zu setzen) */
export async function setzeLagerort(
  k: BestandKontext,
  art: LagerArt,
  besitzerIdsWahl: Schreiber | number[],
  schluessel: string[],
  ort: string | null,
): Promise<number> {
  const besitzerIds = await k.haushalt.schreibbereichAus(besitzerIdsWahl);
  if (ort === null) return orte.ordneOrtZu(k.db, art, besitzerIds, null, schluessel);
  // Ein neuer Name kommt in den Vorrat — vor der Zuordnung, die ihn über die ID findet.
  return k.transaktion(async t => {
    const ids = await orte.besitzerMitZeile(t.db, art, besitzerIds, schluessel);
    if (!ids.length) return 0;
    await orte.nimmOrtAuf(t.db, ids, ort);
    return orte.ordneOrtZu(t.db, art, ids, ort, schluessel);
  });
}
