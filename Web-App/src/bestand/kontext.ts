/** Was die Dienste bekommen; getrennt von bereich.ts, damit kein Importzyklus entsteht. */
import type { Db } from '../../db/database';
import { mit, type Kontext } from '../infra/bereich';
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

export interface BestandAbhaengigkeiten {
  db: Db;
  einstellungen: EinstellungenDienste;
  haushalt: HaushaltDienste;
  konto: KontoDienste;
  katalog: KatalogDienste;
  finanzen: FinanzenDienste;
}

export const zugang = (db: Db) => ({
  bestandExport: {
    teileFuerCsv: mit(db)(bestandExport.teileFuerCsv),
    figurenFuerCsv: mit(db)(bestandExport.figurenFuerCsv),
  },
  gemeinsam: {
    erfassungsKennzahlen: mit(db)(gemeinsam.erfassungsKennzahlen),
    setsMitBestandteil: mit(db)(gemeinsam.setsMitBestandteil),
  },
  kaufErfassungen: {
    inWaehrungDesKontos: mit(db)(kaufErfassungen.inWaehrungDesKontos),
  },
  kennzahlen: {
    setZahlen: mit(db)(kennzahlen.setZahlen),
    anleitungsZahlen: mit(db)(kennzahlen.anleitungsZahlen),
    teileImBestand: mit(db)(kennzahlen.teileImBestand),
    teileEinzeln: mit(db)(kennzahlen.teileEinzeln),
    figurenImBestand: mit(db)(kennzahlen.figurenImBestand),
    waehrungImBlickfeld: mit(db)(kennzahlen.waehrungImBlickfeld),
    vorgabeZustandImBlickfeld: mit(db)(kennzahlen.vorgabeZustandImBlickfeld),
  },
  lagerort: {
    andererOrtGleichenNamens: mit(db)(lagerort.andererOrtGleichenNamens),
    entferneOrt: mit(db)(lagerort.entferneOrt),
    fuegeOrtEin: mit(db)(lagerort.fuegeOrtEin),
    ortBelegung: mit(db)(lagerort.ortBelegung),
    ortDesKontos: mit(db)(lagerort.ortDesKontos),
    ortNachName: mit(db)(lagerort.ortNachName),
    ortName: mit(db)(lagerort.ortName),
    orteDerKonten: mit(db)(lagerort.orteDerKonten),
    orteMitBestand: mit(db)(lagerort.orteMitBestand),
    schreibeOrtNamen: mit(db)(lagerort.schreibeOrtNamen),
    vorgabeOrt: mit(db)(lagerort.vorgabeOrt),
  },
  manuelleMengen: {
    summeDerErfassungen: mit(db)(manuelleMengen.summeDerErfassungen),
  },
  nachtrag: {
    setErfassungenOhnePreis: mit(db)(nachtrag.setErfassungenOhnePreis),
    teilErfassungenOhnePreis: mit(db)(nachtrag.teilErfassungenOhnePreis),
    figurErfassungenOhnePreis: mit(db)(nachtrag.figurErfassungenOhnePreis),
  },
  papierkorb: {
    eintraege: mit(db)(papierkorb.eintraege),
    entferneAeltere: mit(db)(papierkorb.entferneAeltere),
    entferneAlle: mit(db)(papierkorb.entferneAlle),
    entferneEintragDesKontos: mit(db)(papierkorb.entferneEintragDesKontos),
  },
});
export type BestandKontext = Kontext<BestandAbhaengigkeiten, ReturnType<typeof zugang>>;
