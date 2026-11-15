/** Was die Dienste bekommen; getrennt von bereich.ts, damit kein Importzyklus entsteht. */
import type { Db } from '../../db/database';
import { mit, mitVertrag, type Kontext } from '../infra/bereich';
import type { BestandLesevertrag } from './lesevertrag';
import * as bestandExport from './repository/bestandExport';
import * as gemeinsam from './repository/gemeinsam';
import * as kaufErfassungen from './repository/kaufErfassungen';
import * as kennzahlen from './repository/kennzahlen';
import * as lagerort from './repository/lagerort';
import * as manuelleMengen from './repository/manuelleMengen';
import * as nachtrag from './repository/nachtrag';
import * as papierkorb from './repository/papierkorb';
import type { EinstellungenDienste } from '../einstellungen';
import type { HaushaltDienste } from '../haushalt';
import type { KontoDienste } from '../konto';
import type { KatalogDienste } from '../katalog';
import type { FinanzenDienste } from '../finanzen';
import type { Uhr } from '../infra/uhr';

export interface BestandAbhaengigkeiten {
  uhr: Uhr;
  db: Db;
  einstellungen: EinstellungenDienste;
  haushalt: HaushaltDienste;
  konto: KontoDienste;
  katalog: KatalogDienste;
  finanzen: FinanzenDienste;
  lesevertrag: BestandLesevertrag;
}

export const zugang = (db: Db, l: BestandLesevertrag) => ({
  bestandExport: {
    teileFuerCsv: mitVertrag(db, l)(bestandExport.teileFuerCsv),
    figurenFuerCsv: mitVertrag(db, l)(bestandExport.figurenFuerCsv),
  },
  gemeinsam: {
    erfassungsKennzahlen: mitVertrag(db, l)(gemeinsam.erfassungsKennzahlen),
    setsMitBestandteil: mitVertrag(db, l)(gemeinsam.setsMitBestandteil),
  },
  kaufErfassungen: {
    inWaehrungDesKontos: mit(db)(kaufErfassungen.inWaehrungDesKontos),
  },
  kennzahlen: {
    setZahlen: mitVertrag(db, l)(kennzahlen.setZahlen),
    anleitungsZahlen: mitVertrag(db, l)(kennzahlen.anleitungsZahlen),
    teileImBestand: mitVertrag(db, l)(kennzahlen.teileImBestand),
    teileEinzeln: mitVertrag(db, l)(kennzahlen.teileEinzeln),
    figurenImBestand: mitVertrag(db, l)(kennzahlen.figurenImBestand),
  },
  lagerort: {
    andererOrtGleichenNamens: mit(db)(lagerort.andererOrtGleichenNamens),
    entferneOrt: mit(db)(lagerort.entferneOrt),
    fuegeOrtEin: mit(db)(lagerort.fuegeOrtEin),
    ortBelegung: mitVertrag(db, l)(lagerort.ortBelegung),
    ortDesKontos: mit(db)(lagerort.ortDesKontos),
    ortNachName: mit(db)(lagerort.ortNachName),
    ortName: mit(db)(lagerort.ortName),
    orteDerKonten: mit(db)(lagerort.orteDerKonten),
    orteMitBestand: mitVertrag(db, l)(lagerort.orteMitBestand),
    schreibeOrtNamen: mit(db)(lagerort.schreibeOrtNamen),
  },
  manuelleMengen: {
    summeDerErfassungen: mit(db)(manuelleMengen.summeDerErfassungen),
  },
  nachtrag: {
    setErfassungenOhnePreis: mitVertrag(db, l)(nachtrag.setErfassungenOhnePreis),
    teilErfassungenOhnePreis: mitVertrag(db, l)(nachtrag.teilErfassungenOhnePreis),
    figurErfassungenOhnePreis: mitVertrag(db, l)(nachtrag.figurErfassungenOhnePreis),
  },
  papierkorb: {
    eintraege: mit(db)(papierkorb.eintraege),
    entferneAeltere: mit(db)(papierkorb.entferneAeltere),
    entferneAlle: mit(db)(papierkorb.entferneAlle),
    entferneEintragDesKontos: mit(db)(papierkorb.entferneEintragDesKontos),
  },
});
export type BestandKontext = Kontext<BestandAbhaengigkeiten, ReturnType<typeof zugang>>;
