/** Was untere Schichten von höheren brauchen, ohne sie zu importieren: Nacharbeit
 * nach dem Erfassen, das erste Konto einer leeren Datenbank und die Dienste der
 * Bereiche mit Fabrik. Jeder Prozess baut es beim Start und reicht es weiter
 * (server.ts, Skripte, Testhilfen). */
import { verdrahteNacharbeit, type Nacharbeit } from '../src/auftraege/nacharbeit';
import { dbKonfigAusUmgebung, erzeugeDb, setzeStandardDb, standardDb, type Db } from '../db/database';
import { erzeugeSets } from '../src/sets/bereich';
import { verdrahteSets } from '../src/sets/prozess';
import { erzeugeKatalog } from '../src/katalog/bereich';
import { verdrahteKatalog } from '../src/katalog/prozess';
import { ziehePlanVor } from '../src/auftraege/zeitplan';
import { refreshPriceForSet } from '../src/finanzen/preisLauf';
import { merkeGebraucht } from '../src/katalog/bilder/bildbedarf';
import { enrichSetParts, enrichSetMinifigs } from '../src/katalog/teileAnreicherung';
import { stelleAuftragEin } from '../src/auftraege/dienst';
import { mitVersion } from '../src/infra/setNummer';
import { legeStartVerwalterAn } from '../src/konto/startVerwalter';
import { meldeFehler } from '../src/infra/fehler';
import { verdrahteKlienten, type KlientenZugang } from '../clients/zugang';
import { bricksetVormerken, bricksetAusWiedervorlage, BRICKSET_HOECHSTENS } from '../src/auftraege/bricksetAuftrag';
import { getGlobalSetting } from '../src/einstellungen/settings';
import { checkAndIncrementRateLimit, getRateLimitStatus } from '../src/katalog/apiKontingent';
import { rebrickableLimiter, rebrickableBackgroundLimiter, rebrickableDailyStatus } from '../src/katalog/rateLimiter';

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

/** Der Zugang zur Datenbank kommt vom Einstieg; ohne Angabe der des Prozesses. */
export function verdrahte(v: Verdrahtung = baueVerdrahtung(), db: Db = standardDb()): void {
  verdrahteNacharbeit(v.nacharbeit);
  verdrahteKlienten(baueKlientenZugang());
  verdrahteKatalog(() => erzeugeKatalog({ db }));
  verdrahteSets(() => erzeugeSets({ db, nacharbeit: v.nacharbeit }));
}

/** Der Zugang des Prozesses samt Erststart, als Standard gesetzt und verdrahtet. */
export function verdrahteProzess(v: Verdrahtung = baueVerdrahtung()): Db {
  const zugang = erzeugeDb(dbKonfigAusUmgebung(), { erststart: v.erststart });
  setzeStandardDb(zugang);
  verdrahte(v, zugang);
  return zugang;
}
