/** Was die Dienste bekommen; getrennt von bereich.ts, damit kein Importzyklus entsteht. */
import type { Db } from '../../db/database';
import { mit, type Kontext } from '../infra/bereich';
import * as repository from './repository';

export interface EinstellungenAbhaengigkeiten {
  db: Db;
}

export const zugang = (db: Db) => ({
  repository: {
    nutzerWert: mit(db)(repository.nutzerWert),
    globalerWert: mit(db)(repository.globalerWert),
    schreibeNutzerWert: mit(db)(repository.schreibeNutzerWert),
    loescheNutzerWert: mit(db)(repository.loescheNutzerWert),
    nutzerWerte: mit(db)(repository.nutzerWerte),
    schreibeGlobalenWert: mit(db)(repository.schreibeGlobalenWert),
    loescheGlobaleWerte: mit(db)(repository.loescheGlobaleWerte),
    globaleWerte: mit(db)(repository.globaleWerte),
    ersetzeGlobalenWert: mit(db)(repository.ersetzeGlobalenWert),
  },
});
export type EinstellungenKontext = Kontext<EinstellungenAbhaengigkeiten, ReturnType<typeof zugang>>;
