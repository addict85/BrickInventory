/** Aus einem Zugang entstehen Kontingent, Drosseln und die Klienten, die genau diese bekommen:
 * Zwei Sätze Dienste in einem Prozess teilen weder Schlüssel noch Zwischenstände. */
import { baueKontext, bindeZugang, type Einblick } from '../infra/bereich';
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
  return new Proxy(echt, {
    get: (z, n: string) => (n in ersatz ? ersatz[n as keyof Quellen] : z[n as keyof Quellen]),
  });
}

export function erzeugeFremdquellen(a: FremdquellenAbhaengigkeiten, einblick?: Einblick<FremdquellenKontext>) {
  const k: FremdquellenKontext = baueKontext(a, zugang);
  einblick?.(k);
  const drossel = rateLimiter.rebrickableDrosseln(k.apiTakt);
  const kontingent = bindeZugang(k, apiKontingentDienst, [
    'checkAndIncrementRateLimit',
    'getRateLimitStatus',
    'kontingentFrei',
    'setzeKontingentZurueck',
    'getLimitForApi',
  ]);
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
  return {
    /** Die Klienten dieses Zugangs; ein Test ersetzt einzelne über `ersatz`. */
    quellen: mitErsatz(baueQuellen(klienten), a.ersatz),
    klienten,
    drossel,
    ...kontingent,
    ...bindeZugang(k, rateLimiter, ['rebrickableDailyStatus', 'consumeRebrickableDaily']),
  };
}

export type FremdquellenDienste = ReturnType<typeof erzeugeFremdquellen>;
