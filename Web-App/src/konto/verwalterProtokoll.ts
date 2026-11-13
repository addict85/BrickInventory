/** Protokoll der Verwalteraktionen an fremden Konten; gehört zum Konto, weil
 * auch das Löschen eines Kontos es in derselben Transaktion schreibt. */
import type { VerwalterAktion } from './repository/protokoll';
import type { KontoKontext } from './kontext';

export type { VerwalterAktion } from './repository/protokoll';

export function verwalterAktionMerken(
  k: KontoKontext,
  verwalterId: number,
  zielId: number,
  aktion: VerwalterAktion,
  einzelheiten: string | null = null,
): Promise<void> {
  return k.protokoll.protokolliere(verwalterId, zielId, aktion, einzelheiten);
}

export function verwaltungsProtokoll(k: KontoKontext) {
  return k.protokoll.letzteEintraege();
}
