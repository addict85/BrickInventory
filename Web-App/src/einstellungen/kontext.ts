/** Was die Dienste bekommen; getrennt von bereich.ts, damit kein Importzyklus entsteht. */
import type { Db } from '../../db/database';
import { imSystem, mit, type Kontext } from '../infra/bereich';
import type { Faecher } from '../infra/zwischenspeicher';
import * as repository from './repository/werte';
import type { DrosselDienste } from '../drossel';
import type { Uhr } from '../infra/uhr';
import type { EinstellungenLesevertrag } from './lesevertrag';

export interface EinstellungenAbhaengigkeiten {
  uhr: Uhr;
  db: Db;
  /** Wer auf Änderungen globaler Werte horcht; erzeugeEinstellungen legt es an. */
  faecher: Faecher;
  drossel: DrosselDienste;
  lesevertrag: EinstellungenLesevertrag;
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
    ersterWertIn: mit(db)(repository.ersterWertIn),
    fremderNutzerWert: imSystem(db, 'Verwaltung: liest den Wert eines anderen Kontos', repository.nutzerWert),
    schreibeGlobalenWert: imSystem(db, GLOBAL, repository.schreibeGlobalenWert),
    loescheGlobaleWerte: imSystem(db, GLOBAL, repository.loescheGlobaleWerte),
    globaleWerte: mit(db)(repository.globaleWerte),
    ersetzeGlobalenWert: imSystem(db, GLOBAL, repository.ersetzeGlobalenWert),
  },
});
export type EinstellungenKontext = Kontext<EinstellungenAbhaengigkeiten, ReturnType<typeof zugang>>;
