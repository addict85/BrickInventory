/** Was die Dienste des Bereichs bekommen: Zugang, Dienste tieferer Bereiche, Arbeitseinheit.
 * Getrennt von bereich.ts, damit ein Dienst seinen Typ ohne Importzyklus kennt. */
import type { Db } from '../../db/database';
import { bindeZugang, type Kontext } from '../infra/bereich';
import type { Faecher } from '../infra/zwischenspeicher';
import * as bewertung from './repository/bewertung';
import * as erfassungen from './repository/erfassungen';
import * as gewinnVerlust from './repository/gewinnVerlust';
import * as marktpreise from './repository/marktpreise';
import * as portfolioKurve from './repository/portfolioKurve';
import * as preisalarm from './preisalarm';
import * as preisalarme from './repository/preisalarme';
import * as preisCache from './repository/preisCache';
import * as preisLauf from './repository/preisLauf';
import * as preisverlauf from './repository/preisverlauf';
import * as setWert from './repository/setWert';
import * as wechselkurse from './repository/wechselkurse';
import type { EinstellungenDienste } from '../einstellungen';
import type { HaushaltDienste } from '../haushalt';
import type { KatalogDienste } from '../katalog';
import type { AuftraegeDienste, Nacharbeit } from '../auftraege';

export interface FinanzenAbhaengigkeiten {
  db: Db;
  einstellungen: EinstellungenDienste;
  auftraege: AuftraegeDienste;
  haushalt: HaushaltDienste;
  katalog: KatalogDienste;
  nacharbeit: Nacharbeit;
  faecher: Faecher;
}

export const zugang = (db: Db) => ({
  bewertung: bindeZugang(db, bewertung),
  erfassungen: bindeZugang(db, erfassungen),
  gewinnVerlust: bindeZugang(db, gewinnVerlust),
  marktpreise: bindeZugang(db, marktpreise),
  portfolioKurve: bindeZugang(db, portfolioKurve),
  preisalarm: bindeZugang(db, preisalarm, [
    'alarmUebertragen',
    'alarmeAusCsv',
    'alarmeFuer',
    'alleAlarme',
    'ausgeloesteSeit',
    'buildPreisalarmeCsv',
    'loescheAlarm',
    'pruefeSet',
    'setzeAlarm',
  ]),
  preisalarme: bindeZugang(db, preisalarme),
  preisCache: bindeZugang(db, preisCache),
  preisLauf: bindeZugang(db, preisLauf),
  preisverlauf: bindeZugang(db, preisverlauf),
  setWert: bindeZugang(db, setWert),
  wechselkurse: bindeZugang(db, wechselkurse),
});
export type FinanzenKontext = Kontext<FinanzenAbhaengigkeiten, ReturnType<typeof zugang>>;
