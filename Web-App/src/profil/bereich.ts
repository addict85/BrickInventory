/** Die Fabrik des Bereichs: Dienste als Closure über k (baueBereich, src/infra/bereich.ts). */
import { mit, baueBereich, type Einblick } from '../infra/bereich';
import { Faecher } from '../infra/zwischenspeicher';
import * as einrichtungStand from './einrichtungStand';
import * as indexHtml from './indexHtml';
import { zugang, type ProfilAbhaengigkeiten, type ProfilKontext } from './kontext';

export type { ProfilAbhaengigkeiten, ProfilKontext } from './kontext';

/** Profil, Startseite mit Design und Stand der Einrichtung: was ein Konto von sich sieht und ändert. */
export function erzeugeProfil(a: Omit<ProfilAbhaengigkeiten, 'faecher'>, einblick?: Einblick<ProfilKontext>) {
  return baueBereich(
    { ...a, faecher: new Faecher() },
    zugang,
    (k: ProfilKontext) => ({
      einrichtungStand: mit(k)(einrichtungStand.einrichtungStand),
      startseiteHtml: mit(k)(indexHtml.startseiteHtml),
      setzeGlobalesDesign: mit(k)(indexHtml.setzeGlobalesDesign),
    }),
    einblick,
  );
}

export type ProfilDienste = ReturnType<typeof erzeugeProfil>;
