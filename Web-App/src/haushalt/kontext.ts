/** Was die Dienste bekommen; getrennt von bereich.ts, damit kein Importzyklus entsteht. */
import type { Db } from '../../db/database';
import { mit, type Kontext } from '../infra/bereich';
import type { EinstellungenDienste } from '../einstellungen';
import type { Faecher } from '../infra/zwischenspeicher';
import * as repository from './repository';

export interface HaushaltAbhaengigkeiten {
  db: Db;
  /** Das Gedächtnis der Haushalte je Zugang; erzeugeHaushalt legt es an. */
  faecher: Faecher;
  einstellungen: EinstellungenDienste;
}

export const zugang = (db: Db) => ({
  repository: {
    unterkonten: mit(db)(repository.unterkonten),
    elternkonten: mit(db)(repository.elternkonten),
    istVerknuepft: mit(db)(repository.istVerknuepft),
    kontoNamen: mit(db)(repository.kontoNamen),
    kontoName: mit(db)(repository.kontoName),
    raeumeEinladungenAuf: mit(db)(repository.raeumeEinladungenAuf),
    legeEinladungAn: mit(db)(repository.legeEinladungAn),
    belegeEinladung: mit(db)(repository.belegeEinladung),
    einladenderZuCode: mit(db)(repository.einladenderZuCode),
    gibEinladungFrei: mit(db)(repository.gibEinladungFrei),
    verknuepfe: mit(db)(repository.verknuepfe),
    trenne: mit(db)(repository.trenne),
    loescheGetrenntHinweis: mit(db)(repository.loescheGetrenntHinweis),
    offeneEinladungen: mit(db)(repository.offeneEinladungen),
    getrennteKetten: mit(db)(repository.getrennteKetten),
    besitzerDerErfassung: mit(db)(repository.besitzerDerErfassung),
    benutzerNamen: mit(db)(repository.benutzerNamen),
    sendeSignal: mit(db)(repository.sendeSignal),
  },
});
export type HaushaltKontext = Kontext<HaushaltAbhaengigkeiten, ReturnType<typeof zugang>>;
