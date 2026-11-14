/** Was die Dienste des Bereichs bekommen: Zugang, Dienste tieferer Bereiche, Arbeitseinheit.
 * Getrennt von bereich.ts, damit ein Dienst seinen Typ ohne Importzyklus kennt. */
import type { Db } from '../../db/database';
import { bindeJeFunktion, bindeZugang, type Kontext } from '../infra/bereich';
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

/** Die Warteschlange gehört allen Konten; wer sie abarbeitet oder verwaltet, braucht den Systemrahmen.
 * Was eine Anfrage über ihren eigenen Auftrag liest, läuft unter Zeilenschutz und nach Konto gefiltert. */
const WARTESCHLANGE = 'Job-Prozess und Einstellen: Aufträge aller Konten und solche ohne Konto';
const VERWALTUNG = 'Verwaltung: Übersicht über die Aufträge aller Konten';

export const zugang = (db: Db) => ({
  auftraege: bindeJeFunktion(db, auftraege, 'auftragsschlange', {
    auftragsListe: VERWALTUNG,
    belegeAuftrag: WARTESCHLANGE,
    bricksetWartende: WARTESCHLANGE,
    bricksetWiedervorlage: WARTESCHLANGE,
    ergaenzePreisAuftrag: WARTESCHLANGE,
    fuegeAuftragEin: WARTESCHLANGE,
    gehoertNoch: WARTESCHLANGE,
    gibZurueck: WARTESCHLANGE,
    hoechsterBricksetVersuch: WARTESCHLANGE,
    kontoRolle: VERWALTUNG,
    laeuftArt: WARTESCHLANGE,
    laufendePausen: WARTESCHLANGE,
    lebenszeichen: WARTESCHLANGE,
    leereArt: WARTESCHLANGE,
    letzteJeArt: VERWALTUNG,
    liesPause: WARTESCHLANGE,
    loescheOffenen: WARTESCHLANGE,
    loeschePause: WARTESCHLANGE,
    macheFaellig: WARTESCHLANGE,
    merkeBricksetVor: WARTESCHLANGE,
    merkeExklusive: WARTESCHLANGE,
    pausiereArt: WARTESCHLANGE,
    raeumeErledigteAuf: WARTESCHLANGE,
    schreibeErgebnis: WARTESCHLANGE,
    schreibeFortschritt: WARTESCHLANGE,
    setzeAbgebrochen: WARTESCHLANGE,
    setzeErledigt: WARTESCHLANGE,
    setzeFaelligkeit: WARTESCHLANGE,
    setzeFehlgeschlagen: WARTESCHLANGE,
    setzeVerschoben: WARTESCHLANGE,
    statusZahlen: VERWALTUNG,
    stelleWiederEin: WARTESCHLANGE,
    zahlenJeArtUndStatus: VERWALTUNG,
    zieheBricksetTermineVor: WARTESCHLANGE,
    zieheTerminVor: WARTESCHLANGE,
  }),
  importStand: bindeZugang(db, importStand),
  laufzustand: bindeZugang(db, laufzustand),
  pdfAuftraege: bindeJeFunktion(db, pdfAuftraege, 'auftragsschlange', {
    loescheAltePdfAuftraege: 'Aufräumen über alle Konten',
  }),
});
export type AuftraegeKontext = Kontext<AuftraegeAbhaengigkeiten, ReturnType<typeof zugang>>;
