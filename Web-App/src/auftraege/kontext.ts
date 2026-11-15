/** Was die Dienste bekommen; getrennt von bereich.ts, damit kein Importzyklus entsteht. */
import type { Db } from '../../db/database';
import { imSystem, mit, type Kontext } from '../infra/bereich';
import type { Faecher } from '../infra/zwischenspeicher';
import type { EinstellungenDienste } from '../einstellungen';
import * as auftraege from './repository/auftraege';
import * as importStand from './repository/importStand';
import * as laufzustand from './repository/laufzustand';
import type { Uhr } from '../infra/uhr';
import type { Arten } from './arten';

export interface AuftraegeAbhaengigkeiten {
  uhr: Uhr;
  db: Db;
  faecher: Faecher;
  einstellungen: EinstellungenDienste;
  /** Die angemeldeten Arten; geteilt über alle Sätze dieses Zugangs. */
  arten: Arten;
}

/** Die Warteschlange gehört allen Konten; wer sie abarbeitet oder verwaltet, braucht den Systemrahmen.
 * Was eine Anfrage über ihren eigenen Auftrag liest, läuft unter Zeilenschutz und nach Konto gefiltert. */
const WARTESCHLANGE = 'Job-Prozess und Einstellen: Aufträge aller Konten und solche ohne Konto';
const VERWALTUNG = 'Verwaltung: Übersicht über die Aufträge aller Konten';

export const zugang = (db: Db) => ({
  auftraege: {
    fuegeAuftragEin: imSystem(db, WARTESCHLANGE, auftraege.fuegeAuftragEin),
    fuegeEigenenAuftragEin: mit(db)(auftraege.fuegeEigenenAuftragEin),
    ergaenzeListenAuftrag: imSystem(db, WARTESCHLANGE, auftraege.ergaenzeListenAuftrag),
    belegeAuftrag: imSystem(db, WARTESCHLANGE, auftraege.belegeAuftrag),
    merkeExklusive: imSystem(db, WARTESCHLANGE, auftraege.merkeExklusive),
    lebenszeichen: imSystem(db, WARTESCHLANGE, auftraege.lebenszeichen),
    gehoertNoch: imSystem(db, WARTESCHLANGE, auftraege.gehoertNoch),
    schreibeFortschritt: imSystem(db, WARTESCHLANGE, auftraege.schreibeFortschritt),
    setzeErledigt: imSystem(db, WARTESCHLANGE, auftraege.setzeErledigt),
    setzeFehlgeschlagen: imSystem(db, WARTESCHLANGE, auftraege.setzeFehlgeschlagen),
    setzeVerschoben: imSystem(db, WARTESCHLANGE, auftraege.setzeVerschoben),
    gibZurueck: imSystem(db, WARTESCHLANGE, auftraege.gibZurueck),
    raeumeErledigteAuf: imSystem(db, WARTESCHLANGE, auftraege.raeumeErledigteAuf),
    liesPause: imSystem(db, WARTESCHLANGE, auftraege.liesPause),
    pausiereArt: imSystem(db, WARTESCHLANGE, auftraege.pausiereArt),
    loeschePause: imSystem(db, WARTESCHLANGE, auftraege.loeschePause),
    setzeAbgebrochen: imSystem(db, WARTESCHLANGE, auftraege.setzeAbgebrochen),
    stelleWiederEin: imSystem(db, WARTESCHLANGE, auftraege.stelleWiederEin),
    leereArt: imSystem(db, WARTESCHLANGE, auftraege.leereArt),
    macheFaellig: imSystem(db, WARTESCHLANGE, auftraege.macheFaellig),
    statusZahlen: imSystem(db, VERWALTUNG, auftraege.statusZahlen),
    kontoRolle: imSystem(db, VERWALTUNG, auftraege.kontoRolle),
    setzeFaelligkeit: imSystem(db, WARTESCHLANGE, auftraege.setzeFaelligkeit),
    zieheTerminVor: imSystem(db, WARTESCHLANGE, auftraege.zieheTerminVor),
    laeuftArt: imSystem(db, WARTESCHLANGE, auftraege.laeuftArt),
    hoechsterZaehler: imSystem(db, WARTESCHLANGE, auftraege.hoechsterZaehler),
    merkeVor: imSystem(db, WARTESCHLANGE, auftraege.merkeVor),
    loescheOffenen: imSystem(db, WARTESCHLANGE, auftraege.loescheOffenen),
    wartendeDerArt: imSystem(db, WARTESCHLANGE, auftraege.wartendeDerArt),
    zahlenDerArt: imSystem(db, WARTESCHLANGE, auftraege.zahlenDerArt),
    auftragsListe: imSystem(db, VERWALTUNG, auftraege.auftragsListe),
    letzteJeArt: imSystem(db, VERWALTUNG, auftraege.letzteJeArt),
    zahlenJeArtUndStatus: imSystem(db, VERWALTUNG, auftraege.zahlenJeArtUndStatus),
    laufendePausen: imSystem(db, WARTESCHLANGE, auftraege.laufendePausen),
    auftragsStand: mit(db)(auftraege.auftragsStand),
    zieheTermineVor: imSystem(db, WARTESCHLANGE, auftraege.zieheTermineVor),
    schreibeErgebnis: imSystem(db, WARTESCHLANGE, auftraege.schreibeErgebnis),
  },
  importStand: {
    markiereVerwaist: mit(db)(importStand.markiereVerwaist),
    importStand: mit(db)(importStand.importStand),
    schreibeImportStand: mit(db)(importStand.schreibeImportStand),
    aendereImportStand: mit(db)(importStand.aendereImportStand),
    setzeLaufFort: mit(db)(importStand.setzeLaufFort),
  },
  laufzustand: {
    liesZustand: mit(db)(laufzustand.liesZustand),
    setzeZustand: mit(db)(laufzustand.setzeZustand),
    loescheZustand: mit(db)(laufzustand.loescheZustand),
    zaehleZustand: mit(db)(laufzustand.zaehleZustand),
  },
  eigene: {
    eigenerAuftrag: mit(db)(auftraege.eigenerAuftrag),
    zaehleLaufende: mit(db)(auftraege.zaehleLaufende),
    loescheEigenen: mit(db)(auftraege.loescheEigenen),
    loescheBeendete: imSystem(db, 'Aufräumen über alle Konten', auftraege.loescheBeendete),
  },
});
export type AuftraegeKontext = Kontext<AuftraegeAbhaengigkeiten, ReturnType<typeof zugang>>;
