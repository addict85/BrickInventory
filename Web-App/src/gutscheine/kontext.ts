/** Was die Dienste des Bereichs bekommen: Zugang, Dienste tieferer Bereiche, Arbeitseinheit.
 * Getrennt von bereich.ts, damit ein Dienst seinen Typ ohne Importzyklus kennt. */
import type { Db } from '../../db/database';
import { bindeZugang, type Kontext } from '../infra/bereich';
import * as guthabenSchranke from './repository/guthabenSchranke';
import * as gutscheine from './repository/gutscheine';
import type { EinstellungenDienste } from '../einstellungen';
import type { KontoDienste } from '../konto';

export interface GutscheineAbhaengigkeiten {
  db: Db;
  einstellungen: EinstellungenDienste;
  konto: KontoDienste;
}

export const zugang = (db: Db) => ({
  guthabenSchranke: bindeZugang(db, guthabenSchranke, ['oeffneSchranke', 'sperreSchranke']),
  gutscheine: bindeZugang(db, gutscheine, [
    'guthabenMerken',
    'gutschein',
    'gutscheinAendern',
    'gutscheinAnlegen',
    'gutscheinErsetzen',
    'gutscheinGesperrt',
    'gutscheinLoeschen',
    'gutscheinPdfMerken',
    'gutscheineDesKontos',
    'gutscheineNeuVerschluesseln',
    'kopienVerschluesseln',
    'nummernNachverschluesseln',
  ]),
});
export type GutscheineKontext = Kontext<GutscheineAbhaengigkeiten, ReturnType<typeof zugang>>;
