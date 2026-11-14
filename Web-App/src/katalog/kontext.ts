/** Was die Dienste des Bereichs bekommen: Zugang, Dienste tieferer Bereiche, Arbeitseinheit.
 * Getrennt von bereich.ts, damit ein Dienst seinen Typ ohne Importzyklus kennt. */
import { bindeZugang, type Kontext } from '../infra/bereich';
import type { Faecher } from '../infra/zwischenspeicher';
import type { Db } from '../../db/database';
import type { ConcurrentRateLimiter, FremdquellenDienste } from '../fremdquellen';
import type { AuftraegeDienste, Nacharbeit } from '../auftraege';
import type { EinstellungenDienste } from '../einstellungen';
import type { HaushaltDienste } from '../haushalt';
import type { BilderDienste } from '../bilder';
import * as anleitungen from './repository/anleitungen';
import * as blZuordnung from './repository/blZuordnung';
import * as csvKatalog from './repository/csvKatalog';
import * as katalogCache from './repository/katalogCache';
import * as katalogStamm from './repository/katalogStamm';
import * as katalogSuche from './repository/katalogSuche';
import * as rebrickableCache from './repository/rebrickableCache';
import * as setInhalt from './repository/setInhalt';
import * as teileAnreicherung from './repository/teileAnreicherung';

export interface KatalogAbhaengigkeiten {
  db: Db;
  faecher: Faecher;
  /** Klienten, Kontingent und Drosseln dieses Satzes Dienste (src/fremdquellen). */
  fremdquellen: FremdquellenDienste;
  /** Höchstens zwei Bildabrufe beim CDN zugleich, je Satz Dienste einer. */
  cdnDrossel: ConcurrentRateLimiter;
  /** Bilder dieses Satzes Dienste (src/bilder). */
  bilder: BilderDienste;
  einstellungen: EinstellungenDienste;
  auftraege: AuftraegeDienste;
  haushalt: HaushaltDienste;
  nacharbeit: Nacharbeit;
}

export const zugang = (db: Db) => ({
  anleitungen: bindeZugang(db, anleitungen),
  blZuordnung: bindeZugang(db, blZuordnung),
  csvKatalog: bindeZugang(db, csvKatalog),
  katalogCache: bindeZugang(db, katalogCache),
  katalogStamm: bindeZugang(db, katalogStamm),
  katalogSuche: bindeZugang(db, katalogSuche),
  rebrickableCache: bindeZugang(db, rebrickableCache),
  setInhalt: bindeZugang(db, setInhalt),
  teileAnreicherung: bindeZugang(db, teileAnreicherung),
});
export type KatalogKontext = Kontext<KatalogAbhaengigkeiten, ReturnType<typeof zugang>>;
