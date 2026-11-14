/** Was die Dienste bekommen; getrennt von bereich.ts, damit kein Importzyklus entsteht. */
import type { Db } from '../../db/database';
import { mit, type Kontext } from '../infra/bereich';
import * as repository from './repository';

export interface IdempotenzAbhaengigkeiten {
  db: Db;
}

export const zugang = (db: Db) => ({
  repository: {
    belege: mit(db)(repository.belege),
    eintrag: mit(db)(repository.eintrag),
    mitWirkungsVermerk: mit(db)(repository.mitWirkungsVermerk),
    schliesseAb: mit(db)(repository.schliesseAb),
    loescheLaufenden: mit(db)(repository.loescheLaufenden),
    loescheAndereAbdruecke: mit(db)(repository.loescheAndereAbdruecke),
    loescheAelterAls: mit(db)(repository.loescheAelterAls),
    alteAntworten: mit(db)(repository.alteAntworten),
    ersetzeAntwort: mit(db)(repository.ersetzeAntwort),
  },
});
export type IdempotenzKontext = Kontext<IdempotenzAbhaengigkeiten, ReturnType<typeof zugang>>;
