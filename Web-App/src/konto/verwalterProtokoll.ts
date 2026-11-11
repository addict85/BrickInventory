/** Protokoll der Verwalteraktionen an fremden Konten; gehört zum Konto, weil
 * auch das Löschen eines Kontos es in derselben Transaktion schreibt. */
export type { VerwalterAktion } from './repository/protokoll';
