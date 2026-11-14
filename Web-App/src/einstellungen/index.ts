/** Die öffentliche Seite des Bereichs: Andere Bereiche importieren nur von hier,
 * damit die Aufteilung der Dateien darunter frei bleibt. */
export {
  DESIGNS,
  SECRET_KEYS,
  globalerWertGueltig,
  isMaskedValue,
  nutzerWertGueltig,
} from './settings';
export { einstellungMitZugang } from './settings';
export { erzeugeEinstellungen } from './bereich';
export type { EinstellungenDienste, EinstellungenKontext } from './bereich';
