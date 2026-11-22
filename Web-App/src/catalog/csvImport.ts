/** Write into a shadow table and swap in one transaction so that
 * the existing data stays readable until then. */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { dbConfigFromEnvironment, createDb, type Db } from '../../db/database';
import { databaseConnection, systemConnection } from '../infra/config';
import { isJa } from '../infra/validate';
import { logAndContinue } from '../infra/error';
import { DATA_DIR } from '../infra/appPaths';
import * as repo from './repository/csvSwap';
import type { CatalogReadContract } from './readContract';

export type Message = { type: 'progress'; total: number; pct: number; filename: string };

const sp = (c: string[], i: number): string => c[i] ?? '';

// A doubled " remains one character.
export function csvRow(line: string): string[] {
  const result: string[] = [];
  let cur = '',
    inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } // "" → one "
      else inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      result.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

/** Via the async iterator: it pauses reading between the chunks. */
async function streamInsert(
  tmpFile: string,
  chunkSize: number,
  mapRow: (columns: string[]) => unknown[],
  insertChunk: (chunk: unknown[][]) => Promise<void>,
  filename: string,
  report: (m: Message) => void,
) {
  const fileSize = fs.statSync(tmpFile).size;
  const input = fs.createReadStream(tmpFile, { encoding: 'utf8', highWaterMark: 64 * 1024 });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  let headers: string[] | null = null,
    chunk: unknown[][] = [],
    total = 0,
    bytesRead = 0,
    lastPct = -1;
  input.on('data', (d: Buffer | string) => {
    bytesRead += Buffer.byteLength(d);
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const cols = csvRow(line);
    if (!headers) {
      headers = cols;
      continue;
    }
    chunk.push(mapRow(cols));
    total++;
    if (chunk.length >= chunkSize) {
      await insertChunk(chunk);
      chunk = [];
      const pct = Math.min(99, Math.round((bytesRead / fileSize) * 100));
      if (pct !== lastPct) {
        lastPct = pct;
        report({ type: 'progress', total, pct, filename });
      }
    }
  }
  if (chunk.length > 0) await insertChunk(chunk);
  return total;
}

interface Swap {
  tabelle: repo.CsvTable;
  filename: string;
  tmp: string;
  cols: string[];
  konflikt?: repo.Conflict;
  chunkSize?: number;
  mapRow: (c: string[]) => unknown[];
  /** Instead of the swap; rb_sets reconciles via upsert. */
  reconcile?: typeof repo.swap;
}

// Via a shadow table: readers see the old one until the swap, never an empty table.
async function importWithSwap(pool: Db['systemPool'], report: (m: Message) => void, t: Swap): Promise<number> {
  const shadow = `${t.tabelle}_import`;
  const client = await pool.connect();
  try {
    await repo.lockTable(client, t.tabelle);
    try {
      await repo.createShadow(client, t.tabelle, shadow);
      const total = await streamInsert(
        t.tmp,
        t.chunkSize ?? 100,
        t.mapRow,
        chunk => repo.addBlockOne(client, shadow, t.cols, chunk, t.konflikt),
        t.filename,
        report,
      );
      // An empty file is an error, not an empty catalog.
      if (total === 0)
        throw new Error(`${t.filename}: 0 Zeilen gelesen — Tausch abgebrochen, bisheriger Bestand bleibt erhalten`);
      await (t.reconcile ?? repo.swap)(client, t.tabelle, shadow, t.cols);
      await repo.removeShadow(client, shadow).catch(logAndContinue('csv-worker:query'));
      await repo.maintenance(client, t.tabelle);
      return total;
    } finally {
      await repo.giveTableFree(client, t.tabelle).catch(logAndContinue('csv-worker:lockKeyFor'));
    }
  } finally {
    client.release();
  }
}

/** The import process's access, without the server's deadlines: swapping a large
 * catalog table takes longer than a request. Even without a system role, the system access is a
 * pool of its own without a pipeline, like this process's raw pool before. */
export function createImportAccess(): Db {
  return createDb({
    ...dbConfigFromEnvironment(),
    pool: { max: 2 },
    system: systemConnection() ?? databaseConnection(),
  });
}

export function createCatalogImports(
  db: Pick<Db, 'systemPool'>,
  report: (m: Message) => void,
  l: Pick<CatalogReadContract, 'setZaehlt'>,
) {
  // Reconciling rb_sets asks whether any account holds a set: across account boundaries, so
  // as system role; without an account the runtime role would see no row and delete it.
  const pool = db.systemPool;
  const swap = (t: Swap) => () => importWithSwap(pool, report, t);
  return {
    colors: swap({
      tabelle: 'rb_colors',
      filename: 'colors.csv.gz',
      tmp: path.join(DATA_DIR, 'colors.csv.tmp'),
      // bl_color_id comes from the API, not from the CSV — if written along, it would be
      // empty after every swap.
      cols: ['id', 'name', 'rgb', 'is_trans'],
      konflikt: ['id'],
      mapRow: c => [parseInt(sp(c, 0), 10) || 0, sp(c, 1), sp(c, 2), isJa(sp(c, 3))],
    }),
    part_categories: swap({
      tabelle: 'rb_part_categories',
      filename: 'part_categories.csv.gz',
      tmp: path.join(DATA_DIR, 'part_categories.csv.tmp'),
      cols: ['id', 'name'],
      konflikt: ['id'],
      mapRow: c => [parseInt(sp(c, 0), 10) || 0, sp(c, 1)],
    }),
    parts: swap({
      tabelle: 'rb_parts',
      filename: 'parts.csv.gz',
      tmp: path.join(DATA_DIR, 'parts.csv.tmp'),
      cols: ['part_num', 'name', 'part_cat_id', 'part_img_url'],
      konflikt: ['part_num'],
      mapRow: c => [sp(c, 0), sp(c, 1), parseInt(sp(c, 2), 10) || 0, sp(c, 4)],
    }),
    sets: swap({
      tabelle: 'rb_sets',
      filename: 'sets.csv.gz',
      tmp: path.join(DATA_DIR, 'sets.csv.tmp'),
      cols: ['set_num', 'name', 'year', 'theme_id', 'num_parts', 'set_img_url'],
      konflikt: ['set_num'],
      reconcile: (c, _table, shadow, cols) => repo.syncSets(c, l, shadow, cols),
      mapRow: c => [
        sp(c, 0),
        sp(c, 1),
        parseInt(sp(c, 2), 10) || 0,
        parseInt(sp(c, 3), 10) || 0,
        parseInt(sp(c, 4), 10) || 0,
        sp(c, 5),
      ],
    }),
    inventories: swap({
      tabelle: 'rb_inventories',
      filename: 'inventories.csv.gz',
      tmp: path.join(DATA_DIR, 'inventories.csv.tmp'),
      cols: ['id', 'set_num', 'version'],
      konflikt: ['id'],
      mapRow: c => [parseInt(sp(c, 0), 10) || 0, sp(c, 2), parseInt(sp(c, 1), 10) || 1],
    }),
    themes: swap({
      tabelle: 'rb_themes',
      filename: 'themes.csv.gz',
      tmp: path.join(DATA_DIR, 'themes.csv.tmp'),
      cols: ['id', 'name', 'parent_id'],
      konflikt: ['id'],
      mapRow: c => [parseInt(sp(c, 0), 10) || 0, sp(c, 1), sp(c, 2) ? parseInt(sp(c, 2), 10) || null : null],
    }),
    inventory_minifigs: swap({
      tabelle: 'rb_inventory_minifigs',
      filename: 'inventory_minifigs.csv.gz',
      tmp: path.join(DATA_DIR, 'inventory_minifigs.csv.tmp'),
      cols: ['inventory_id', 'fig_num', 'quantity'],
      konflikt: 'ignorieren',
      mapRow: c => [parseInt(sp(c, 0), 10) || 0, sp(c, 1), parseInt(sp(c, 2), 10) || 1],
    }),
    inventory_parts: swap({
      tabelle: 'rb_inventory_parts',
      filename: 'inventory_parts.csv.gz',
      tmp: path.join(DATA_DIR, 'inventory_parts.csv.tmp'),
      cols: ['inventory_id', 'part_num', 'color_id', 'quantity', 'is_spare', 'img_url'],
      chunkSize: 50,
      // isJa(): one interpretation for 't', 'True', '1' …
      mapRow: c => [
        parseInt(sp(c, 0), 10) || 0,
        sp(c, 1),
        parseInt(sp(c, 2), 10) || 0,
        parseInt(sp(c, 3), 10) || 1,
        isJa(sp(c, 4)),
        sp(c, 5),
      ],
    }),
  };
}
