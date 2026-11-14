/** Die öffentliche Seite des Bereichs: Andere importieren nur von hier, der Schnitt darunter bleibt frei. */
export {
  DESIGNS,
  SECRET_KEYS,
  beiGlobalerAenderung,
  globalerWertGueltig,
  isMaskedValue,
  nutzerWertGueltig,
} from './settings';
export { meldeGlobaleAenderung, einstellungMitZugang } from './settings';
export { erzeugeEinstellungen } from './bereich';
export type { EinstellungenDienste, EinstellungenKontext } from './bereich';
