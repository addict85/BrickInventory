import type { PoolClient } from 'pg';
import { maintainTable } from '../../../db/tabellePflegen';
import type { CatalogReadContract } from '../readContract';
import { LOCKS } from '../../infra/lockNamespaces';
import { logAndContinue } from '../../infra/fehler';

/** Auf EINER Verbindung, weil Sitzungssperre, Schatten und Transaktion an ihr
 * hängen. Tabellen- und Spaltennamen kommen nur aus dem Quelltext. */

/** Nur diese Tabellen tauscht das Repository; ein anderer Name wirft, statt eine fremde zu leeren. */
export const CSV_TABLES = [
  'rb_colors',
  'rb_part_categories',
  'rb_parts',
  'rb_sets',
  'rb_inventories',
  'rb_themes',
  'rb_inventory_minifigs',
  'rb_inventory_parts',
] as const;
export type CsvTable = (typeof CSV_TABLES)[number];

function onlyCsvTable(tabelle: string): CsvTable {
  const t = CSV_TABLES.find(x => x === tabelle);
  if (!t) throw new Error(`keine CSV-Tabelle: ${tabelle}`);
  return t;
}

function sperrschluessel(tabelle: string): number {
  let h = 0;
  for (let i = 0; i < tabelle.length; i++) h = (Math.imul(h, 31) + tabelle.charCodeAt(i)) | 0;
  return h;
}

export async function lockTable(c: PoolClient, tabelle: string): Promise<void> {
  // Ein laufender Tausch derselben Tabelle darf länger dauern als lock_timeout.
  await c.query('SET lock_timeout = 0');
  await c.query('SELECT pg_advisory_lock($1, $2)', [LOCKS.CSV_IMPORT, sperrschluessel(tabelle)]);
}

export async function giveTableFree(c: PoolClient, tabelle: string): Promise<void> {
  await c.query('SELECT pg_advisory_unlock($1, $2)', [LOCKS.CSV_IMPORT, sperrschluessel(tabelle)]);
  await c.query('RESET lock_timeout');
}

/** Mit Schlüsseln (ON CONFLICT braucht sie), ohne CHECKs (geprüft wird beim Tausch, nach den
 * Triggern der Zieltabelle), temporär (die Laufzeitrolle darf in public nichts anlegen). */
export async function putShadowAn(c: PoolClient, tabelle: CsvTable, schatten: string): Promise<void> {
  await c.query(`DROP TABLE IF EXISTS pg_temp.${schatten}`);
  await c.query(`CREATE TEMP TABLE ${schatten} (LIKE ${onlyCsvTable(tabelle)} INCLUDING ALL EXCLUDING CONSTRAINTS)`);
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

export async function addBlockOne(
  c: PoolClient,
  schatten: string,
  spalten: string[],
  block: unknown[][],
  konflikt?: Konflikt,
): Promise<void> {
  const n = spalten.length;
  const platz = block.map((_, j) => '(' + spalten.map((_, k) => `$${j * n + k + 1}`).join(',') + ')').join(',');
  await c.query(
    `INSERT INTO ${schatten} (${spalten.join(',')}) VALUES ${platz} ${beiKonflikt(spalten, konflikt)}`,
    block.flat(),
  );
}

async function inStep(c: PoolClient, schritte: () => Promise<void>): Promise<void> {
  await c.query('BEGIN');
  try {
    await schritte();
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(logAndContinue('csv-tausch:rollback'));
    throw e;
  }
}

export function swap(c: PoolClient, tabelle: CsvTable, schatten: string, spalten: string[]): Promise<void> {
  const ziel = onlyCsvTable(tabelle);
  return inStep(c, async () => {
    await c.query(`DELETE FROM ${ziel}`);
    await c.query(`INSERT INTO ${ziel} (${spalten.join(',')}) SELECT ${spalten.join(',')} FROM ${schatten}`);
  });
}

/** rb_sets bildet den Dump nach: einfügen, ändern, entfernen. Nur ein Set, an dem
 * Bestand, Merkliste oder Preisalarm hängt, bleibt als 'api'-Zeile, sonst verlöre
 * ein Konto Name und Bild. Danach hat jede Zeile ihren set_catalog-Eintrag (0105). */
export async function sameSetsAb(
  c: PoolClient,
  l: Pick<CatalogReadContract, 'setZaehlt'>,
  schatten: string,
  spalten: string[],
): Promise<void> {
  const neu = spalten.filter(s => s !== 'set_num');
  const verschwunden = `NOT EXISTS (SELECT 1 FROM ${schatten} n WHERE n.set_num = rb_sets.set_num)`;
  const bezug = l.setZaehlt('rb_sets.set_num');
  await inStep(c, async () => {
    await c.query(`INSERT INTO rb_sets (${spalten.join(',')}, source) SELECT ${spalten.join(',')}, 'csv' FROM ${schatten}
                   ON CONFLICT (set_num) DO UPDATE SET ${neu.map(s => `${s}=EXCLUDED.${s}`).join(',')}, source='csv'
                   WHERE (${neu.map(s => `rb_sets.${s}`).join(',')}, rb_sets.source)
                         IS DISTINCT FROM (${neu.map(s => `EXCLUDED.${s}`).join(',')}, 'csv')`);
    await c.query(`UPDATE rb_sets SET source = 'api' WHERE source = 'csv' AND ${verschwunden} AND ${bezug}`);
    // set_catalog geht per ON DELETE CASCADE mit.
    await c.query(`DELETE FROM rb_sets WHERE ${verschwunden} AND NOT ${bezug}`);
    // Die Bildadresse des CSV gilt erst in set_catalog, der einzigen Bildquelle (0108).
    await c.query(`INSERT INTO set_catalog (set_number, image_url)
                   SELECT set_num, NULLIF(set_img_url, '') FROM rb_sets WHERE set_num ~ '-[0-9]+$'
                   ON CONFLICT (set_number) DO UPDATE SET image_url = EXCLUDED.image_url, updated_at = NOW()
                   WHERE set_catalog.image_url IS NULL AND EXCLUDED.image_url IS NOT NULL`);
  });
}

export async function removeShadow(c: PoolClient, schatten: string): Promise<void> {
  await c.query(`DROP TABLE IF EXISTS pg_temp.${schatten}`);
}

/** Nach einem vollständigen Tausch ist die Planer-Statistik bedeutungslos. */
export function pflege(c: PoolClient, tabelle: string) {
  return maintainTable(sql => c.query(sql), tabelle);
}
