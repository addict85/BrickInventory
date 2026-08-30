'use strict';
const fs       = require('fs');
// Pfade zentral auflösen — __dirname zeigt seit dem dist/-Build nicht mehr
// auf die Wurzel. Siehe utils/appPaths.ts.
const { APP_ROOT, DATA_DIR, PUBLIC_DIR } = require('../utils/appPaths');
const path     = require('path');
const { Pool } = require('pg');

/**
 * Nachricht an den Elternprozess.
 *
 * `process.send` gibt es nur, wenn der Prozess MIT IPC-Kanal geforkt wurde.
 * Dieser Worker wird ausschliesslich per fork() aus jobs/rebrickableCsvSync.ts
 * gestartet, der Kanal ist also da — aber TypeScript kann das nicht wissen, und
 * ein `process.send!` würde die Annahme nur unsichtbar machen.
 *
 * Der Helfer prüft stattdessen einmal. Fehlt der Kanal (jemand startet die
 * Datei direkt zum Ausprobieren), geht die Meldung nach stderr statt den
 * Prozess mit einem TypeError abzubrechen.
 *
 * @param {any} msg
 */
function send(msg: any) {
  if (typeof process.send === 'function') process.send(msg);
  else console.error('[csv-worker] kein IPC-Kanal — Meldung verworfen:', JSON.stringify(msg).slice(0, 200));
}

const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host:     process.env.PGHOST     || 'postgres',
        port:     parseInt(process.env.PGPORT || '5432'),
        user:     process.env.PGUSER     || 'brickinv',
        password: process.env.PGPASSWORD || 'brickinv',
        database: process.env.PGDATABASE || 'brickinv'
      }
);

const CSV_CACHE_DIR = path.join(DATA_DIR, 'csv_cache');

/**
 * Eine CSV-Zeile in Felder zerlegen.
 *
 * Verdoppelte Anführungszeichen ("" innerhalb eines Feldes) sind die
 * CSV-Schreibweise für EIN Anführungszeichen. Vorher wurde bei jedem " nur der
 * Zustand umgeschaltet und das Zeichen verworfen: Aus `3 "Zoll"` wurde
 * `3 Zoll`. Kommas in Anführungszeichen waren nie betroffen, deshalb ist es
 * lange nicht aufgefallen — es traf nur die Zeichen selbst, in Teile- und
 * Setnamen mit Zollangaben oder Zitaten.
 */
function parseCsvLine(line: string) {
  const result: any[] = [];
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

/**
 * Process CSV file truly line-by-line using async iteration.
 * Node.js readline async iterator respects backpressure natively —
 * no pause/resume, no promise chains, minimal buffer.
 */
async function streamInsert(tmpFile: string, chunkSize: number,
                            mapRow: (spalten: string[]) => unknown[],
                            insertChunk: (chunk: unknown[][]) => Promise<unknown>,
                            filename: string) {
  const fileSize = fs.statSync(tmpFile).size;
  const input    = fs.createReadStream(tmpFile, { encoding: 'utf8', highWaterMark: 64 * 1024 });
  const rl       = require('readline').createInterface({ input, crlfDelay: Infinity });

  let headers: string[] | null = null, chunk: any[] = [], total = 0, bytesRead = 0, lastPct = -1;

  // Track bytes via the underlying stream
  input.on('data', (d: Buffer | string) => { bytesRead += Buffer.byteLength(d); });

  // Async iterator — Node.js pauses reading automatically between iterations
  for await (const line of rl) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    if (!headers) { headers = cols; continue; }
    const row = mapRow(cols);
    if (!row) continue;
    chunk.push(row);
    total++;

    if (chunk.length >= chunkSize) {
      await insertChunk(chunk);
      chunk = [];
      const pct = Math.min(99, Math.round(bytesRead / fileSize * 100));
      if (pct !== lastPct) {
        lastPct = pct;
        send({ type: 'progress', total, pct, filename });
      }
    }
  }

  // Flush remaining
  if (chunk.length > 0) await insertChunk(chunk);
  return total;
}

function mkInsert(table: string, cols: string[], onConflict: string) {
  const n = cols.length;
  return async (client: { query(sql: string, params?: unknown[]): Promise<unknown> }, chunk: unknown[][]) => {
    const ph = chunk.map((_: unknown, j: number) =>
      '(' + cols.map((_: string, k: number) => `$${j * n + k + 1}`).join(',') + ')'
    ).join(',');
    // KEIN .catch(() => {}) mehr: Ein abgewiesener Block verlor bis zu 100
    // Zeilen, der Import meldete trotzdem Erfolg und der Tagesmarker wurde
    // gesetzt — der Katalog war dann still unvollständig, bis jemandem
    // fehlende Teile auffielen. Jetzt bricht der Task ab, der Elternprozess
    // erfährt davon, und der Tagesmarker bleibt ungesetzt.
    await client.query(
      `INSERT INTO ${table} (${cols.join(',')}) VALUES ${ph} ${onConflict}`,
      chunk.flat()
    );
  };
}

