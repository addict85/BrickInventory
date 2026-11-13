/** Die Fabrik des Bereichs: Wer die Datenbank braucht, nimmt den Zugang als
 * ersten Parameter; erzeugeAuftraege bindet ihn einmal für alle. So greift kein
 * Modul selbst auf den Zugang des Prozesses zu, und ein Test gibt einen eigenen. */
import type { Db } from '../../db/database';
import { bindeImSystemrahmen, bindeZugang } from '../infra/bereich';
import { Faecher } from '../infra/zwischenspeicher';
import * as auftraege from './repository/auftraege';
import * as importStand from './repository/importStand';
import * as laufzustand from './repository/laufzustand';
import * as pdfAuftraege from './repository/pdfAuftraege';

export interface AuftraegeKontext {
  db: Db;
}

export function erzeugeAuftraege(k: AuftraegeKontext) {
  const { db } = k;
  return {
    db,
    faecher: new Faecher(),
    // Eine Warteschlange für alle Konten; eine Konto-Anfrage sieht per Zeilenschutz nur eigene.
    auftraege: bindeImSystemrahmen(db, auftraege, 'auftragsschlange', [
      'auftragsListe',
      'auftragsStand',
      'belegeAuftrag',
      'bricksetWartende',
      'bricksetWiedervorlage',
      'ergaenzePreisAuftrag',
      'fuegeAuftragEin',
      'gehoertNoch',
      'gibZurueck',
      'hoechsterBricksetVersuch',
      'kontoRolle',
      'laeuftArt',
      'laufendePausen',
      'lebenszeichen',
      'leereArt',
      'letzteJeArt',
      'liesPause',
      'loescheOffenen',
      'loeschePause',
      'macheFaellig',
      'merkeBricksetVor',
      'merkeExklusive',
      'pausiereArt',
      'raeumeErledigteAuf',
      'schreibeErgebnis',
      'schreibeFortschritt',
      'setzeAbgebrochen',
      'setzeErledigt',
      'setzeFaelligkeit',
      'setzeFehlgeschlagen',
      'setzeVerschoben',
      'statusZahlen',
      'stelleWiederEin',
      'zahlenJeArtUndStatus',
      'zieheBricksetTermineVor',
      'zieheTerminVor',
    ]),
    importStand: bindeZugang(db, importStand),
    laufzustand: bindeZugang(db, laufzustand),
    pdfAuftraege: bindeImSystemrahmen(db, pdfAuftraege, 'auftragsschlange'),
  };
}

export type AuftraegeDienste = ReturnType<typeof erzeugeAuftraege>;
