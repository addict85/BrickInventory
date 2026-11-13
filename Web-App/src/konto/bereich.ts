/** Die Fabrik des Bereichs: Wer die Datenbank braucht, nimmt den Zugang als
 * ersten Parameter; erzeugeKonto bindet ihn einmal für alle. So greift kein
 * Modul selbst auf den Zugang des Prozesses zu, und ein Test gibt einen eigenen. */
import type { Db } from '../../db/database';
import { bindeImSystemrahmen, bindeZugang } from '../infra/bereich';
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
  // Zugangsdaten sucht die Anmeldung, bevor es ein Konto gibt; sonst sieht sie niemand (0112).
  return {
    db,
    altgeheimnisse: bindeImSystemrahmen(db, altgeheimnisse, 'zugangsdaten'),
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
    geraeteSchluessel: bindeImSystemrahmen(db, geraeteSchluessel, 'zugangsdaten'),
    konten: bindeImSystemrahmen(db, konten, 'zugangsdaten'),
    passkeys: bindeImSystemrahmen(db, passkeys, 'zugangsdaten'),
    protokoll: bindeZugang(db, protokoll),
    qrKopplung: bindeImSystemrahmen(db, qrKopplung, 'zugangsdaten'),
    startVerwalter: bindeZugang(db, startVerwalter),
    zugaenge: bindeImSystemrahmen(db, zugaenge, 'zugangsdaten', [
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
    zweiterFaktor: bindeImSystemrahmen(db, zweiterFaktor, 'zugangsdaten', [
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
