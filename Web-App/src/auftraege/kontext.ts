/** Was die Dienste des Bereichs bekommen: Zugang, Dienste tieferer Bereiche, Arbeitseinheit.
 * Getrennt von bereich.ts, damit ein Dienst seinen Typ ohne Importzyklus kennt. */
import type { Db } from '../../db/database';
import { bindeImSystemrahmen, bindeZugang, type Kontext } from '../infra/bereich';
import type { Faecher } from '../infra/zwischenspeicher';
import type { EinstellungenDienste } from '../einstellungen';
import * as auftraege from './repository/auftraege';
import * as importStand from './repository/importStand';
import * as laufzustand from './repository/laufzustand';
import * as pdfAuftraege from './repository/pdfAuftraege';

export interface AuftraegeAbhaengigkeiten {
  db: Db;
  faecher: Faecher;
  einstellungen: EinstellungenDienste;
}

export const zugang = (db: Db) => ({
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
});
export type AuftraegeKontext = Kontext<AuftraegeAbhaengigkeiten, ReturnType<typeof zugang>>;
