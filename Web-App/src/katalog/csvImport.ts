/** In eine Schattentabelle schreiben und in einer Transaktion tauschen, damit
 * der Bestand bis dahin lesbar bleibt. */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import type { Pool } from 'pg';
import { istJa } from '../infra/validate';
import { logAndContinue } from '../infra/fehler';
import { DATA_DIR } from '../infra/appPaths';
import * as repo from './repository/csvTausch';

export type Meldung = { type: 'progress'; total: number; pct: number; filename: string };

const sp = (c: string[], i: number): string => c[i] ?? '';

// Verdoppeltes " bleibt ein Zeichen.
export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }   // "" → ein "
      else inQuotes = !inQuotes;
    }
    else if (c === ',' && !inQuotes) { result.push(cur); cur = ''; }
    else { cur += c; }
  }
  result.push(cur);
  return result;
}

/** Über den asynchronen Iterator: Er hält das Lesen zwischen den Blöcken an. */
async function streamInsert(tmpFile: string, chunkSize: number, mapRow: (spalten: string[]) => unknown[],
                            insertChunk: (chunk: unknown[][]) => Promise<void>, filename: string,
                            melde: (m: Meldung) => void) {
  const fileSize = fs.statSync(tmpFile).size;
  const input    = fs.createReadStream(tmpFile, { encoding: 'utf8', highWaterMark: 64 * 1024 });
  const rl       = readline.createInterface({ input, crlfDelay: Infinity });
  let headers: string[] | null = null, chunk: unknown[][] = [], total = 0, bytesRead = 0, lastPct = -1;
  input.on('data', (d: Buffer | string) => { bytesRead += Buffer.byteLength(d); });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    if (!headers) { headers = cols; continue; }
    chunk.push(mapRow(cols));
    total++;
    if (chunk.length >= chunkSize) {
      await insertChunk(chunk);
      chunk = [];
      const pct = Math.min(99, Math.round(bytesRead / fileSize * 100));
      if (pct !== lastPct) { lastPct = pct; melde({ type: 'progress', total, pct, filename }); }
    }
  }
  if (chunk.length > 0) await insertChunk(chunk);
  return total;
}

interface Tausch {
  tabelle: string; filename: string; tmp: string; cols: string[]; konflikt?: repo.Konflikt;
  chunkSize?: number; mapRow: (c: string[]) => unknown[];
}

// Über eine Schattentabelle: Leser sehen bis zum Tausch die alte, nie eine leere Tabelle.
async function importiereMitTausch(pool: Pool, melde: (m: Meldung) => void, t: Tausch): Promise<number> {
  const schatten = `${t.tabelle}_import`;
  const client = await pool.connect();
  try {
    await repo.sperreTabelle(client, t.tabelle);
    try {
      await repo.legeSchattenAn(client, t.tabelle, schatten);
      const total = await streamInsert(t.tmp, t.chunkSize ?? 100, t.mapRow,
        chunk => repo.fuegeBlockEin(client, schatten, t.cols, chunk, t.konflikt), t.filename, melde);
      // Eine leere Datei ist ein Fehler, kein leerer Katalog.
      if (total === 0) throw new Error(`${t.filename}: 0 Zeilen gelesen — Tausch abgebrochen, bisheriger Bestand bleibt erhalten`);
      await repo.tausche(client, t.tabelle, schatten, t.cols);
      await repo.entferneSchatten(client, schatten).catch(logAndContinue('csv-worker:query'));
      await repo.pflege(client, t.tabelle);
      return total;
    } finally {
      await repo.gibTabelleFrei(client, t.tabelle).catch(logAndContinue('csv-worker:lockKeyFor'));
    }
  } finally {
    client.release();
  }
}