/**
 * Sperrschlüssel für den Katalog-Import.
 *
 * Belegt sind (Liste gepflegt in jobs/instructionQueue.ts): 42 Bild-Download
 * je Set, 55 Preislauf, 56 Anleitungs-Warteschlange, 57 fehlende Bilder neu
 * laden, 77 Teile-Zusammenfassung, 11223344 Brickset-Retry, 99999999
 * Start-Orchestrierung, Benutzer-ID als Namensraum in utils/txLock.ts.
 * 58 ist frei.
 *
 * (Nachtrag 29 vergab hier zunächst irrtümlich die 56, also den Schlüssel der
 * Anleitungs-Warteschlange. Praktisch kollidierte das nicht — die
 * Warteschlange nimmt (56, 0), der Import (56, Tabellen-Hash), und keiner der
 * acht Katalog-Tabellennamen hasht auf 0; nachgemessen. Verlassen sollte man
 * sich darauf nicht: Ein neuer Tabellenname könnte den Import künftig hinter
 * der Warteschlange blockieren, und der Fehler wäre kaum auffindbar.)
 *
 * Der zweite Wert von pg_advisory_lock(a, b) ist eine Zahl aus dem
 * Tabellennamen: Verschiedene Tabellen dürfen weiterhin parallel importiert
 * werden, dieselbe Tabelle nicht zweimal gleichzeitig.
 */
const { LOCKS } = require('../utils/lockNamespaces');
const CSV_IMPORT_LOCK = LOCKS.CSV_IMPORT;

/** Tabellenname → stabile 32-Bit-Zahl für den zweiten Sperrschlüssel. */
function lockKeyFor(tabelle: string): number {
  let h = 0;
  for (let i = 0; i < tabelle.length; i++) h = (Math.imul(h, 31) + tabelle.charCodeAt(i)) | 0;
  return h;
}

/**
 * Einen Katalog-Import durchführen, OHNE die Tabelle währenddessen zu leeren.
 *
 * ── Warum der Umweg über eine Schattentabelle ───────────────────────────────
 * Vorher stand am Anfang jedes Imports ein TRUNCATE/DELETE ohne Transaktion,
 * danach liefen minutenlang die Chunk-Inserts (rb_inventory_parts: rund 1,5
 * Mio. Zeilen). Jede andere Verbindung sah in dieser Zeit eine LEERE Tabelle —
 * mit zwei Verbindungen gegen echtes Postgres nachgestellt, der Leser bekam
 * sofort 0 Zeilen. Für die Anwendung heisst das: Sets ohne Teile, fehlende
 * Farb- und Teilenamen, und zwar täglich. Brach der Import mittendrin ab,
 * blieb die Tabelle bis zum nächsten Tageslauf unvollständig.
 *
 * Der naheliegende Griff — einfach eine Transaktion drumherum — macht es
 * schlimmer: TRUNCATE nimmt eine ACCESS-EXCLUSIVE-Sperre, Leser blockieren
 * dann für die volle Importdauer statt kurz falsche Daten zu sehen (ebenfalls
 * nachgestellt: die Leseabfrage hing).
 *
 * Deshalb: Neue Daten zuerst vollständig in eine Schattentabelle laden (ohne
 * WAL-Aufwand, UNLOGGED), und erst danach in EINER Transaktion umschwenken.
 * Das DELETE dort nimmt nur Zeilensperren — dank MVCC sehen Leser bis zum
 * COMMIT den alten, vollständigen Bestand und danach den neuen. Nie einen
 * leeren.
 *
 * Zusätzlich die Plausibilitätsbremse: 0 Zeilen bedeutet abgebrochener
 * Download oder kaputte Datei — dann bleibt der alte Bestand stehen, statt
 * durch nichts ersetzt zu werden.
 *
 * ── Warum die Sperre (Nachtrag 29) ──────────────────────────────────────────
 * Der Name der Schattentabelle leitet sich allein vom Tabellennamen ab, ist
 * also für ALLE Läufe derselbe. Zwei gleichzeitige Importe derselben Tabelle
 * sind möglich: Der Tageslauf ruft csvSync.run(), und ein Admin kann parallel
 * /admin/trigger-csv-sync auslösen — der Riegel `_csvSyncRunning` in server.ts
 * schützt nur den manuellen Weg gegen sich selbst, nicht gegen den Tageslauf,
 * und liegt ohnehin im Speicher EINES Prozesses.
 *
 * Nachgestellt gegen echtes Postgres 16: Starten beide gleichzeitig, scheitert
 * einer beim CREATE mit „duplicate key value violates unique constraint
 * pg_type_typname_nsp_index" — einem Fehler, der nichts über die Ursache
 * verrät. In csvSync.run() bricht das den ganzen Durchgang ab (`return`), der
 * Tagesmarker bleibt ungesetzt und die anschliessenden Schritte entfallen.
 * Die DATEN bleiben dabei heil — das Tausch-Verfahren oben trägt auch diesen
 * Fall, ebenfalls nachgestellt (versetzter Start, unterscheidbare Daten: der
 * Endbestand entsprach genau einem Lauf, nie einer Mischung).
 *
 * pg_advisory_lock statt pg_try_advisory_lock: Der zweite Lauf soll WARTEN und
 * danach sauber durchlaufen, nicht ausfallen. Die Sperre hängt an einer
 * eigenen Verbindung und fällt weg, sobald diese zurückgeht — auch wenn der
 * Prozess abstürzt.
 */
