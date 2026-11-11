/** Die Fabrik des Bereichs: Wer die Datenbank braucht, nimmt den Zugang als
 * ersten Parameter; erzeugeKonto bindet ihn einmal für alle. So greift kein
 * Modul selbst auf den Zugang des Prozesses zu, und ein Test gibt einen eigenen. */
import type { Db } from '../../db/database';
import { bindeZugang } from '../infra/bereich';
import * as altgeheimnisse from './repository/altgeheimnisse';
import * as anmeldezaehler from './repository/anmeldezaehler';
import * as einrichtung from './repository/einrichtung';
import * as geraeteSchluessel from './repository/geraeteSchluessel';
import * as konten from './repository/konten';
import * as passkeys from './repository/passkeys';
import * as protokoll from './repository/protokoll';
import * as qrKopplung from './repository/qrKopplung';
import * as startVerwalter from './repository/startVerwalter';
import * as zugaenge from './repository/zugaenge';
import * as zweiterFaktor from './repository/zweiterFaktor';

export interface KontoKontext {
  db: Db;
}

export function erzeugeKonto(k: KontoKontext) {
  const { db } = k;
  return {
    db,
    altgeheimnisse: bindeZugang(db, altgeheimnisse),
    anmeldezaehler: bindeZugang(db, anmeldezaehler, [
      'erhoehe',
      'gibLaufplatzFrei',
      'kontoZumNamen',
      'lies',
      'loescheZaehler',
      'loescheZaehlerMitPraefix',
      'raeumeAuf',
      'zaehleHoch',
    ]),
    einrichtung: bindeZugang(db, einrichtung),
    geraeteSchluessel: bindeZugang(db, geraeteSchluessel),
    konten: bindeZugang(db, konten),
    passkeys: bindeZugang(db, passkeys),
    protokoll: bindeZugang(db, protokoll),
    qrKopplung: bindeZugang(db, qrKopplung),
    startVerwalter: bindeZugang(db, startVerwalter),
    zugaenge: bindeZugang(db, zugaenge, [
      'beendeUeberlappung',
      'beruehreToken',
      'gueltigerToken',
      'kappeSitzungen',
      'kappeTokens',
      'kontoZurAnmeldung',
      'legeTokenAn',
      'loescheAbgelaufene',
      'loescheSitzungenDesKontos',
      'loescheToken',
      'loescheTokensDesKontos',
      'loescheUngenutzte',
      'loescheVerwaisteVerbrauchte',
      'passwortHash',
      'sitzungsVersion',
      'sperreFamilie',
      'zaehleSitzungsVersionHoch',
      'ziehAltzeilenNach',
    ]),
    zweiterFaktor: bindeZugang(db, zweiterFaktor, [
      'aktiv',
      'aktivesGeheimnis',
      'entferne',
      'faktorStand',
      'legeGeheimnisAn',
      'verbraucheCode',
      'verbraucheSchritt',
    ]),
  };
}

export type KontoDienste = ReturnType<typeof erzeugeKonto>;
