/** Was untere Schichten von höheren brauchen, ohne sie zu importieren: Nacharbeit
 * nach dem Erfassen, das erste Konto einer leeren Datenbank und die Dienste der
 * Bereiche mit Fabrik. Jeder Prozess baut es beim Start und reicht es weiter
 * (server.ts, Skripte, Testhilfen). */
import {
  type Nacharbeit,
  ziehePlanVor,
  stelleAuftragEin,
  bricksetVormerken,
  bricksetAusWiedervorlage,
  BRICKSET_HOECHSTENS,
  erzeugeAuftraege,
} from '../src/auftraege';
import { dbKonfigAusUmgebung, erzeugeDb, type Db } from '../db/database';
import { erzeugeSets } from '../src/sets';
import { erzeugeHaushalt } from '../src/haushalt';
import { erzeugeIdempotenz } from '../src/idempotenz';
import { erzeugeBestand } from '../src/bestand';
import { erzeugeTeile } from '../src/teile';
import { erzeugeFiguren } from '../src/figuren';
import { erzeugeMerkliste } from '../src/merkliste';
import { erzeugeGutscheine } from '../src/gutscheine';
import { erzeugeSammlung } from '../src/sammlung';
import { erzeugeVerwaltung } from '../src/verwaltung';
import {
  type Bildwerk,
  erzeugeKatalog,
  merkeGebraucht,
  enrichSetParts,
  enrichSetMinifigs,
  checkAndIncrementRateLimit,
  getRateLimitStatus,
  rebrickableLimiter,
  rebrickableBackgroundLimiter,
  rebrickableDailyStatus,
} from '../src/katalog';
import { erzeugeFinanzen, refreshPriceForSet } from '../src/finanzen';
import { mitVersion } from '../src/infra/setNummer';
import { erzeugeKonto, legeStartVerwalterAn } from '../src/konto';
import { meldeFehler } from '../src/infra/fehler';
import { prozessDienste as alleDienste, verdrahteDienste } from '../src/infra/bereich';
import { verdrahteKlienten, type KlientenZugang } from '../clients/zugang';
import { erzeugeEinstellungen, getGlobalSetting } from '../src/einstellungen';

export interface Verdrahtung {
  nacharbeit: Nacharbeit;
  erststart: () => Promise<void>;
}

export function baueVerdrahtung(): Verdrahtung {
  return {
    nacharbeit: {
      preisJobAnstossen: () => {
        ziehePlanVor('preise').catch((e: unknown) => meldeFehler('einstellungen:preis-job-anstossen', e));
      },
      preisFuerSetHolen: (sn, uid, zustand) => refreshPriceForSet(sn, uid, zustand),
      bildVormerken: (url, sn) => merkeGebraucht(url, sn),
      setTeileAnreichern: sn => enrichSetParts(sn),
      figurenAnreichern: sn => enrichSetMinifigs(sn),
      setBilderLaden: sn =>
        stelleAuftragEin(
          'bilder',
          { set_number: sn, nur_bilder: true },
          { schluessel: `bilder:${mitVersion(sn)}:nur`, maxVersuche: 3 },
        ),
    },
    erststart: legeStartVerwalterAn,
  };
}

/** Was die Klienten (clients/) von der Anwendung brauchen: Schlüssel, Kontingent,
 * Drossel und die Brickset-Wiedervorlage. */
export function baueKlientenZugang(): KlientenZugang {
  return {
    schluessel: async name => (await getGlobalSetting(name)) || '',
    zaehle: api => checkAndIncrementRateLimit(api),
    kontingentStand: api => (api === 'rebrickable' ? rebrickableDailyStatus() : getRateLimitStatus(api)),
    drossel: { vordergrund: rebrickableLimiter, hintergrund: rebrickableBackgroundLimiter },
    bricksetVormerken: async (sn, fehler, bald) => ({
      ...(await bricksetVormerken(sn, fehler, bald)),
      hoechstens: BRICKSET_HOECHSTENS,
    }),
    bricksetVergessen: bricksetAusWiedervorlage,
  };
}

/** Alle Bereiche über einen Zugang, von unten nach oben: Jeder bekommt die Dienste
 * der tieferen, die er braucht, als Teil seines Kontexts. Die eine Stelle, an der
 * verdrahtet wird; Testhilfen rufen sie auch und geben dabei ihr `bildwerk` und ihre `quellen` mit. */
export function baueDienste(
  db: Db,
  nacharbeit: Nacharbeit,
  bildwerk?: Bildwerk,
  quellen?: Parameters<typeof erzeugeKatalog>[0]['quellen'],
) {
  const einstellungen = erzeugeEinstellungen({ db });
  const auftraege = erzeugeAuftraege({ db, einstellungen });
  const haushalt = erzeugeHaushalt({ db });
  const konto = erzeugeKonto({ db, einstellungen, auftraege, haushalt, nacharbeit });
  const idempotenz = erzeugeIdempotenz({ db });
  const katalog = erzeugeKatalog({ db, einstellungen, auftraege, haushalt, nacharbeit, bildwerk, quellen });
  const finanzen = erzeugeFinanzen({ db, einstellungen, auftraege, haushalt, katalog, nacharbeit });
  const bestand = erzeugeBestand({ db, einstellungen, haushalt, konto, katalog, finanzen });
  const sets = erzeugeSets({ db, nacharbeit, katalog, finanzen, auftraege, bestand, einstellungen, konto });
  const teile = erzeugeTeile({ db, einstellungen, haushalt, katalog, finanzen, bestand });
  const figuren = erzeugeFiguren({ db, einstellungen, haushalt, katalog, finanzen, bestand, nacharbeit });
  const merkliste = erzeugeMerkliste({ db, einstellungen, haushalt, katalog, finanzen, sets, nacharbeit });
  const gutscheine = erzeugeGutscheine({ db, einstellungen, konto });
  const sammlung = erzeugeSammlung({
    db,
    haushalt,
    auftraege,
    katalog,
    finanzen,
    bestand,
    sets,
    teile,
    figuren,
    merkliste,
  });
  const verwaltung = erzeugeVerwaltung({
    db,
    einstellungen,
    auftraege,
    konto,
    idempotenz,
    katalog,
    finanzen,
    bestand,
    sets,
    merkliste,
  });
  return {
    einstellungen,
    auftraege,
    haushalt,
    konto,
    idempotenz,
    katalog,
    finanzen,
    bestand,
    sets,
    teile,
    figuren,
    merkliste,
    gutscheine,
    sammlung,
    verwaltung,
  };
}
export type Dienste = ReturnType<typeof baueDienste>;

/** Die Dienste, die verdrahte() dem Prozess gegeben hat: für den Einstieg (server.ts). */
export const prozessDienste = (): Dienste => alleDienste() as Dienste;

/** Der Zugang zur Datenbank kommt immer vom Einstieg; einen Rückfall gibt es nicht. */
export function verdrahte(v: Verdrahtung, db: Db): void {
  verdrahteKlienten(baueKlientenZugang());
  verdrahteDienste(() => baueDienste(db, v.nacharbeit));
}

/** Der Zugang des Prozesses samt Erststart, verdrahtet; der Einstieg hält ihn. */
export function verdrahteProzess(v: Verdrahtung = baueVerdrahtung()): Db {
  const zugang = erzeugeDb(dbKonfigAusUmgebung(), { erststart: v.erststart });
  verdrahte(v, zugang);
  return zugang;
}