export function katalogImporte(pool: Pool, melde: (m: Meldung) => void) {
  const tausch = (t: Tausch) => () => importiereMitTausch(pool, melde, t);
  return {
    colors: tausch({
      tabelle: 'rb_colors', filename: 'colors.csv.gz', tmp: path.join(DATA_DIR, 'colors.csv.tmp'),
      // bl_color_id kommt aus der API, nicht aus dem CSV — mitgeschrieben wäre sie
      // nach jedem Tausch leer.
      cols: ['id', 'name', 'rgb', 'is_trans'],
      konflikt: ['id'],
      mapRow: c => [parseInt(sp(c, 0)) || 0, sp(c, 1), sp(c, 2), istJa(sp(c, 3))],
    }),
    part_categories: tausch({
      tabelle: 'rb_part_categories', filename: 'part_categories.csv.gz', tmp: path.join(DATA_DIR, 'part_categories.csv.tmp'),
      cols: ['id', 'name'],
      konflikt: ['id'],
      mapRow: c => [parseInt(sp(c, 0)) || 0, sp(c, 1)],
    }),
    parts: tausch({
      tabelle: 'rb_parts', filename: 'parts.csv.gz', tmp: path.join(DATA_DIR, 'parts.csv.tmp'),
      cols: ['part_num', 'name', 'part_cat_id', 'part_img_url'],
      konflikt: ['part_num'],
      mapRow: c => [sp(c, 0), sp(c, 1), parseInt(sp(c, 2)) || 0, sp(c, 4)],
    }),
    sets: tausch({
      tabelle: 'rb_sets', filename: 'sets.csv.gz', tmp: path.join(DATA_DIR, 'sets.csv.tmp'),
      cols: ['set_num', 'name', 'year', 'theme_id', 'num_parts', 'set_img_url'],
      konflikt: ['set_num'],
      mapRow: c => [sp(c, 0), sp(c, 1), parseInt(sp(c, 2)) || 0, parseInt(sp(c, 3)) || 0, parseInt(sp(c, 4)) || 0, sp(c, 5)],
    }),
    inventories: tausch({
      tabelle: 'rb_inventories', filename: 'inventories.csv.gz', tmp: path.join(DATA_DIR, 'inventories.csv.tmp'),
      cols: ['id', 'set_num', 'version'],
      konflikt: ['id'],
      mapRow: c => [parseInt(sp(c, 0)) || 0, sp(c, 2), parseInt(sp(c, 1)) || 1],
    }),
    themes: tausch({
      tabelle: 'rb_themes', filename: 'themes.csv.gz', tmp: path.join(DATA_DIR, 'themes.csv.tmp'),
      cols: ['id', 'name', 'parent_id'],
      konflikt: ['id'],
      mapRow: c => [parseInt(sp(c, 0)) || 0, sp(c, 1), sp(c, 2) ? (parseInt(sp(c, 2)) || null) : null],
    }),
    inventory_minifigs: tausch({
      tabelle: 'rb_inventory_minifigs', filename: 'inventory_minifigs.csv.gz', tmp: path.join(DATA_DIR, 'inventory_minifigs.csv.tmp'),
      cols: ['inventory_id', 'fig_num', 'quantity'],
      konflikt: 'ignorieren',
      mapRow: c => [parseInt(sp(c, 0)) || 0, sp(c, 1), parseInt(sp(c, 2)) || 1],
    }),
    inventory_parts: tausch({
      tabelle: 'rb_inventory_parts', filename: 'inventory_parts.csv.gz', tmp: path.join(DATA_DIR, 'inventory_parts.csv.tmp'),
      cols: ['inventory_id', 'part_num', 'color_id', 'quantity', 'is_spare', 'img_url'],
      chunkSize: 50,
      // istJa(): eine Lesart für 't', 'True', '1' …
      mapRow: c => [parseInt(sp(c, 0)) || 0, sp(c, 1), parseInt(sp(c, 2)) || 0, parseInt(sp(c, 3)) || 1,
                    istJa(sp(c, 4)), sp(c, 5)],
    }),
  };
}
