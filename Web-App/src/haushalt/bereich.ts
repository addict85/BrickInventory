/** Jeder Dienst nimmt den Kontext; Regeln ohne Datenbank stehen in regeln.ts. */
import { mit, baueBereich, type Einblick } from '../infra/bereich';
import { Faecher } from '../infra/zwischenspeicher';
import * as haushalt from './haushalt';
import { HAUSHALT_KANAL } from './regeln';
import { zugang, type HaushaltAbhaengigkeiten, type HaushaltKontext } from './kontext';

export type { HaushaltAbhaengigkeiten, HaushaltKontext } from './kontext';

export function erzeugeHaushalt(a: Omit<HaushaltAbhaengigkeiten, 'faecher'>, einblick?: Einblick<HaushaltKontext>) {
  return baueBereich(
    { ...a, faecher: new Faecher() },
    zugang,
    (k: HaushaltKontext) => ({
      meldeHaushaltsaenderung: mit(k)(haushalt.meldeHaushaltsaenderung),
      haushaltVon: mit(k)(haushalt.haushaltVon),
      darfSchreibenFuer: mit(k)(haushalt.darfSchreibenFuer),
      schreibbereich: mit(k)(haushalt.schreibbereich),
      haushaltsMitglieder: mit(k)(haushalt.haushaltsMitglieder),
      einladungAnlegen: mit(k)(haushalt.einladungAnlegen),
      pruefeEinladung: mit(k)(haushalt.pruefeEinladung),
      einladungEinloesen: mit(k)(haushalt.einladungEinloesen),
      kontenTrennen: mit(k)(haushalt.kontenTrennen),
      verwerfeGetrennt: mit(k)(haushalt.verwerfeGetrennt),
      haushaltsStand: mit(k)(haushalt.haushaltsStand),
      blickfeldIds: mit(k)(haushalt.blickfeldIds),
      blickfeldAus: mit(k)(haushalt.blickfeldAus),
      schreibbereichAus: mit(k)(haushalt.schreibbereichAus),
      siehtKonto: mit(k)(haushalt.siehtKonto),
      schreibziel: mit(k)(haushalt.schreibziel),
      schreibzielOderNull: mit(k)(haushalt.schreibzielOderNull),
      umzugsQuelle: mit(k)(haushalt.umzugsQuelle),
      besitzerAnhaengen: mit(k)(haushalt.besitzerAnhaengen),
      beiHaushaltsaenderung: mit(k)(haushalt.beiHaushaltsaenderung),
      leereHaushaltCache: mit(k)(haushalt.leereHaushaltCache),
      /** Web und Jobs halten je eigene Gedächtnisse; was der eine ändert, leert der andere hierüber. */
      horcheAufAenderungen: () => k.db.benachrichtigung.listen(HAUSHALT_KANAL, () => haushalt.leereHaushaltCache(k)),
    }),
    einblick,
  );
}

export type HaushaltDienste = ReturnType<typeof erzeugeHaushalt>;
