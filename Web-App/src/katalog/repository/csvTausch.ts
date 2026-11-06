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

/** Mit Schlüsseln und Indizes: ON CONFLICT in den Blöcken braucht sie. */
export async function legeSchattenAn(c: PoolClient, tabelle: string, schatten: string): Promise<void> {
  await c.query(`DROP TABLE IF EXISTS ${schatten}`);
  await c.query(`CREATE UNLOGGED TABLE ${schatten} (LIKE ${tabelle} INCLUDING ALL)`);
}

/** Ein abgewiesener Block bricht den Import ab. */
export async function fuegeBlockEin(c: PoolClient, schatten: string, spalten: string[], block: unknown[][], beiKonflikt: string): Promise<void> {
  const n = spalten.length;
  const platz = block.map((_, j) => '(' + spalten.map((_, k) => `$${j * n + k + 1}`).join(',') + ')').join(',');
  await c.query(`INSERT INTO ${schatten} (${spalten.join(',')}) VALUES ${platz} ${beiKonflikt}`, block.flat());
}

export async function tausche(c: PoolClient, tabelle: string, schatten: string, spalten: string[]): Promise<void> {
  await c.query('BEGIN');
  try {
    await c.query(`DELETE FROM ${tabelle}`);
    await c.query(`INSERT INTO ${tabelle} (${spalten.join(',')}) SELECT ${spalten.join(',')} FROM ${schatten}`);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(logAndContinue('csv-tausch:rollback'));
    throw e;
  }
}

export async function entferneSchatten(c: PoolClient, schatten: string): Promise<void> {
  await c.query(`DROP TABLE IF EXISTS ${schatten}`);
}

/** Nach einem vollständigen Tausch ist die Planer-Statistik bedeutungslos. */
export function pflege(c: PoolClient, tabelle: string) {
  return pflegeTabelle(sql => c.query(sql), tabelle);
}
