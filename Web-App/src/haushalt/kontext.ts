/** Was die Dienste bekommen; getrennt von bereich.ts, damit kein Importzyklus entsteht. */
import type { Db } from '../../db/database';
import { imSystem, mit, mitVertrag, type Kontext } from '../infra/bereich';
import type { HaushaltLesevertrag } from './lesevertrag';
import type { EinstellungenDienste } from '../einstellungen';
import type { Faecher } from '../infra/zwischenspeicher';
import * as repository from './repository';
import type { Uhr } from '../infra/uhr';

export interface HaushaltAbhaengigkeiten {
  uhr: Uhr;
  db: Db;
  /** Das Gedächtnis der Haushalte je Zugang; erzeugeHaushalt legt es an. */
  faecher: Faecher;
  einstellungen: EinstellungenDienste;
  lesevertrag: HaushaltLesevertrag;
}

// Einladungen sieht nur ihr Konto (0115); wer einlöst, gehört nicht dazu, Aufräumen gilt allen.
const FREMDE_EINLADUNG = 'Einlösen: Die Einladung gehört dem einladenden Konto';
export const zugang = (db: Db, l: HaushaltLesevertrag) => ({
  repository: {
    unterkonten: mit(db)(repository.unterkonten),
    elternkonten: mit(db)(repository.elternkonten),
    istVerknuepft: mit(db)(repository.istVerknuepft),
    kontoNamen: mitVertrag(db, l)(repository.kontoNamen),
    kontoName: mitVertrag(db, l)(repository.kontoName),
    raeumeEinladungenAuf: imSystem(db, 'Abgelaufene Einladungen aller Konten', repository.raeumeEinladungenAuf),
    legeEinladungAn: mit(db)(repository.legeEinladungAn),
    belegeEinladung: imSystem(db, FREMDE_EINLADUNG, repository.belegeEinladung),
    einladenderZuCode: imSystem(db, FREMDE_EINLADUNG, repository.einladenderZuCode),
    gibEinladungFrei: imSystem(db, FREMDE_EINLADUNG, repository.gibEinladungFrei),
    verknuepfe: mit(db)(repository.verknuepfe),
    trenne: mit(db)(repository.trenne),
    loeseUnterkontoUndEinladungen: mit(db)(repository.loeseUnterkontoUndEinladungen),
    loescheGetrenntHinweis: mit(db)(repository.loescheGetrenntHinweis),
    offeneEinladungen: mit(db)(repository.offeneEinladungen),
    getrennteKetten: mitVertrag(db, l)(repository.getrennteKetten),
    besitzerDerErfassung: mitVertrag(db, l)(repository.besitzerDerErfassung),
    benutzerNamen: mitVertrag(db, l)(repository.benutzerNamen),
  },
});
export type HaushaltKontext = Kontext<HaushaltAbhaengigkeiten, ReturnType<typeof zugang>>;
