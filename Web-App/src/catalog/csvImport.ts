/** Write into a shadow table and swap, all in one transaction: readers keep seeing the
 * old rows until the COMMIT, and an abort at any point leaves them untouched. */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { dbConfigFromEnvironment, createDb, type Db } from '../../db/database';
import { databaseConnection, systemConnection } from '../infra/config';
import { isJa } from '../infra/validate';
import { inSystemContext } from '../infra/accountContext';
import { buildContext } from '../infra/area';
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
  table: repo.CsvTable;
  filename: string;
  tmp: string;
  cols: string[];
  conflict?: repo.Conflict;
  chunkSize?: number;
  mapRow: (c: string[]) => unknown[];
  /** Instead of the swap; rb_sets reconciles via upsert. */
  reconcile?: typeof repo.swap;
}

// One transaction holds the snapshot for the whole file (minutes for the largest table).
// That is the price for "old state or new state, nothing in between" without a session lock.
async function importWithSwap(db: Db, report: (m: Message) => void, s: Swap): Promise<number> {
  const shadow = `${s.table}_import`;
  const k = buildContext({ db }, () => ({}));
  // Reconciling rb_sets asks whether any account holds a set: across account boundaries, so
  // as system role; without an account the runtime role would see no row and delete it.
  const total = await inSystemContext('katalog-import', () =>
    k.transact(async t => {
      await repo.lockTable(t.db, s.table);
      await repo.createShadow(t.db, s.table, shadow);
      const n = await streamInsert(
        s.tmp,
        s.chunkSize ?? 100,
        s.mapRow,
        chunk => repo.addBlockOne(t.db, shadow, s.cols, chunk, s.conflict),
        s.filename,
        report,
      );
      // An empty file is an error, not an empty catalog.
      if (n === 0)
        throw new Error(`${s.filename}: 0 Zeilen gelesen — Tausch abgebrochen, bisheriger Bestand bleibt erhalten`);
      await (s.reconcile ?? repo.swap)(t.db, s.table, shadow, s.cols);
      return n;
    }),
  );
  await repo.maintenance(sql => db.systemPool.query(sql), s.table);
  return total;
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

export function createCatalogImports(db: Db, report: (m: Message) => void, l: Pick<CatalogReadContract, 'setCounts'>) {
  const swap = (t: Swap) => () => importWithSwap(db, report, t);
  return {
    colors: swap({
      table: 'rb_colors',
      filename: 'colors.csv.gz',
      tmp: path.join(DATA_DIR, 'colors.csv.tmp'),
      // bl_color_id comes from the API, not from the CSV — if written along, it would be
      // empty after every swap.
      cols: ['id', 'name', 'rgb', 'is_trans'],
      conflict: ['id'],
      mapRow: c => [parseInt(sp(c, 0), 10) || 0, sp(c, 1), sp(c, 2), isJa(sp(c, 3))],
    }),
    part_categories: swap({
      table: 'rb_part_categories',
      filename: 'part_categories.csv.gz',
      tmp: path.join(DATA_DIR, 'part_categories.csv.tmp'),
      cols: ['id', 'name'],
      conflict: ['id'],
      mapRow: c => [parseInt(sp(c, 0), 10) || 0, sp(c, 1)],
    }),
    parts: swap({
      table: 'rb_parts',
      filename: 'parts.csv.gz',
      tmp: path.join(DATA_DIR, 'parts.csv.tmp'),
      cols: ['part_num', 'name', 'part_cat_id', 'part_img_url'],
      conflict: ['part_num'],
      mapRow: c => [sp(c, 0), sp(c, 1), parseInt(sp(c, 2), 10) || 0, sp(c, 4)],
    }),
    sets: swap({
      table: 'rb_sets',
      filename: 'sets.csv.gz',
      tmp: path.join(DATA_DIR, 'sets.csv.tmp'),
      cols: ['set_num', 'name', 'year', 'theme_id', 'num_parts', 'set_img_url'],
      conflict: ['set_num'],
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
      table: 'rb_inventories',
      filename: 'inventories.csv.gz',
      tmp: path.join(DATA_DIR, 'inventories.csv.tmp'),
      cols: ['id', 'set_num', 'version'],
      conflict: ['id'],
      mapRow: c => [parseInt(sp(c, 0), 10) || 0, sp(c, 2), parseInt(sp(c, 1), 10) || 1],
    }),
    themes: swap({
      table: 'rb_themes',
      filename: 'themes.csv.gz',
      tmp: path.join(DATA_DIR, 'themes.csv.tmp'),
      cols: ['id', 'name', 'parent_id'],
      conflict: ['id'],
      mapRow: c => [parseInt(sp(c, 0), 10) || 0, sp(c, 1), sp(c, 2) ? parseInt(sp(c, 2), 10) || null : null],
    }),
    inventory_minifigs: swap({
      table: 'rb_inventory_minifigs',
      filename: 'inventory_minifigs.csv.gz',
      tmp: path.join(DATA_DIR, 'inventory_minifigs.csv.tmp'),
      cols: ['inventory_id', 'fig_num', 'quantity'],
      conflict: 'ignorieren',
      mapRow: c => [parseInt(sp(c, 0), 10) || 0, sp(c, 1), parseInt(sp(c, 2), 10) || 1],
    }),
    inventory_parts: swap({
      table: 'rb_inventory_parts',
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
