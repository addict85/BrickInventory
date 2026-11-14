/** Was die Dienste bekommen; getrennt von bereich.ts, damit kein Importzyklus entsteht. */
import type { MailDienste } from '../mail';
import type { Db } from '../../db/database';
import { imSystem, type Kontext } from '../infra/bereich';
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
  verwaltung: {
    bestandsFigurenbilderOffen: imSystem(db, 'verwaltung', verwaltung.bestandsFigurenbilderOffen),
    bildZeilenDerKonten: imSystem(db, 'verwaltung', verwaltung.bildZeilenDerKonten),
    bricklinkTeile: imSystem(db, 'verwaltung', verwaltung.bricklinkTeile),
    fehlanzeigeDerVorschau: imSystem(db, 'verwaltung', verwaltung.fehlanzeigeDerVorschau),
    fehlanzeigeDesSets: imSystem(db, 'verwaltung', verwaltung.fehlanzeigeDesSets),
    katalogBild: imSystem(db, 'verwaltung', verwaltung.katalogBild),
    katalogBildKandidaten: imSystem(db, 'verwaltung', verwaltung.katalogBildKandidaten),
    katalogBilderOffen: imSystem(db, 'verwaltung', verwaltung.katalogBilderOffen),
    letzterLaufDerArt: imSystem(db, 'verwaltung', verwaltung.letzterLaufDerArt),
    offeneBildauftraege: imSystem(db, 'verwaltung', verwaltung.offeneBildauftraege),
    probeErfassungen: imSystem(db, 'verwaltung', verwaltung.probeErfassungen),
    probePreisCache: imSystem(db, 'verwaltung', verwaltung.probePreisCache),
    probePreisVerlauf: imSystem(db, 'verwaltung', verwaltung.probePreisVerlauf),
    probeSet: imSystem(db, 'verwaltung', verwaltung.probeSet),
    probeWaehrung: imSystem(db, 'verwaltung', verwaltung.probeWaehrung),
    protokollSeit: imSystem(db, 'verwaltung', verwaltung.protokollSeit),
    rbInventarTeile: imSystem(db, 'verwaltung', verwaltung.rbInventarTeile),
    rbTeile: imSystem(db, 'verwaltung', verwaltung.rbTeile),
    setFehlanzeigen: imSystem(db, 'verwaltung', verwaltung.setFehlanzeigen),
    setFehlanzeigenOhne404: imSystem(db, 'verwaltung', verwaltung.setFehlanzeigenOhne404),
    setFigurenbilderOffen: imSystem(db, 'verwaltung', verwaltung.setFigurenbilderOffen),
    setsOhneAnleitung: imSystem(db, 'verwaltung', verwaltung.setsOhneAnleitung),
    teilbilderFertig: imSystem(db, 'verwaltung', verwaltung.teilbilderFertig),
    teilbilderOffen: imSystem(db, 'verwaltung', verwaltung.teilbilderOffen),
    veraltetePreise: imSystem(db, 'verwaltung', verwaltung.veraltetePreise),
    vorschauFehlanzeigen: imSystem(db, 'verwaltung', verwaltung.vorschauFehlanzeigen),
    zugeordneteTeile: imSystem(db, 'verwaltung', verwaltung.zugeordneteTeile),
  },
});
export type VerwaltungKontext = Kontext<VerwaltungAbhaengigkeiten, ReturnType<typeof zugang>>;