async function importiereMitTausch(opts: any) {
  const { tabelle, cols, onConflict = '', tmp, chunkSize = 100, mapRow, filename } = opts;
  const schatten = `${tabelle}_import`;
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1, $2)', [CSV_IMPORT_LOCK, lockKeyFor(tabelle)]);
    try {
      return await importiereMitTauschIntern(client, { tabelle, schatten, cols, onConflict, tmp, chunkSize, mapRow, filename });
    } finally {
      await client.query('SELECT pg_advisory_unlock($1, $2)', [CSV_IMPORT_LOCK, lockKeyFor(tabelle)]).catch(() => {});
    }
  } finally {
    client.release();
  }
}

async function importiereMitTauschIntern(client: any, opts: any) {
  const { tabelle, schatten, cols, onConflict, tmp, chunkSize, mapRow, filename } = opts;
  {
    await client.query(`DROP TABLE IF EXISTS ${schatten}`);
    // INCLUDING ALL übernimmt Schlüssel und Indizes — ON CONFLICT in den
    // Chunk-Inserts braucht sie. Die Originaltabelle bleibt bestehen, deshalb
    // ist auch die von den Vorgabewerten benutzte Sequenz weiterhin gültig.
    await client.query(`CREATE UNLOGGED TABLE ${schatten} (LIKE ${tabelle} INCLUDING ALL)`);

    const ins = mkInsert(schatten, cols, onConflict);
    const total = await streamInsert(tmp, chunkSize, mapRow, (chunk: unknown[][]) => ins(client, chunk), filename);

    if (total === 0) {
      throw new Error(`${filename}: 0 Zeilen gelesen — Tausch abgebrochen, bisheriger Bestand bleibt erhalten`);
    }

    await client.query('BEGIN');
    try {
      await client.query(`DELETE FROM ${tabelle}`);
      await client.query(
        `INSERT INTO ${tabelle} (${cols.join(',')}) SELECT ${cols.join(',')} FROM ${schatten}`
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    }
    await client.query(`DROP TABLE IF EXISTS ${schatten}`).catch(() => {});
    return total;
  }
}

const TASKS = {
  colors: () => importiereMitTausch({
    tabelle: 'rb_colors', filename: 'colors.csv.gz',
    tmp: path.join(DATA_DIR, 'colors.csv.tmp'),
    // colors.csv hat nur vier Spalten: id, name, rgb, is_trans.
    // bl_color_id steht NICHT im CSV — die kommt allein aus der Rebrickable-API.
    // Deshalb hier ausdrücklich nicht mitschreiben, sonst wäre sie nach jedem
    // Tausch leer.
    cols: ['id','name','rgb','is_trans'],
    onConflict: 'ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,rgb=EXCLUDED.rgb,is_trans=EXCLUDED.is_trans',
    mapRow: (c: string[]) => [parseInt(c[0])||0, c[1]||'', c[2]||'', c[3]||'f'],
  }),

  part_categories: () => importiereMitTausch({
    tabelle: 'rb_part_categories', filename: 'part_categories.csv.gz',
    tmp: path.join(DATA_DIR, 'part_categories.csv.tmp'),
    cols: ['id','name'],
    onConflict: 'ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name',
    mapRow: (c: string[]) => [parseInt(c[0])||0, c[1]||''],
  }),

  parts: () => importiereMitTausch({
    tabelle: 'rb_parts', filename: 'parts.csv.gz',
    tmp: path.join(DATA_DIR, 'parts.csv.tmp'),
    // parts.csv: part_num,name,part_cat_id,part_url,part_img_url,print_of
    cols: ['part_num','name','part_cat_id','part_img_url'],
    onConflict: 'ON CONFLICT (part_num) DO UPDATE SET name=EXCLUDED.name,part_cat_id=EXCLUDED.part_cat_id,part_img_url=EXCLUDED.part_img_url',
    mapRow: (c: string[]) => [c[0]||'', c[1]||'', parseInt(c[2])||0, c[4]||''],
  }),

  sets: () => importiereMitTausch({
    tabelle: 'rb_sets', filename: 'sets.csv.gz',
    tmp: path.join(DATA_DIR, 'sets.csv.tmp'),
    cols: ['set_num','name','year','theme_id','num_parts','set_img_url'],
    onConflict: 'ON CONFLICT (set_num) DO UPDATE SET name=EXCLUDED.name,year=EXCLUDED.year,theme_id=EXCLUDED.theme_id,num_parts=EXCLUDED.num_parts,set_img_url=EXCLUDED.set_img_url',
    mapRow: (c: string[]) => [c[0]||'', c[1]||'', parseInt(c[2])||0, parseInt(c[3])||0, parseInt(c[4])||0, c[5]||''],
  }),

  inventories: () => importiereMitTausch({
    tabelle: 'rb_inventories', filename: 'inventories.csv.gz',
    tmp: path.join(DATA_DIR, 'inventories.csv.tmp'),
    // inventories.csv: id,version,set_num
    cols: ['id','set_num','version'],
    onConflict: 'ON CONFLICT (id) DO UPDATE SET set_num=EXCLUDED.set_num,version=EXCLUDED.version',
    mapRow: (c: string[]) => [parseInt(c[0])||0, c[2]||'', parseInt(c[1])||1],
  }),

  themes: () => importiereMitTausch({
    tabelle: 'rb_themes', filename: 'themes.csv.gz',
    tmp: path.join(DATA_DIR, 'themes.csv.tmp'),
    // themes.csv: id,name,parent_id (parent_id kann leer sein)
    cols: ['id','name','parent_id'],
    onConflict: 'ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,parent_id=EXCLUDED.parent_id',
    mapRow: (c: string[]) => [parseInt(c[0])||0, c[1]||'', c[2] ? (parseInt(c[2])||null) : null],
  }),

  inventory_minifigs: () => importiereMitTausch({
    tabelle: 'rb_inventory_minifigs', filename: 'inventory_minifigs.csv.gz',
    tmp: path.join(DATA_DIR, 'inventory_minifigs.csv.tmp'),
    // inventory_minifigs.csv: inventory_id,fig_num,quantity
    cols: ['inventory_id','fig_num','quantity'],
    onConflict: 'ON CONFLICT DO NOTHING',
    mapRow: (c: string[]) => [parseInt(c[0])||0, c[1]||'', parseInt(c[2])||1],
  }),

  inventory_parts: () => importiereMitTausch({
    tabelle: 'rb_inventory_parts', filename: 'inventory_parts.csv.gz',
    tmp: path.join(DATA_DIR, 'inventory_parts.csv.tmp'),
    cols: ['inventory_id','part_num','color_id','quantity','is_spare','img_url'],
    chunkSize: 50,
    mapRow: (c: string[]) => [parseInt(c[0])||0, c[1]||'', parseInt(c[2])||0, parseInt(c[3])||1,
                  (c[4]==='True'||c[4]==='t'||c[4]==='1')?'t':'f', c[5]||''],
  }),
};

type Aufgabe = keyof typeof TASKS;

process.on('message', async (msg: any) => {
  // In .ts trägt der JSDoc-Typ nicht mehr — die Annotation steht jetzt direkt
  // am Parameter. Die Nachricht kommt aus dem Elternprozess (server.ts).
  const task: string = msg?.task;
  // Die Pruefung ist hier NICHT ueberfluessig, obwohl alle Aufrufer im
  // Elternprozess Literale uebergeben (rebrickableCsvSync.ts): Ein Typ traegt
  // nicht ueber die Prozessgrenze — was per IPC ankommt, prueft kein
  // Uebersetzer. Ohne sie waere `TASKS['constructor']()` ein Aufruf von
  // Object() : kein Absturz, sondern ein leeres Ergebnis, das als
  // erfolgreicher Import gemeldet wuerde und den Tagesmarker setzt.
  if (!Object.prototype.hasOwnProperty.call(TASKS, task)) {
    send({ type: 'error', task, error: `Unbekannte Aufgabe: ${task}` });
    await pool.end().catch(() => {});
    process.exit(1);
    return;
  }
  try {
    const total = await TASKS[task as Aufgabe]();
    send({ type: 'done', filename: task, total });
    send({ type: 'complete', task });
    await pool.end();
    process.exit(0);
  } catch(e) {
    send({ type: 'error', task, error: e.message });
    await pool.end().catch(() => {});
    process.exit(1);
  }
});

// TASKS und parseCsvLine werden exportiert, damit test/csv-import-db.test.js
// den Import gegen eine echte Datenbank fahren kann, statt nur den Quelltext
// zu lesen. Der Betrieb geht weiterhin ausschliesslich über den fork() oben.
export { TASKS, parseCsvLine };
