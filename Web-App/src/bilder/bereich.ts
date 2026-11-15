/** Die Fabrik der Bilder. Ihr Zustand (Puffer, Warteschlangen, Zähler) liegt in den Fächern
 * dieses Satzes Dienste, nicht im Modul: Zwei Sätze in einem Prozess teilen nichts. */
import type { Db } from '../../db/database';
import { mit, baueBereich, type Einblick } from '../infra/bereich';
import { Faecher } from '../infra/zwischenspeicher';
import * as bildbedarfDienst from './bildbedarf';
import * as bildbedarfLauf from './bildbedarfLauf';
import { bilderAuftragsarten } from './auftragsarten';
import * as imageMisses from './imageMisses';
import * as bildBlickfeldDienst from './bildBlickfeld';
import * as bildNachschlagen from './bildNachschlagen';
import * as proxyThumbs from './proxyThumbs';
import * as imgCacheServe from './imgCacheServe';
import * as bildDatei from './bildDatei';
import * as vorschauenEinpassen from './vorschauenEinpassen';
import { setBildHerunterladen } from './setImages';
import { vorschauErzeugenAus } from './thumbs';
import { zugang, type Bildwerk, type BilderAbhaengigkeiten, type BilderKontext } from './kontext';

export type { Bildwerk, BilderAbhaengigkeiten, BilderKontext } from './kontext';

/** Ohne `bildwerk` das echte; ein Test gibt seines mit (startup/verdrahtung.ts baueDienste). */
export function erzeugeBilder(
  a: Omit<BilderAbhaengigkeiten, 'faecher' | 'bildwerk'> & { bildwerk?: Bildwerk | undefined },
  einblick?: Einblick<BilderKontext>,
) {
  const bildwerk = a.bildwerk ?? {
    setBildLaden: (url: string, sn: string, info?: { status?: number }) => setBildHerunterladen(a, url, sn, info),
    vorschauErzeugen: vorschauErzeugenAus,
  };
  return baueBereich(
    { ...a, bildwerk, faecher: new Faecher() },
    (db: Db) => zugang(db, a.lesevertrag),
    (k: BilderKontext) => ({
      /** Grenzen des Bild-Proxys und des Caches aus der gereichten Konfiguration. */
      bildGrenzen: () => ({
        cacheMaxBytes: k.konfig.bildCacheMaxMb * 1024 * 1024,
        abrufeJeMinute: k.konfig.bildAbrufeJeMinute,
      }),
      loescheVerfallene: mit(k)(bildbedarfDienst.loescheVerfallene),
      katalogBilderVormerken: mit(k)(bildbedarfDienst.katalogBilderVormerken),
      offenerBildbedarf: mit(k)(bildbedarfDienst.offenerBildbedarf),
      leereBildbedarf: mit(k)(bildbedarfDienst.leereBildbedarf),
      bildbedarfAnstossen: mit(k)(bildbedarfDienst.bildbedarfAnstossen),
      merkeGebraucht: mit(k)(bildbedarfDienst.merkeGebraucht),
      bildEinmalVormerken: mit(k)(bildbedarfDienst.bildEinmalVormerken),
      auftragsarten: () => bilderAuftragsarten(k),
      starteBildbedarf: mit(k)(bildbedarfLauf.bildbedarfEinrichten),
      stoppeBildbedarf: mit(k)(bildbedarfLauf.stoppeBildbedarf),
      beiSetBildGeladen: mit(k)(bildbedarfDienst.beiSetBildGeladen),
      meldeSetBildGeladen: mit(k)(bildbedarfDienst.meldeSetBildGeladen),
      // Beim Aufruf nachgeschlagen: Ein Test ersetzt Teile des Bildwerks nach dem Bau.
      setBildLaden: (...a: Parameters<Bildwerk['setBildLaden']>) => k.bildwerk.setBildLaden(...a),
      vorschauErzeugen: (relPfad: string) => k.bildwerk.vorschauErzeugen(relPfad),
      vergissFehlend: mit(k)(imageMisses.vergissFehlend),
      starteFehlanzeige: mit(k)(imageMisses.bildFehlstellenEinrichten),
      stoppeFehlanzeige: mit(k)(imageMisses.stoppeFehlanzeige),
      istBekanntFehlend: mit(k)(imageMisses.istBekanntFehlend),
      merkeFehlend: mit(k)(imageMisses.merkeFehlend),
      anleitungFreigegeben: mit(k)(bildBlickfeldDienst.anleitungFreigegeben),
      setNummerImBlickfeld: mit(k)(bildBlickfeldDienst.setNummerImBlickfeld),
      cdnFuerFehlendesBild: mit(k)(bildNachschlagen.cdnFuerFehlendesBild),
      queueThumb: mit(k)(proxyThumbs.queueThumb),
      cacheTreffer: mit(k)(imgCacheServe.cacheTreffer),
      raeumeBildCacheAuf: imgCacheServe.raeumeBildCacheAuf,
      ladeBild: mit(k)(bildDatei.ladeBild),
      zugeschnitteneVorschauenEinpassen: (lokale: { web: string; datei: string }[]) =>
        vorschauenEinpassen.zugeschnitteneVorschauenEinpassen(k, lokale),
      bildOeffnen: (...x: Parameters<BilderKontext['fremdquellen']['quellen']['oeffneBild']>) =>
        k.fremdquellen.quellen.oeffneBild(...x),
    }),
    einblick,
  );
}

export type BilderDienste = ReturnType<typeof erzeugeBilder>;
