/** Die Fabrik des Bereichs: Wer die Datenbank braucht, nimmt den Zugang als
 * ersten Parameter; erzeugeFinanzen bindet ihn einmal für alle. So greift kein
 * Modul selbst auf den Zugang des Prozesses zu, und ein Test gibt einen eigenen. */
import type { Db } from '../../db/database';
import { bindeZugang } from '../infra/bereich';
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

export interface FinanzenKontext {
  db: Db;
}

export function erzeugeFinanzen(k: FinanzenKontext) {
  const { db } = k;
  return {
    db,
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
  };
}

export type FinanzenDienste = ReturnType<typeof erzeugeFinanzen>;
