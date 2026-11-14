/** Die Fabrik der Bilder. Ihr Zustand (Puffer, Warteschlangen, Zähler) liegt in den Fächern
 * dieses Satzes Dienste, nicht im Modul: Zwei Sätze in einem Prozess teilen nichts. */
import { baueKontext, bindeZugang, type Einblick } from '../infra/bereich';
import { Faecher } from '../infra/zwischenspeicher';
import * as bildlageDienst from './bildlage';
import * as bildbedarfDienst from './bildbedarf';
import * as bildbedarfLauf from './bildbedarfLauf';
import * as imageMisses from './imageMisses';
import * as bildBlickfeldDienst from './bildBlickfeld';
import * as bildNachschlagen from './bildNachschlagen';
import * as proxyThumbs from './proxyThumbs';
import * as imgCacheServe from './imgCacheServe';
import { downloadSetImage } from './setImages';
import { generateThumb } from './thumbs';
import { zugang, type Bildwerk, type BilderAbhaengigkeiten, type BilderKontext } from './kontext';

export type { Bildwerk, BilderAbhaengigkeiten, BilderKontext } from './kontext';

/** Ohne `bildwerk` das echte; ein Test gibt seines mit (startup/verdrahtung.ts baueDienste). */
export function erzeugeBilder(
  a: Omit<BilderAbhaengigkeiten, 'faecher' | 'bildwerk'> & { bildwerk?: Bildwerk | undefined },
  einblick?: Einblick<BilderKontext>,
) {
  const bildwerk = a.bildwerk ?? { setBildLaden: downloadSetImage, vorschauErzeugen: generateThumb };
  const k: BilderKontext = baueKontext({ ...a, bildwerk, faecher: new Faecher() }, zugang);
  einblick?.(k);
  return {
    ...bindeZugang(k, bildlageDienst, [
      'fuelleAusBrickset',
      'anleitungenNachtragen',
      'setBilderNachladen',
      'vorschaubilderNachtragen',
      'setBildLokalEintragen',
      'bilderFuerNachlauf',
    ]),
    bilderAusKatalog: <T extends bildlageDienst.Bildposten>(posten: T[], istFigur: (p: T) => boolean) =>
      bildlageDienst.bilderAusKatalog(k, posten, istFigur),
    ...bindeZugang(k, bildbedarfDienst, [
      'loescheVerfallene',
      'katalogBilderVormerken',
      'offenerBildbedarf',
      'leereBildbedarf',
      'bildbedarfAnstossen',
      'merkeGebraucht',
      'bildEinmalVormerken',
    ]),
    ...bindeZugang(k, bildbedarfLauf, ['bildbedarfAbarbeiten', 'initImageQueue', 'stoppeBildbedarf']),
    // Über die Nacharbeit, damit ein Test sie an einer Stelle ersetzt.
    bildVormerken: (url: string, setNummer: string) => k.nacharbeit.bildVormerken(url, setNummer),
    // Beim Aufruf nachgeschlagen: Ein Test ersetzt Teile des Bildwerks nach dem Bau.
    setBildLaden: (...a: Parameters<Bildwerk['setBildLaden']>) => k.bildwerk.setBildLaden(...a),
    vorschauErzeugen: (relPfad: string) => k.bildwerk.vorschauErzeugen(relPfad),
    ...bindeZugang(k, imageMisses, [
      'vergissFehlend',
      'initImageMisses',
      'stoppeFehlanzeige',
      'istBekanntFehlend',
      'merkeFehlend',
    ]),
    ...bindeZugang(k, bildBlickfeldDienst, ['anleitungFreigegeben', 'setNummerImBlickfeld']),
    ...bindeZugang(k, bildNachschlagen, ['cdnFuerFehlendesBild']),
    ...bindeZugang(k, proxyThumbs, ['queueThumb']),
    ...bindeZugang(k, imgCacheServe, ['cacheTreffer']),
  };
}

export type BilderDienste = ReturnType<typeof erzeugeBilder>;
