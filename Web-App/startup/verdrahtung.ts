/** Was untere Schichten von höheren brauchen, ohne sie zu importieren: Nacharbeit
 * nach dem Erfassen und das erste Konto einer leeren Datenbank. Jeder Prozess
 * baut es beim Start und reicht es weiter (server.ts, Skripte, Testhilfen). */
import { verdrahteNacharbeit, type Nacharbeit } from '../src/auftraege/nacharbeit';
import { setzeErststart } from '../db/database';
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

export function verdrahte(v: Verdrahtung = baueVerdrahtung()): void {
  verdrahteNacharbeit(v.nacharbeit);
  setzeErststart(v.erststart);
}
