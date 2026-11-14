/** Die Fabrik der Bilder. Ihr Zustand (Puffer, Warteschlangen, Zähler) liegt in den Fächern
 * dieses Satzes Dienste, nicht im Modul: Zwei Sätze in einem Prozess teilen nichts. */
import { mit, baueBereich, type Einblick } from '../infra/bereich';
import { Faecher } from '../infra/zwischenspeicher';
import * as bildlageDienst from './bildlage';
import * as bildbedarfDienst from './bildbedarf';
import * as bildbedarfLauf from './bildbedarfLauf';
import * as imageMisses from './imageMisses';
import * as bildBlickfeldDienst from './bildBlickfeld';
import * as bildNachschlagen from './bildNachschlagen';
import * as proxyThumbs from './proxyThumbs';
import * as imgCacheServe from './imgCacheServe';
import { bildUserAgent, downloadSetImage } from './setImages';
import { generateThumb } from './thumbs';
import { zugang, type Bildwerk, type BilderAbhaengigkeiten, type BilderKontext } from './kontext';

export type { Bildwerk, BilderAbhaengigkeiten, BilderKontext } from './kontext';

/** Ohne `bildwerk` das echte; ein Test gibt seines mit (startup/verdrahtung.ts baueDienste). */
export function erzeugeBilder(
  a: Omit<BilderAbhaengigkeiten, 'faecher' | 'bildwerk'> & { bildwerk?: Bildwerk | undefined },
  einblick?: Einblick<BilderKontext>,
) {
  const bildwerk = a.bildwerk ?? {
    setBildLaden: (url: string, sn: string, info?: { status?: number }) =>
      downloadSetImage(url, sn, info, bildUserAgent(a.konfig)),
    vorschauErzeugen: generateThumb,
  };
  return baueBereich(
    { ...a, bildwerk, faecher: new Faecher() },
    zugang,
    (k: BilderKontext) => ({
      /** Grenzen des Bild-Proxys und des Caches aus der gereichten Konfiguration. */
      bildGrenzen: () => ({
        cacheMaxBytes: k.konfig.bildCacheMaxMb * 1024 * 1024,
        abrufeJeMinute: k.konfig.bildAbrufeJeMinute,
      }),
      fuelleAusBrickset: mit(k)(bildlageDienst.fuelleAusBrickset),
      anleitungenNachtragen: mit(k)(bildlageDienst.anleitungenNachtragen),
      setBilderNachladen: mit(k)(bildlageDienst.setBilderNachladen),
      vorschaubilderNachtragen: mit(k)(bildlageDienst.vorschaubilderNachtragen),
      setBildLokalEintragen: mit(k)(bildlageDienst.setBildLokalEintragen),
      bilderFuerNachlauf: mit(k)(bildlageDienst.bilderFuerNachlauf),
      bilderAusKatalog: <T extends bildlageDienst.Bildposten>(posten: T[], istFigur: (p: T) => boolean) =>
        bildlageDienst.bilderAusKatalog(k, posten, istFigur),
      loescheVerfallene: mit(k)(bildbedarfDienst.loescheVerfallene),
      katalogBilderVormerken: mit(k)(bildbedarfDienst.katalogBilderVormerken),
      offenerBildbedarf: mit(k)(bildbedarfDienst.offenerBildbedarf),
      leereBildbedarf: mit(k)(bildbedarfDienst.leereBildbedarf),
      bildbedarfAnstossen: mit(k)(bildbedarfDienst.bildbedarfAnstossen),
      merkeGebraucht: mit(k)(bildbedarfDienst.merkeGebraucht),
      bildEinmalVormerken: mit(k)(bildbedarfDienst.bildEinmalVormerken),
      bildbedarfAbarbeiten: mit(k)(bildbedarfLauf.bildbedarfAbarbeiten),
      initImageQueue: mit(k)(bildbedarfLauf.initImageQueue),
      stoppeBildbedarf: mit(k)(bildbedarfLauf.stoppeBildbedarf),
      // Über die Nacharbeit, damit ein Test sie an einer Stelle ersetzt.
      bildVormerken: (url: string, setNummer: string) => k.nacharbeit.bildVormerken(url, setNummer),
      // Beim Aufruf nachgeschlagen: Ein Test ersetzt Teile des Bildwerks nach dem Bau.
      setBildLaden: (...a: Parameters<Bildwerk['setBildLaden']>) => k.bildwerk.setBildLaden(...a),
      vorschauErzeugen: (relPfad: string) => k.bildwerk.vorschauErzeugen(relPfad),
      vergissFehlend: mit(k)(imageMisses.vergissFehlend),
      initImageMisses: mit(k)(imageMisses.initImageMisses),
      stoppeFehlanzeige: mit(k)(imageMisses.stoppeFehlanzeige),
      istBekanntFehlend: mit(k)(imageMisses.istBekanntFehlend),
      merkeFehlend: mit(k)(imageMisses.merkeFehlend),
      anleitungFreigegeben: mit(k)(bildBlickfeldDienst.anleitungFreigegeben),
      setNummerImBlickfeld: mit(k)(bildBlickfeldDienst.setNummerImBlickfeld),
      cdnFuerFehlendesBild: mit(k)(bildNachschlagen.cdnFuerFehlendesBild),
      queueThumb: mit(k)(proxyThumbs.queueThumb),
      cacheTreffer: mit(k)(imgCacheServe.cacheTreffer),
    }),
    einblick,
  );
}

export type BilderDienste = ReturnType<typeof erzeugeBilder>;
