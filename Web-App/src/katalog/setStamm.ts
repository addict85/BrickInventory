/** Die Stammdaten eines Sets gehören dem Katalog; andere Bereiche schreiben sie
 * nur hierüber, mit ihrem eigenen Zugang oder ihrer Transaktion. */
export {
  merkeSetKatalog,
  merkeKatalogPlatzhalter,
  katalogStand,
  setzeFigurenzahl,
  merkeKatalogCache,
} from './repository/setStamm';
