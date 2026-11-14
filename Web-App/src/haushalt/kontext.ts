/** Was die Dienste des Bereichs bekommen: Zugang, Dienste tieferer Bereiche, Arbeitseinheit.
 * Getrennt von bereich.ts, damit ein Dienst seinen Typ ohne Importzyklus kennt. */
import type { Db } from '../../db/database';
import { bindeJeFunktion, type Kontext } from '../infra/bereich';
import type { EinstellungenDienste } from '../einstellungen';
import type { Faecher } from '../infra/zwischenspeicher';
import * as repository from './repository';

export interface HaushaltAbhaengigkeiten {
  db: Db;
  /** Das Gedächtnis der Haushalte je Zugang; erzeugeHaushalt legt es an. */
  faecher: Faecher;
  einstellungen: EinstellungenDienste;
}

/** Einladungen stehen unter Zeilenschutz ihres Kontos (0114); wer einen Code einlöst,
 * gehört nicht dazu, und das Aufräumen gilt allen. */
const FREMDE_EINLADUNG = 'Einlösen: Die Einladung gehört dem einladenden Konto';
export const zugang = (db: Db) => ({
  repository: bindeJeFunktion(db, repository, 'haushalt', {
    belegeEinladung: FREMDE_EINLADUNG,
    einladenderZuCode: FREMDE_EINLADUNG,
    gibEinladungFrei: FREMDE_EINLADUNG,
    raeumeEinladungenAuf: 'Abgelaufene Einladungen aller Konten',
  }),
});
export type HaushaltKontext = Kontext<HaushaltAbhaengigkeiten, ReturnType<typeof zugang>>;
