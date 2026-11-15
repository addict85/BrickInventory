/** Die Fabrik des Bereichs: Dienste als Closure über k (baueBereich, src/infra/bereich.ts). */
import { mit, baueBereich, type Einblick } from '../infra/bereich';
import * as geheimnisAltbestand from './geheimnisAltbestand';
import * as passkeys from './passkeys';
import * as zweiterFaktor from './zweiterFaktor';
import { zugang, type FaktorenAbhaengigkeiten, type FaktorenKontext } from './kontext';

export type { FaktorenAbhaengigkeiten, FaktorenKontext } from './kontext';

/** Zweiter Faktor und Passkeys: eigene Tabellen, kein Konto. Wann sie gelten, entscheidet das Konto. */
export function erzeugeFaktoren(a: FaktorenAbhaengigkeiten, einblick?: Einblick<FaktorenKontext>) {
  return baueBereich(
    a,
    zugang,
    (k: FaktorenKontext) => ({
      istAktiv: mit(k)(zweiterFaktor.istAktiv),
      aktiveUnter: mit(k)(zweiterFaktor.aktiveUnter),
      stand: mit(k)(zweiterFaktor.stand),
      beginneEinrichtung: mit(k)(zweiterFaktor.beginneEinrichtung),
      bestaetigeEinrichtung: mit(k)(zweiterFaktor.bestaetigeEinrichtung),
      otpauthFuer: mit(k)(zweiterFaktor.otpauthFuer),
      pruefeCode: mit(k)(zweiterFaktor.pruefeCode),
      schalteAb: mit(k)(zweiterFaktor.schalteAb),
      erneuereCodes: mit(k)(zweiterFaktor.erneuereCodes),
      registrierungsOptionen: mit(k)(passkeys.registrierungsOptionen),
      registrierungPruefen: mit(k)(passkeys.registrierungPruefen),
      anmeldeOptionen: mit(k)(passkeys.anmeldeOptionen),
      anmeldungPruefen: mit(k)(passkeys.anmeldungPruefen),
      passkeysDesKontos: mit(k)(passkeys.passkeysDesKontos),
      hatPasskeys: mit(k)(passkeys.hatPasskeys),
      loeschePasskey: mit(k)(passkeys.loeschePasskey),
      passkeysWiderrufen: mit(k)(passkeys.passkeysWiderrufen),
      verschluesseleAltbestand: mit(k)(geheimnisAltbestand.verschluesseleAltbestand),
    }),
    einblick,
  );
}

export type FaktorenDienste = ReturnType<typeof erzeugeFaktoren>;
