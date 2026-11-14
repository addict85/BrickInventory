/** Was die Dienste bekommen; getrennt von bereich.ts, damit kein Importzyklus entsteht. */
import type { Db } from '../../db/database';
import { mit, type Kontext } from '../infra/bereich';
import * as guthabenSchranke from './repository/guthabenSchranke';
import * as gutscheine from './repository/gutscheine';
import type { EinstellungenDienste } from '../einstellungen';
import type { KontoDienste } from '../konto';

export interface GutscheineAbhaengigkeiten {
  db: Db;
  einstellungen: EinstellungenDienste;
  konto: KontoDienste;
}

export const zugang = (db: Db) => ({
  guthabenSchranke: {
    oeffneSchranke: mit(db)(guthabenSchranke.oeffneSchranke),
    sperreSchranke: mit(db)(guthabenSchranke.sperreSchranke),
  },
  gutscheine: {
    guthabenMerken: mit(db)(gutscheine.guthabenMerken),
    gutschein: mit(db)(gutscheine.gutschein),
    gutscheinAendern: mit(db)(gutscheine.gutscheinAendern),
    gutscheinAnlegen: mit(db)(gutscheine.gutscheinAnlegen),
    gutscheinErsetzen: mit(db)(gutscheine.gutscheinErsetzen),
    gutscheinGesperrt: mit(db)(gutscheine.gutscheinGesperrt),
    gutscheinLoeschen: mit(db)(gutscheine.gutscheinLoeschen),
    gutscheinPdfMerken: mit(db)(gutscheine.gutscheinPdfMerken),
    gutscheineDesKontos: mit(db)(gutscheine.gutscheineDesKontos),
    gutscheineNeuVerschluesseln: mit(db)(gutscheine.gutscheineNeuVerschluesseln),
    kopienVerschluesseln: mit(db)(gutscheine.kopienVerschluesseln),
    nummernNachverschluesseln: mit(db)(gutscheine.nummernNachverschluesseln),
  },
});
export type GutscheineKontext = Kontext<GutscheineAbhaengigkeiten, ReturnType<typeof zugang>>;
