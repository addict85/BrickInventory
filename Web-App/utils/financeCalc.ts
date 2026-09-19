/**
 * Der Finanzteil — eine Tuer fuer alle Aufrufstellen.
 *
 * ── Warum die Datei nur noch weiterreicht (Nachtrag 171) ────────────────────
 *
 * Sie trug 1529 Zeilen und drei Aufgaben zugleich: Preisbeschaffung,
 * Bewertung und Gewinnrechnung. Wer am Anfragekontingent etwas aenderte,
 * arbeitete in derselben Datei wie die Gewinnrechnung.
 *
 * Jetzt liegen sie unter utils/finance/ in der Reihenfolge, in der sie
 * aufeinander stehen — die Schichtung hat `tsc` beim Trennen aufgedeckt, nicht
 * ich (siehe den Kopf von preise.ts). Sechzehn Aufrufstellen zeigen weiterhin
 * hierher; keine einzige musste angefasst werden. Genau dafuer ist diese Datei
 * geblieben.
 */

export {
  DEFAULT_PRICE_CONDITION, PRICE_CACHE_COLS,
  speicherePreis, cacheUsable, preisAusCache,
  checkAndIncrementRateLimit, getLimitForApi, getRateLimitStatus,
  fetchPrice, parallelLimit, resolveBlColorId, resolveBlPartNumber,
  fetchPartPrice, fetchMinifigPrice,
  farbkarte, ladeBlNummernVor,
  resolveSetCondition,
} from './finance/preise';

export {
  computeSetsValuation, computeMinifigsValuation, computePartsValuation,
} from './finance/bewertung';

export { computePnl } from './finance/gewinnVerlust';
export { effectiveCondition } from './finance/zustand';
