/** Sets, Käufe und Erfassungen gehören dem Bestand (docs/architektur.md); die Bereiche darüber
 * schreiben sie über diese Dienste, in ihrer Transaktion über t.bestand. */
import type { ErfassungsArt } from '../../db/bestandsmenge';
import { mit } from '../infra/bereich';
import * as erfassungen from './repository/erfassungen';
import * as gemeinsam from './repository/gemeinsam';
import * as kaeufe from './repository/kaeufe';
import { manuelleErfassungUmhaengen } from './umhaengen';
import type { BestandKontext } from './kontext';

export interface ErfassungsAenderung {
  menge?: number;
  preis?: { wert: number | null; geschaetzt: boolean };
  zustand?: string;
  datum?: string;
}

/** Nur in den übergebenen Konten: zweite Linie hinter der Prüfung des Aufrufers. */
async function aendere(k: BestandKontext, art: ErfassungsArt, id: number, konten: number[], a: ErfassungsAenderung) {
  if (a.menge !== undefined) await erfassungen.setzeErfassungsMenge(k.db, art, id, a.menge, konten);
  if (a.preis) await erfassungen.setzeErfassungsPreis(k.db, art, id, a.preis.wert, a.preis.geschaetzt, konten);
  if (a.zustand !== undefined) await erfassungen.setzeErfassungsZustand(k.db, art, id, a.zustand, konten);
  if (a.datum) await erfassungen.setzeErfassungsDatum(k.db, art, id, a.datum, konten);
}

export const schreibwege = (k: BestandKontext) => ({
  legeSetAn: mit(k.db, gemeinsam.legeSetAn),
  neuesteSetzen: mit(k.db, kaeufe.neuesteSetzen),
  erfassung: {
    imSchreibfeld: mit(k.db, erfassungen.erfassungImSchreibfeld),
    aendere: mit(k)(aendere),
    loesche: mit(k.db, erfassungen.loescheErfassung),
  },
  manuelleErfassungUmhaengen: mit(k)(manuelleErfassungUmhaengen),
});
