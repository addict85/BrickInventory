/** Aus einem Zugang entstehen Kontingent, Drosseln und die Klienten, die genau diese bekommen:
 * Zwei Sätze Dienste in einem Prozess teilen weder Schlüssel noch Zwischenstände. */
import { mit, baueKontext, type Einblick } from '../infra/bereich';
import type { Db } from '../../db/database';
import { BRICKSET_HOECHSTENS } from '../auftraege';
import * as apiKontingentDienst from './apiKontingent';
import * as rateLimiter from './rateLimiter';
import { baueQuellen, type KlientenZugang, type Quellen } from './quellen';
import { zugang, type FremdquellenAbhaengigkeiten, type FremdquellenKontext } from './kontext';

export type { FremdquellenAbhaengigkeiten, FremdquellenKontext } from './kontext';

/** Gelesen beim Aufruf, nicht beim Bau: Ein Test ersetzt einen Klienten auch, nachdem
 * die Dienste schon stehen (test/helpers/sources.js testQuellen). */
function mitErsatz(echt: Quellen, ersatz: Partial<Quellen> | undefined): Quellen {
  if (!ersatz) return echt;
  const aus = {} as Quellen;
  for (const n of Object.keys(echt) as (keyof Quellen)[])
    Object.defineProperty(aus, n, { enumerable: true, get: () => (n in ersatz ? ersatz[n] : echt[n]) });
  return aus;
}

export function erzeugeFremdquellen(a: FremdquellenAbhaengigkeiten, einblick?: Einblick<FremdquellenKontext>) {
  const k: FremdquellenKontext = baueKontext(a, zugang);
  einblick?.(k);
  const drossel = rateLimiter.rebrickableDrosseln(k.apiTakt);
  const kontingent = {
    checkAndIncrementRateLimit: mit(k)(apiKontingentDienst.checkAndIncrementRateLimit),
    getRateLimitStatus: mit(k)(apiKontingentDienst.getRateLimitStatus),
    kontingentFrei: mit(k)(apiKontingentDienst.kontingentFrei),
    setzeKontingentZurueck: mit(k)(apiKontingentDienst.setzeKontingentZurueck),
    getLimitForApi: mit(k)(apiKontingentDienst.getLimitForApi),
  };
  const klienten: KlientenZugang = {
    schluessel: async name => (await k.einstellungen.getGlobalSetting(name)) || '',
    zaehle: api => kontingent.checkAndIncrementRateLimit(api),
    kontingentStand: api => kontingent.getRateLimitStatus(api),
    drossel,
    bricksetVormerken: async (sn, fehler, bald) => ({
      ...(await k.auftraege.bricksetVormerken(sn, fehler, bald)),
      hoechstens: BRICKSET_HOECHSTENS,
    }),
    bricksetVergessen: sn => k.auftraege.bricksetAusWiedervorlage(sn),
  };
  const dienste = {
    /** Die Klienten dieses Zugangs; ein Test ersetzt einzelne über `ersatz`. */
    quellen: mitErsatz(baueQuellen(klienten), a.ersatz),
    klienten,
    drossel,
    ...kontingent,
    rebrickableDailyStatus: mit(k)(rateLimiter.rebrickableDailyStatus),
    consumeRebrickableDaily: mit(k)(rateLimiter.consumeRebrickableDaily),
  };
  // Klienten rufen nach draussen und gehören nie in eine Transaktion: Ihr Satz bleibt
  // derselbe, damit Drosseln und Kontingent nicht je Transaktion neu entstehen.
  return Object.assign(dienste, { ueber: (_db: Db) => dienste });
}

export type FremdquellenDienste = ReturnType<typeof erzeugeFremdquellen>;
