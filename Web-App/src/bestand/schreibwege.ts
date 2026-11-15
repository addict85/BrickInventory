/** Die Schreibwege der Bereiche darüber auf Sets, Käufe und Erfassungen: Die Zeilen gehören dem
 * Bestand (docs/architektur.md), Sets, Teile, Figuren und Sammlung rufen sie in ihrer Transaktion
 * über t.bestand. */
import { mit } from '../infra/bereich';
import * as erfassungenRepo from './repository/erfassungen';
import * as manuelleKaeufe from './repository/manuelleKaeufe';
import * as setZeilen from './repository/setZeilen';
import type { BestandKontext } from './kontext';

export const schreibwege = (k: BestandKontext) => ({
  setZeilen: {
    loescheErfassungNachId: mit(k.db, setZeilen.loescheSetErfassungNachId),
    kuerzeErfassung: mit(k.db, setZeilen.kuerzeSetErfassung),
    legeZeileAn: mit(k.db, setZeilen.legeSetZeileAn),
    legeAn: mit(k.db, setZeilen.legeSetAn),
    schreibeInNeuesteErfassung: mit(k.db, setZeilen.schreibeInNeuesteSetErfassung),
    uebernimmZeile: mit(k.db, setZeilen.uebernimmSetZeile),
    entferneZeilen: mit(k.db, setZeilen.entferneSetZeilen),
    loescheErfassung: mit(k.db, setZeilen.loescheSetErfassung),
    entferneVerschobenes: mit(k.db, setZeilen.entferneVerschobenesSet),
    hatInhalt: mit(k.db, setZeilen.hatSetInhalt),
  },
  kaeufe: {
    setzeTeilpreisNeueste: mit(k.db, manuelleKaeufe.setzeTeilpreisNeueste),
    setzeTeilzustandNeueste: mit(k.db, manuelleKaeufe.setzeTeilzustandNeueste),
    loescheTeilErfassungen: mit(k.db, manuelleKaeufe.loescheTeilErfassungen),
    setzeFigurpreisNeueste: mit(k.db, manuelleKaeufe.setzeFigurpreisNeueste),
    setzeFigurzustandNeueste: mit(k.db, manuelleKaeufe.setzeFigurzustandNeueste),
    loescheFigurErfassungen: mit(k.db, manuelleKaeufe.loescheFigurErfassungen),
    stockeGleicheAuf: mit(k.db, manuelleKaeufe.stockeGleicheErfassungenAuf),
    loescheAufgestockte: mit(k.db, manuelleKaeufe.loescheAufgestockteErfassungen),
    faerbeUm: mit(k.db, manuelleKaeufe.faerbeErfassungenUm),
  },
  erfassung: {
    konto: mit(k.db, erfassungenRepo.kontoDerErfassung),
    zustand: mit(k.db, erfassungenRepo.zustandDerErfassung),
    imSchreibfeld: mit(k.db, erfassungenRepo.erfassungImSchreibfeld),
    setzeMenge: mit(k.db, erfassungenRepo.setzeErfassungsMenge),
    setzePreis: mit(k.db, erfassungenRepo.setzeErfassungsPreis),
    setzeZustand: mit(k.db, erfassungenRepo.setzeErfassungsZustand),
    setzeDatum: mit(k.db, erfassungenRepo.setzeErfassungsDatum),
    loesche: mit(k.db, erfassungenRepo.loescheErfassung),
    setErfassungenImBlickfeld: mit(k.db, erfassungenRepo.setErfassungenImBlickfeld),
  },
});
