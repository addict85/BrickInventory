/** Was die Dienste bekommen; getrennt von bereich.ts, damit kein Importzyklus entsteht. */
import type { Db } from '../../db/database';
import { imSystem, mit, type Kontext } from '../infra/bereich';
import type { Faecher } from '../infra/zwischenspeicher';
import * as repository from './repository';

export interface EinstellungenAbhaengigkeiten {
  db: Db;
  /** Wer auf Änderungen globaler Werte horcht; erzeugeEinstellungen legt es an. */
  faecher: Faecher;
}

/** Mailserver, Registrierung, Schlüssel stellt keine eingeschleuste Abfrage um (0117). */
const GLOBAL = 'globale Einstellungen schreibt nur die Systemrolle';

export const zugang = (db: Db) => ({
  repository: {
    nutzerWert: mit(db)(repository.nutzerWert),
    globalerWert: mit(db)(repository.globalerWert),
    schreibeNutzerWert: mit(db)(repository.schreibeNutzerWert),
    loescheNutzerWert: mit(db)(repository.loescheNutzerWert),
    nutzerWerte: mit(db)(repository.nutzerWerte),
    schreibeGlobalenWert: imSystem(db, GLOBAL, repository.schreibeGlobalenWert),
    loescheGlobaleWerte: imSystem(db, GLOBAL, repository.loescheGlobaleWerte),
    globaleWerte: mit(db)(repository.globaleWerte),
    ersetzeGlobalenWert: imSystem(db, GLOBAL, repository.ersetzeGlobalenWert),
  },
});
export type EinstellungenKontext = Kontext<EinstellungenAbhaengigkeiten, ReturnType<typeof zugang>>;
