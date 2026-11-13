/** Die öffentliche Seite des Bereichs: Andere Bereiche importieren nur von hier,
 * damit die Aufteilung der Dateien darunter frei bleibt. */
import { dienstePerAufruf } from '../infra/bereich';
import { haushaltBereich } from './prozess';

export {
  umzugsQuelle,
  asIds,
  beiHaushaltsaenderung,
  blickfeldAus,
  haushaltsStand,
  meldeHaushaltsaenderung,
  schreibzielOderNull,
  schreibbereichAus,
  schreibziel,
  blickfeldIds,
  besitzerAnhaengen,
  schreibbereich,
} from './haushalt';
export type { Blickfeld, BlickfeldEingabe, Schreiber, Sicht } from './haushalt';
export {
  HAUSHALT_KANAL,
  einladungAnlegen,
  haushaltsMitglieder,
  leereHaushaltCache,
  pruefeEinladung,
  einladungEinloesen,
  siehtKonto,
  kontenTrennen,
  verwerfeGetrennt,
} from './haushalt';
export { erzeugeHaushalt } from './bereich';
export type { HaushaltDienste, HaushaltKontext } from './bereich';
export { haushaltBereich, verdrahteHaushalt } from './prozess';

/** Für Routen: die Dienste des Prozesses ohne Zugang als ersten Parameter. */
export const haushalt = dienstePerAufruf(
  () => haushaltBereich().haushalt,
  [
    'einladungAnlegen',
    'einladungEinloesen',
    'haushaltsMitglieder',
    'haushaltsStand',
    'kontenTrennen',
    'pruefeEinladung',
    'schreibziel',
    'siehtKonto',
    'verwerfeGetrennt',
  ],
);
