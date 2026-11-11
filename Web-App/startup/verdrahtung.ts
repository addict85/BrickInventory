/** Was untere Schichten von höheren brauchen, ohne sie zu importieren: Nacharbeit
 * nach dem Erfassen, das erste Konto einer leeren Datenbank und die Dienste der
 * Bereiche mit Fabrik. Jeder Prozess baut es beim Start und reicht es weiter
 * (server.ts, Skripte, Testhilfen). */
import { verdrahteNacharbeit, type Nacharbeit } from '../src/auftraege/nacharbeit';
import { dbKonfigAusUmgebung, erzeugeDb, setzeStandardDb, standardDb, type Db } from '../db/database';
import { erzeugeSets } from '../src/sets/bereich';
import { verdrahteSets } from '../src/sets/prozess';
import { erzeugeKatalog } from '../src/katalog/bereich';
import { verdrahteKatalog } from '../src/katalog/prozess';
import { erzeugeEinstellungen } from '../src/einstellungen/bereich';
import { verdrahteEinstellungen } from '../src/einstellungen/prozess';
import { erzeugeAuftraege } from '../src/auftraege/bereich';
import { verdrahteAuftraege } from '../src/auftraege/prozess';
import { erzeugeHaushalt } from '../src/haushalt/bereich';
import { verdrahteHaushalt } from '../src/haushalt/prozess';
import { erzeugeKonto } from '../src/konto/bereich';
import { verdrahteKonto } from '../src/konto/prozess';
import { erzeugeIdempotenz } from '../src/idempotenz/bereich';
import { verdrahteIdempotenz } from '../src/idempotenz/prozess';
import { erzeugeFinanzen } from '../src/finanzen/bereich';
import { verdrahteFinanzen } from '../src/finanzen/prozess';
import { erzeugeBestand } from '../src/bestand/bereich';
import { verdrahteBestand } from '../src/bestand/prozess';
import { erzeugeTeile } from '../src/teile/bereich';
import { verdrahteTeile } from '../src/teile/prozess';
import { erzeugeFiguren } from '../src/figuren/bereich';
import { verdrahteFiguren } from '../src/figuren/prozess';
import { erzeugeMerkliste } from '../src/merkliste/bereich';
import { verdrahteMerkliste } from '../src/merkliste/prozess';
import { erzeugeGutscheine } from '../src/gutscheine/bereich';
import { verdrahteGutscheine } from '../src/gutscheine/prozess';
import { erzeugeSammlung } from '../src/sammlung/bereich';
import { verdrahteSammlung } from '../src/sammlung/prozess';
import { erzeugeVerwaltung } from '../src/verwaltung/bereich';
import { verdrahteVerwaltung } from '../src/verwaltung/prozess';
import { ziehePlanVor } from '../src/auftraege/zeitplan';
import { refreshPriceForSet } from '../src/finanzen/preisLauf';
import { merkeGebraucht } from '../src/katalog/bilder/bildbedarf';
import { enrichSetParts, enrichSetMinifigs } from '../src/katalog/teileAnreicherung';
import { stelleAuftragEin } from '../src/auftraege/dienst';
import { mitVersion } from '../src/infra/setNummer';
import { legeStartVerwalterAn } from '../src/konto/startVerwalter';
import { meldeFehler } from '../src/infra/fehler';

export interface Verdrahtung {
  nacharbeit: Nacharbeit;
  erststart: () => Promise<void>;
}

export function baueVerdrahtung(): Verdrahtung {
  return {
    nacharbeit: {
      preisJobAnstossen: () => {
        ziehePlanVor('preise').catch((e: unknown) => meldeFehler('einstellungen:preis-job-anstossen', e));
      },
      preisFuerSetHolen: (sn, uid, zustand) => refreshPriceForSet(sn, uid, zustand),
      bildVormerken: (url, sn) => merkeGebraucht(url, sn),
      setTeileAnreichern: sn => enrichSetParts(sn),
      figurenAnreichern: sn => enrichSetMinifigs(sn),
      setBilderLaden: sn =>
        stelleAuftragEin(
          'bilder',
          { set_number: sn, nur_bilder: true },
          { schluessel: `bilder:${mitVersion(sn)}:nur`, maxVersuche: 3 },
        ),
    },
    erststart: legeStartVerwalterAn,
  };
}

/** Der Zugang zur Datenbank kommt vom Einstieg; ohne Angabe der des Prozesses. */
export function verdrahte(v: Verdrahtung = baueVerdrahtung(), db: Db = standardDb()): void {
  verdrahteNacharbeit(v.nacharbeit);
  verdrahteVerwaltung(() => erzeugeVerwaltung({ db }));
  verdrahteSammlung(() => erzeugeSammlung({ db }));
  verdrahteGutscheine(() => erzeugeGutscheine({ db }));
  verdrahteMerkliste(() => erzeugeMerkliste({ db }));
  verdrahteFiguren(() => erzeugeFiguren({ db }));
  verdrahteTeile(() => erzeugeTeile({ db }));
  verdrahteBestand(() => erzeugeBestand({ db }));
  verdrahteFinanzen(() => erzeugeFinanzen({ db }));
  verdrahteIdempotenz(() => erzeugeIdempotenz({ db }));
  verdrahteKonto(() => erzeugeKonto({ db }));
  verdrahteHaushalt(() => erzeugeHaushalt({ db }));
  verdrahteAuftraege(() => erzeugeAuftraege({ db }));
  verdrahteEinstellungen(() => erzeugeEinstellungen({ db }));
  verdrahteKatalog(() => erzeugeKatalog({ db }));
  verdrahteSets(() => erzeugeSets({ db, nacharbeit: v.nacharbeit }));
}

/** Der Zugang des Prozesses samt Erststart, als Standard gesetzt und verdrahtet. */
export function verdrahteProzess(v: Verdrahtung = baueVerdrahtung()): Db {
  const zugang = erzeugeDb(dbKonfigAusUmgebung(), { erststart: v.erststart });
  setzeStandardDb(zugang);
  verdrahte(v, zugang);
  return zugang;
}
