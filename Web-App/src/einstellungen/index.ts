/** Die öffentliche Seite des Bereichs: Andere importieren nur von hier, der Schnitt darunter bleibt frei. */
export {
  DESIGNS,
  SECRET_KEYS,
  globalerWertGueltig,
  istMaskiert,
  nutzerWertGueltig,
} from './settings';
export { erzeugeEinstellungen } from './bereich';
export type { EinstellungenDienste, EinstellungenKontext } from './bereich';
