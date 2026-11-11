/** Was untere Schichten von höheren brauchen, ohne sie zu importieren: Nacharbeit
 * nach dem Erfassen, das erste Konto einer leeren Datenbank und die Dienste der
 * Bereiche mit Fabrik. Jeder Prozess baut es beim Start und reicht es weiter
 * (server.ts, Skripte, Testhilfen). */
import {
  verdrahteNacharbeit,
  type Nacharbeit,
  ziehePlanVor,
  stelleAuftragEin,
  bricksetVormerken,
  bricksetAusWiedervorlage,
  BRICKSET_HOECHSTENS,
  erzeugeAuftraege,
  verdrahteAuftraege,
  auftraegeBereich,
} from '../src/auftraege';
import { dbKonfigAusUmgebung, erzeugeDb, type Db } from '../db/database';
import { erzeugeSets, verdrahteSets } from '../src/sets';
import { erzeugeHaushalt, verdrahteHaushalt } from '../src/haushalt';
import { erzeugeIdempotenz, verdrahteIdempotenz } from '../src/idempotenz';
import { erzeugeBestand, verdrahteBestand } from '../src/bestand';
import { erzeugeTeile, verdrahteTeile } from '../src/teile';
import { erzeugeFiguren, verdrahteFiguren } from '../src/figuren';
import { erzeugeMerkliste, verdrahteMerkliste } from '../src/merkliste';
import { erzeugeGutscheine, verdrahteGutscheine } from '../src/gutscheine';
import { erzeugeSammlung, verdrahteSammlung } from '../src/sammlung';
import { erzeugeVerwaltung, verdrahteVerwaltung } from '../src/verwaltung';
import {
  erzeugeKatalog,
  verdrahteKatalog,
  katalog,
  merkeGebraucht,
  enrichSetParts,
  enrichSetMinifigs,
  checkAndIncrementRateLimit,
  getRateLimitStatus,
  rebrickableLimiter,
  rebrickableBackgroundLimiter,
  rebrickableDailyStatus,
} from '../src/katalog';
import { erzeugeFinanzen, verdrahteFinanzen, finanzenBereich, refreshPriceForSet } from '../src/finanzen';
import { mitVersion } from '../src/infra/setNummer';
import { erzeugeKonto, verdrahteKonto, legeStartVerwalterAn } from '../src/konto';
import { meldeFehler } from '../src/infra/fehler';
import { verdrahteKlienten, type KlientenZugang } from '../clients/zugang';
import { erzeugeEinstellungen, verdrahteEinstellungen, getGlobalSetting } from '../src/einstellungen';

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

/** Der Zugang zur Datenbank kommt immer vom Einstieg; einen Rückfall gibt es nicht. */
export function verdrahte(v: Verdrahtung, db: Db): void {
  verdrahteNacharbeit(v.nacharbeit);
  verdrahteKlienten(baueKlientenZugang());
  verdrahteVerwaltung(() => erzeugeVerwaltung({ db }));
  verdrahteSammlung(() => erzeugeSammlung({ db }));
  verdrahteGutscheine(() => erzeugeGutscheine({ db }));
  verdrahteMerkliste(() => erzeugeMerkliste({ db }));
  verdrahteFiguren(() => erzeugeFiguren({ db }));
  verdrahteTeile(() => erzeugeTeile({ db }));
  verdrahteBestand(() => erzeugeBestand({ db }));
  verdrahteFinanzen(() => erzeugeFinanzen({ db }));
  verdrahteIdempotenz(() => erzeugeIdempotenz({ db }));
  verdrahteKonto(() => erzeugeKonto({ db }));
  verdrahteHaushalt(() => erzeugeHaushalt({ db }));
  verdrahteAuftraege(() => erzeugeAuftraege({ db }));
  verdrahteEinstellungen(() => erzeugeEinstellungen({ db }));
  verdrahteKatalog(() => erzeugeKatalog({ db }));
  verdrahteSets(() =>
    erzeugeSets({
      db,
      nacharbeit: v.nacharbeit,
      katalog: katalog(),
      finanzen: finanzenBereich(),
      auftraege: auftraegeBereich(),
    }),
  );
}

/** Der Zugang des Prozesses samt Erststart, verdrahtet; der Einstieg hält ihn. */
export function verdrahteProzess(v: Verdrahtung = baueVerdrahtung()): Db {
  const zugang = erzeugeDb(dbKonfigAusUmgebung(), { erststart: v.erststart });
  verdrahte(v, zugang);
  return zugang;
}
