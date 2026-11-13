/** Was die Dienste des Bereichs bekommen: Zugang, Dienste tieferer Bereiche, Arbeitseinheit.
 * Getrennt von bereich.ts, damit ein Dienst seinen Typ ohne Importzyklus kennt. */
import type { MailDienste } from '../mail';
import type { Db } from '../../db/database';
import { bindeImSystemrahmen, type Kontext } from '../infra/bereich';
import * as verwaltung from './repository/verwaltung';
import type { EinstellungenDienste } from '../einstellungen';
import type { AuftraegeDienste } from '../auftraege';
import type { KontoDienste } from '../konto';
import type { IdempotenzDienste } from '../idempotenz';
import type { KatalogDienste } from '../katalog';
import type { FinanzenDienste } from '../finanzen';
import type { BestandDienste } from '../bestand';
import type { SetsDienste } from '../sets';
import type { MerklisteDienste } from '../merkliste';

export interface VerwaltungAbhaengigkeiten {
  db: Db;
  einstellungen: EinstellungenDienste;
  auftraege: AuftraegeDienste;
  konto: KontoDienste;
  idempotenz: IdempotenzDienste;
  katalog: KatalogDienste;
  finanzen: FinanzenDienste;
  bestand: BestandDienste;
  sets: SetsDienste;
  merkliste: MerklisteDienste;
  mail: MailDienste;
}

export const zugang = (db: Db) => ({
  // Diagnose und Zählungen gehen über alle Konten; die Routen selbst laufen ohne Systemrahmen.
  verwaltung: bindeImSystemrahmen(db, verwaltung, 'verwaltung', [
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
});
export type VerwaltungKontext = Kontext<VerwaltungAbhaengigkeiten, ReturnType<typeof zugang>>;
