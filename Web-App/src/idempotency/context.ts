/** What the services get; separate from area.ts so no import cycle forms. */
import type { Db } from '../../db/database';
import { mit, type Kontext } from '../infra/bereich';
import * as repository from './repository';
import type { Uhr } from '../infra/uhr';

export interface IdempotencyDependencies {
  uhr: Uhr;
  db: Db;
}

export const access = (db: Db) => ({
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
export type IdempotencyContext = Kontext<IdempotencyDependencies, ReturnType<typeof access>>;
