/** Die Fabrik des Bereichs: Die Repositories nehmen den Zugang als ersten
 * Parameter; erzeugeKatalog bindet ihn einmal für alle, und die Dienste lesen und
 * schreiben nur über das Ergebnis (katalog(), prozess.ts). Wer eine eigene
 * Transaktion oder Sperrverbindung hält, ruft das Repository direkt damit auf. */
import type { Db } from '../../db/database';
import type { KatalogKontext } from './kontext';
import * as anleitungen from './repository/anleitungen';
import * as apiKontingent from './repository/apiKontingent';
import * as apiTakt from './repository/apiTakt';
import * as bildBlickfeld from './repository/bildBlickfeld';
import * as bildFehlschlaege from './repository/bildFehlschlaege';
import * as bildStammCdn from './repository/bildStammCdn';
import * as bildbedarf from './repository/bildbedarf';
import * as bildlage from './repository/bildlage';
import * as blZuordnung from './repository/blZuordnung';
import * as csvKatalog from './repository/csvKatalog';
import * as katalogCache from './repository/katalogCache';
import * as katalogStamm from './repository/katalogStamm';
import * as katalogSuche from './repository/katalogSuche';
import * as rebrickableCache from './repository/rebrickableCache';
import * as setInhalt from './repository/setInhalt';
import * as teileAnreicherung from './repository/teileAnreicherung';

/** Nur Funktionen, deren erster Parameter den Zugang nimmt, und zwar ohne ihn. */
type Gebunden<M> = {
  [K in keyof M as M[K] extends (db: Db, ...a: never[]) => unknown ? K : never]: M[K] extends (
    db: Db,
    ...a: infer A
  ) => infer R
    ? (...a: A) => R
    : never;
};

function bindeZugang<M extends object>(db: Db, modul: M): Gebunden<M> {
  const gebunden: Record<string, unknown> = {};
  for (const [name, f] of Object.entries(modul))
    if (typeof f === 'function')
      gebunden[name] = (...a: unknown[]) => (f as (db: Db, ...x: unknown[]) => unknown)(db, ...a);
  return gebunden as Gebunden<M>;
}

export function erzeugeKatalog(kk: KatalogKontext) {
  const { db } = kk;
  return {
    db,
    anleitungen: bindeZugang(db, anleitungen),
    apiKontingent: bindeZugang(db, apiKontingent),
    apiTakt: bindeZugang(db, apiTakt),
    bildBlickfeld: bindeZugang(db, bildBlickfeld),
    bildFehlschlaege: bindeZugang(db, bildFehlschlaege),
    bildStammCdn: bindeZugang(db, bildStammCdn),
    bildbedarf: bindeZugang(db, bildbedarf),
    bildlage: bindeZugang(db, bildlage),
    blZuordnung: bindeZugang(db, blZuordnung),
    csvKatalog: bindeZugang(db, csvKatalog),
    katalogCache: bindeZugang(db, katalogCache),
    katalogStamm: bindeZugang(db, katalogStamm),
    katalogSuche: bindeZugang(db, katalogSuche),
    rebrickableCache: bindeZugang(db, rebrickableCache),
    setInhalt: bindeZugang(db, setInhalt),
    teileAnreicherung: bindeZugang(db, teileAnreicherung),
  };
}

export type KatalogDienste = ReturnType<typeof erzeugeKatalog>;
