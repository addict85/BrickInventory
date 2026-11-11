/** Die Fabrik des Bereichs: Wer die Datenbank braucht, nimmt den Zugang als
 * ersten Parameter; erzeugeVerwaltung bindet ihn einmal für alle. So greift kein
 * Modul selbst auf den Zugang des Prozesses zu, und ein Test gibt einen eigenen. */
import type { Db } from '../../db/database';
import { bindeZugang } from '../infra/bereich';
import * as verwaltung from './repository/verwaltung';

export interface VerwaltungKontext {
  db: Db;
}

export function erzeugeVerwaltung(k: VerwaltungKontext) {
  const { db } = k;
  return {
    db,
    verwaltung: bindeZugang(db, verwaltung, [
      'bestandsFigurenbilderOffen',
      'bildZeilenDerKonten',
      'bricklinkTeile',
      'fehlanzeigeDerVorschau',
      'fehlanzeigeDesSets',
      'katalogBild',
      'katalogBildKandidaten',
      'katalogBilderOffen',
      'letzterLaufDerArt',
      'offeneBildauftraege',
      'probeErfassungen',
      'probePreisCache',
      'probePreisVerlauf',
      'probeSet',
      'probeWaehrung',
      'protokollSeit',
      'rbInventarTeile',
      'rbTeile',
      'setFehlanzeigen',
      'setFehlanzeigenOhne404',
      'setFigurenbilderOffen',
      'setsOhneAnleitung',
      'teilbilderFertig',
      'teilbilderOffen',
      'veraltetePreise',
      'vorschauFehlanzeigen',
      'zugeordneteTeile',
    ]),
  };
}

export type VerwaltungDienste = ReturnType<typeof erzeugeVerwaltung>;
