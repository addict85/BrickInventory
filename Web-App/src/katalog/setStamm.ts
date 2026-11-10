/** Set-Stammdaten (rb_sets), ihre Ergänzung (set_catalog) und den Abrufspeicher
 * schreibt der Katalog; andere Bereiche rufen nur hierher, mit ihrem eigenen
 * Zugang oder ihrer Transaktion. */
export { merkeSetKatalog, merkeKatalogPlatzhalter, katalogStand, merkeKatalogCache } from './repository/setStamm';
