/** Was die Dienste des Bereichs bekommen: Zugang, Dienste tieferer Bereiche, Arbeitseinheit.
 * Getrennt von bereich.ts, damit ein Dienst seinen Typ ohne Importzyklus kennt. */
import type { Db } from '../../db/database';
import type { Faecher } from '../infra/zwischenspeicher';
import { bindeImSystemrahmen, bindeZugang, type Kontext } from '../infra/bereich';
import * as altgeheimnisse from './repository/altgeheimnisse';
import * as anmeldezaehler from './repository/anmeldezaehler';
import * as einrichtung from './repository/einrichtung';
import * as geraeteSchluessel from './repository/geraeteSchluessel';
import * as konten from './repository/konten';
import * as passkeys from './repository/passkeys';
import * as protokoll from './repository/protokoll';
import * as qrKopplung from './repository/qrKopplung';
import * as startVerwalter from './repository/startVerwalter';
import * as zugaenge from './repository/zugaenge';
import * as zweiterFaktor from './repository/zweiterFaktor';
import type { EinstellungenDienste } from '../einstellungen';
import type { HaushaltDienste } from '../haushalt';
import type { AuftraegeDienste, Nacharbeit } from '../auftraege';
import type { MailDienste } from '../mail';

export interface KontoAbhaengigkeiten {
  db: Db;
  /** Zustand je Zugang (Token-Cache, Sitzungsversionen); erzeugeKonto legt sie an. */
  faecher: Faecher;
  einstellungen: EinstellungenDienste;
  auftraege: AuftraegeDienste;
  haushalt: HaushaltDienste;
  nacharbeit: Nacharbeit;
  mail: MailDienste;
}

export const zugang = (db: Db) => ({
  // Zugangsdaten sucht die Anmeldung, bevor es ein Konto gibt; sonst sieht sie niemand (0112).
  altgeheimnisse: bindeImSystemrahmen(db, altgeheimnisse, 'zugangsdaten'),
  anmeldezaehler: bindeZugang(db, anmeldezaehler, [
    'erhoehe',
    'gibLaufplatzFrei',
    'kontoZumNamen',
    'lies',
    'loescheZaehler',
    'loescheZaehlerMitPraefix',
    'raeumeAuf',
    'zaehleHoch',
  ]),
  einrichtung: bindeZugang(db, einrichtung),
  geraeteSchluessel: bindeImSystemrahmen(db, geraeteSchluessel, 'zugangsdaten'),
  konten: bindeImSystemrahmen(db, konten, 'zugangsdaten'),
  passkeys: bindeImSystemrahmen(db, passkeys, 'zugangsdaten'),
  protokoll: bindeZugang(db, protokoll),
  qrKopplung: bindeImSystemrahmen(db, qrKopplung, 'zugangsdaten'),
  startVerwalter: bindeZugang(db, startVerwalter),
  zugaenge: bindeImSystemrahmen(db, zugaenge, 'zugangsdaten', [
    'beendeUeberlappung',
    'beruehreToken',
    'gueltigerToken',
    'kappeSitzungen',
    'kappeTokens',
    'kontoZurAnmeldung',
    'legeTokenAn',
    'loescheAbgelaufene',
    'loescheSitzungenDesKontos',
    'loescheToken',
    'loescheTokensDesKontos',
    'loescheUngenutzte',
    'loescheVerwaisteVerbrauchte',
    'passwortHash',
    'sitzungsVersion',
    'sperreFamilie',
    'zaehleSitzungsVersionHoch',
    'ziehAltzeilenNach',
  ]),
  zweiterFaktor: bindeImSystemrahmen(db, zweiterFaktor, 'zugangsdaten', [
    'aktiv',
    'aktivesGeheimnis',
    'entferne',
    'faktorStand',
    'legeGeheimnisAn',
    'verbraucheCode',
    'verbraucheSchritt',
  ]),
});
export type KontoKontext = Kontext<KontoAbhaengigkeiten, ReturnType<typeof zugang>>;
