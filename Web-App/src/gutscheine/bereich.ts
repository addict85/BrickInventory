/** Die Fabrik des Bereichs: Wer die Datenbank braucht, nimmt den Zugang als
 * ersten Parameter; erzeugeGutscheine bindet ihn einmal für alle. So greift kein
 * Modul selbst auf den Zugang des Prozesses zu, und ein Test gibt einen eigenen. */
import type { Db } from '../../db/database';
import { bindeZugang } from '../infra/bereich';
import * as guthabenSchranke from './repository/guthabenSchranke';
import * as gutscheine from './repository/gutscheine';

export interface GutscheineKontext {
  db: Db;
}

export function erzeugeGutscheine(k: GutscheineKontext) {
  const { db } = k;
  return {
    db,
    guthabenSchranke: bindeZugang(db, guthabenSchranke, ['oeffneSchranke', 'sperreSchranke']),
    gutscheine: bindeZugang(db, gutscheine, [
      'guthabenMerken',
      'gutschein',
      'gutscheinAendern',
      'gutscheinAnlegen',
      'gutscheinErsetzen',
      'gutscheinLoeschen',
      'gutscheinPdfMerken',
      'gutscheineDesKontos',
      'gutscheineNeuVerschluesseln',
      'kopienVerschluesseln',
      'nummernNachverschluesseln',
    ]),
  };
}

export type GutscheineDienste = ReturnType<typeof erzeugeGutscheine>;
