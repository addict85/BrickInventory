import type { PoolClient } from 'pg';
import { pflegeTabelle } from '../../../db/tabellePflegen';
import { LOCKS } from '../../infra/lockNamespaces';
import { logAndContinue } from '../../infra/fehler';

/** Auf EINER Verbindung, weil Sitzungssperre, Schatten und Transaktion an ihr
 * hängen. Tabellen- und Spaltennamen kommen nur aus dem Quelltext. */

function sperrschluessel(tabelle: string): number {
  let h = 0;
  for (let i = 0; i < tabelle.length; i++) h = (Math.imul(h, 31) + tabelle.charCodeAt(i)) | 0;
  return h;
}

export async function sperreTabelle(c: PoolClient, tabelle: string): Promise<void> {
  // Ein laufender Tausch derselben Tabelle darf länger dauern als lock_timeout.
  await c.query('SET lock_timeout = 0');
  await c.query('SELECT pg_advisory_lock($1, $2)', [LOCKS.CSV_IMPORT, sperrschluessel(tabelle)]);
}

export async function gibTabelleFrei(c: PoolClient, tabelle: string): Promise<void> {
  await c.query('SELECT pg_advisory_unlock($1, $2)', [LOCKS.CSV_IMPORT, sperrschluessel(tabelle)]);
  await c.query('RESET lock_timeout');
}

/** Mit Schlüsseln und Indizes: ON CONFLICT in den Blöcken braucht sie. Ohne
 * CHECKs: Die Trigger der Zieltabelle (etwa die Versionsendung der Set-Nummer)
 * kommen nicht mit; geprüft wird erst beim Tausch, nach den Triggern. */
export async function legeSchattenAn(c: PoolClient, tabelle: string, schatten: string): Promise<void> {
  await c.query(`DROP TABLE IF EXISTS ${schatten}`);
  await c.query(`CREATE UNLOGGED TABLE ${schatten} (LIKE ${tabelle} INCLUDING ALL EXCLUDING CONSTRAINTS)`);
}

/** Ein abgewiesener Block bricht den Import ab. */
/** Schlüsselspalten: Eine doppelte Zeile im CSV überschreibt die frühere; 'ignorieren' behält sie. */
export type Konflikt = string[] | 'ignorieren';

function beiKonflikt(spalten: string[], k: Konflikt | undefined): string {
  if (!k) return '';
  if (k === 'ignorieren') return 'ON CONFLICT DO NOTHING';
  const rest = spalten.filter(s => !k.includes(s)).map(s => `${s}=EXCLUDED.${s}`);
  return `ON CONFLICT (${k.join(',')}) DO UPDATE SET ${rest.join(',')}`;
}

export async function fuegeBlockEin(c: PoolClient, schatten: string, spalten: string[], block: unknown[][], konflikt?: Konflikt): Promise<void> {
  const n = spalten.length;
  const platz = block.map((_, j) => '(' + spalten.map((_, k) => `$${j * n + k + 1}`).join(',') + ')').join(',');
  await c.query(`INSERT INTO ${schatten} (${spalten.join(',')}) VALUES ${platz} ${beiKonflikt(spalten, konflikt)}`, block.flat());
}

async function inTransaktion(c: PoolClient, schritte: () => Promise<void>): Promise<void> {
  await c.query('BEGIN');
  try {
    await schritte();
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(logAndContinue('csv-tausch:rollback'));
    throw e;
  }
}

export function tausche(c: PoolClient, tabelle: string, schatten: string, spalten: string[]): Promise<void> {
  return inTransaktion(c, async () => {
    await c.query(`DELETE FROM ${tabelle}`);
    await c.query(`INSERT INTO ${tabelle} (${spalten.join(',')}) SELECT ${spalten.join(',')} FROM ${schatten}`);
  });
}

/** rb_sets bildet den Dump nach: einfügen, ändern, entfernen. Nur ein Set, an dem
 * Bestand, Merkliste oder Preisalarm hängt, bleibt als 'api'-Zeile, sonst verlöre
 * ein Konto Name und Bild. Danach hat jede Zeile ihren set_catalog-Eintrag (0105). */
export async function gleicheSetsAb(c: PoolClient, schatten: string, spalten: string[]): Promise<void> {
  const neu = spalten.filter(s => s !== 'set_num');
  const verschwunden = `NOT EXISTS (SELECT 1 FROM ${schatten} n WHERE n.set_num = rb_sets.set_num)`;
  const bezug = `(EXISTS (SELECT 1 FROM sets s WHERE s.set_number = rb_sets.set_num)
               OR EXISTS (SELECT 1 FROM wanted w WHERE w.set_number = rb_sets.set_num)
               OR EXISTS (SELECT 1 FROM price_alerts a WHERE a.set_number = rb_sets.set_num))`;
  await inTransaktion(c, async () => {
    await c.query(`INSERT INTO rb_sets (${spalten.join(',')}, herkunft) SELECT ${spalten.join(',')}, 'csv' FROM ${schatten}
                   ON CONFLICT (set_num) DO UPDATE SET ${neu.map(s => `${s}=EXCLUDED.${s}`).join(',')}, herkunft='csv'
                   WHERE (${neu.map(s => `rb_sets.${s}`).join(',')}, rb_sets.herkunft)
                         IS DISTINCT FROM (${neu.map(s => `EXCLUDED.${s}`).join(',')}, 'csv')`);
    await c.query(`UPDATE rb_sets SET herkunft = 'api' WHERE herkunft = 'csv' AND ${verschwunden} AND ${bezug}`);
    // set_catalog geht per ON DELETE CASCADE mit.
    await c.query(`DELETE FROM rb_sets WHERE ${verschwunden} AND NOT ${bezug}`);
    await c.query(`INSERT INTO set_catalog (set_number) SELECT set_num FROM rb_sets WHERE set_num ~ '-[0-9]+$'
                   ON CONFLICT (set_number) DO NOTHING`);
  });
}

export async function entferneSchatten(c: PoolClient, schatten: string): Promise<void> {
  await c.query(`DROP TABLE IF EXISTS ${schatten}`);
}

/** Nach einem vollständigen Tausch ist die Planer-Statistik bedeutungslos. */
export function pflege(c: PoolClient, tabelle: string) {
  return pflegeTabelle(sql => c.query(sql), tabelle);
}
