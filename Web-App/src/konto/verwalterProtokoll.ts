/** Protokoll der Verwalteraktionen an fremden Konten; gehört zum Konto, weil
 * auch das Löschen eines Kontos es in derselben Transaktion schreibt. */
import type { VerwalterAktion } from './repository/protokoll';
import { kontoBereich } from './prozess';

export type { VerwalterAktion } from './repository/protokoll';

export function verwalterAktionMerken(
  verwalterId: number,
  zielId: number,
  aktion: VerwalterAktion,
  einzelheiten: string | null = null,
): Promise<void> {
  return kontoBereich().protokoll.protokolliere(verwalterId, zielId, aktion, einzelheiten);
}

export function verwaltungsProtokoll() {
  return kontoBereich().protokoll.letzteEintraege();
}
