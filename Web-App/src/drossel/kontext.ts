/** Was die Dienste bekommen; getrennt von bereich.ts, damit kein Importzyklus entsteht. */
import type { Db } from '../../db/database';
import { mit, type Kontext } from '../infra/bereich';
import type { Uhr } from '../infra/uhr';
import * as repository from './repository';

export interface DrosselAbhaengigkeiten {
  db: Db;
  /** Die Zeit des Rückfalls im Speicher. */
  uhr: Uhr;
}

export const zugang = (db: Db) => ({
  zaehler: {
    lies: mit(db)(repository.lies),
    erhoehe: mit(db)(repository.erhoehe),
    sperre: mit(db)(repository.sperre),
    belegeLaufplatz: mit(db)(repository.belegeLaufplatz),
    gibLaufplatzFrei: mit(db)(repository.gibLaufplatzFrei),
    loescheZaehler: mit(db)(repository.loescheZaehler),
    loescheZaehlerMitPraefix: mit(db)(repository.loescheZaehlerMitPraefix),
    raeumeAuf: mit(db)(repository.raeumeAuf),
    zaehleHoch: mit(db)(repository.zaehleHoch),
    stundenStand: mit(db)(repository.stundenStand),
    zaehleStunde: mit(db)(repository.zaehleStunde),
    einmalJeTag: mit(db)(repository.einmalJeTag),
  },
});
export type DrosselKontext = Kontext<DrosselAbhaengigkeiten, ReturnType<typeof zugang>>;
