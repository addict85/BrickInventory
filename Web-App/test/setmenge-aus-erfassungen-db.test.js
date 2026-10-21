/**
 * Die Stückzahl eines Sets steht nur noch in den Erfassungen.
 *
 * ── Marcos Frage ────────────────────────────────────────────────────────────
 *
 *   „Wieso hat Sets ebenfalls noch quantity?"
 *
 * Weil die Spalte eine zweite Kopie war. Die Ableitung aus den Erfassungen
 * stand bereits im Baum (routes/api_v1/acquisitions.ts, parentQuantitySql) —
 * daneben aber sieben Stellen, die die Spalte fortschrieben
 * (`quantity = quantity + $1`) oder setzten (`quantity = $1`).
 *
 * Und sie sind auseinandergelaufen. GEMESSEN am laufenden Server (der Befund
 * steht in utils/setService.ts): Zehn gleichzeitige Erfassungen desselben Sets
 * ergaben `sets.quantity = 10`, aber drei Erfassungszeilen mit Summe 7 — drei
 * Exemplare, die es laut der einen Tabelle gab und laut der anderen nicht.
 *
 * ── Marcos Entscheidung ─────────────────────────────────────────────────────
 *
 *   „Bitte doch Variante 1"
 *
 * Die Spalte fällt. Migration 0036 löscht sie; die Rechnung steht einmal, in
 * utils/bestandsmenge.ts, und wird von den Lesestellen eingesetzt.
 *
 * ── Was dieser Test prüft ───────────────────────────────────────────────────
 *
 *   1. Nach der GANZEN Migrationskette gibt es `sets.quantity` nicht mehr —
 *      und vorher gibt es sie, weil die Nachträge in 0032 und 0036 sie LESEN.
 *   2. Der Riegel greift, wenn eine Set-Zeile ihre Stückzahl verlieren würde.
 *      Mit GEGENPROBE: ohne Riegel läuft dieselbe Lage durch, und die
 *      Stückzahl ist weg.
 *   3. Der Riegel greift auch beim DRIFT — wenn Spalte und Erfassungssumme
 *      auseinanderliegen, entscheidet ein Mensch, nicht die Migration.
 *   4. Niemand SCHREIBT die Spalte mehr. (Dass niemand sie mehr liest, prüft
 *      nicht der Quelltext, sondern die Datenbank: Nach Punkt 1 ist jede
 *      verbliebene Lesestelle ein harter Fehler — siehe Punkt 5.)
 *   5. Die Lesewege liefern die Stückzahl weiter, aus den Erfassungen. Mit
 *      GEGENPROBE: Ändert sich eine Erfassung, folgt die Antwort.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL. Ohne DB: skip, ausser
 * REQUIRE_DB=1.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

// Dieselbe Begruendung wie in test/teilepreise-nur-erfassungen-db.test.js:
// Diese Datei baut die Datenbank mehrfach von null auf. Wer danach laeuft,
// muss sie vollstaendig vorfinden.
test.after(async () => {
  try {
    await db.run('DROP SCHEMA public CASCADE');
    await db.run('CREATE SCHEMA public');
    await db.initSchema();
    const c = await db.pool.connect();
    try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  } catch (e) {
    console.error('[setmenge-aus-erfassungen] Aufraeumen fehlgeschlagen:', e.message);
  }
  await db.pool.end().catch(() => {});
});

const spaltenVon = async (tabelle) => (await db.all(
  `SELECT column_name FROM information_schema.columns WHERE table_name=$1`, [tabelle]))
  .map(r => r.column_name).sort();

const dbDa = async (t) => {
  try { await db.run('SELECT 1'); return true; }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return false;
  }
};

const MIG_DIR = path.join(ROOT, 'db', 'migrations');
const DATEI   = path.join(MIG_DIR, '0036-setmenge-aus-erfassungen.sql');

/** Frische Datenbank, Schema, alle Migrationen. */
async function volleKette() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
}

test('nach der ganzen Kette trägt sets keine quantity mehr',
  { concurrency: 1 }, async (t) => {
  if (!(await dbDa(t))) return;

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();

  // ── Zwischenstand: der Selbstnachweis ────────────────────────────────────
  //
  // VOR den Migrationen muss die Spalte da sein, und das ist keine Formalie:
  // Der Nachtrag in Migration 0032 LIEST sie (er legt aus ihr die fehlenden
  // Erfassungen an), der Nachtrag in 0036 ebenso. Fehlte sie in db/schema.sql,
  // braeche die Kette beim ersten Start einer frischen Installation ab.
  //
  // Ohne diese Zusicherung saehe die Pruefung unten auch dann gruen aus, wenn
  // die Spalte nie existiert haette — und bewiese nichts.
  const vorher = await spaltenVon('sets');
  assert.ok(vorher.includes('quantity'),
    'sets.quantity fehlt schon vor den Migrationen — dann haben die Nachtraege in ' +
    '0032 und 0036 nichts zu lesen, und die Stueckzahl jeder bestehenden Zeile ' +
    'ist beim ersten Start verloren.');

  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); } finally { client.release(); }

  const nachher = await spaltenVon('sets');
  assert.ok(!nachher.includes('quantity'),
    'sets.quantity ist nach allen Migrationen noch da — Migration 0036 hat nicht ' +
    'geloescht, oder etwas legt die Spalte danach wieder an.');

  // Und was `sets` noch ist: DIESES Konto haelt DIESES Set, seit DANN, an DEM
  // Ort. Marcos Liste.
  for (const sp of ['id', 'user_id', 'set_number', 'storage_id', 'added_at', 'updated_at']) {
    assert.ok(nachher.includes(sp), `sets.${sp} fehlt — die Spalte gehoert zum Bestand`);
  }

  // Nicht verschwunden, sondern umgezogen.
  const erf = await spaltenVon('set_acquisitions');
  for (const sp of ['user_id', 'set_number', 'quantity', 'purchase_price', 'condition', 'created_at']) {
    assert.ok(erf.includes(sp),
      `set_acquisitions.${sp} fehlt — dann gibt es die Stueckzahl nirgends mehr`);
  }
});

test('Migration 0036 löscht nur, wenn keine Stückzahl verloren geht',
  { concurrency: 1 }, async (t) => {
  if (!(await dbDa(t))) return;

  const skript = fs.readFileSync(DATEI, 'utf8');

  const nachtrag = skript.slice(skript.indexOf('DO $nachtrag$'),
                               skript.indexOf('END $nachtrag$;') + 15);
  const riegel   = skript.slice(skript.indexOf('DO $pruefung$'),
                               skript.indexOf('END $pruefung$;') + 15);
  assert.match(nachtrag, /INSERT INTO set_acquisitions/,
    'Schritt 1 (der Nachtrag) steht nicht mehr als DO-Block mit dem INSERT');
  assert.match(riegel, /RAISE EXCEPTION '% Set-Zeilen haben keine Erfassung/,
    'Der Riegel prüft nicht mehr auf fehlende Erfassungen');
  assert.match(riegel, /weicht sets\.quantity von der Summe der Erfassungen ab/,
    'Der Riegel prüft nicht mehr auf den Drift zwischen Spalte und Summe');
  assert.ok(skript.indexOf('DO $nachtrag$') < skript.indexOf('DO $pruefung$'),
    'Der Riegel muss NACH dem Nachtrag stehen, sonst prüft er die alte Lage');
  assert.match(skript, /ALTER TABLE sets DROP COLUMN IF EXISTS quantity/,
    'Schritt 3 löscht die Spalte nicht mehr');

  /**
   * Frische Datenbank, alle Migrationen VOR 0036, eine Set-Zeile mit
   * Stückzahl — nach Wahl ohne Erfassung oder mit einer abweichenden —, dann
   * das übergebene Skript.
   *
   * @param sql     das auszuführende Skript
   * @param erfassung null = keine Erfassung anlegen, sonst deren Menge
   * @returns {Promise<string|null>} Fehlermeldung von Postgres, sonst null
   */
  const lauf = async (sql, erfassung = null) => {
    await db.run('DROP SCHEMA public CASCADE');
    await db.run('CREATE SCHEMA public');
    await db.initSchema();
    const c = await db.pool.connect();
    try {
      await c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
      for (const f of fs.readdirSync(MIG_DIR).filter(x => x.endsWith('.sql')).sort()) {
        if (f.startsWith('0036')) break;
        await c.query(fs.readFileSync(path.join(MIG_DIR, f), 'utf8'));
        await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
      }
      await c.query(`INSERT INTO users (username,password_hash) VALUES ('menge','x')`);
      await c.query(`INSERT INTO sets (user_id,set_number,quantity,added_at)
                     SELECT id,'75192-1',4,'2022-02-02' FROM users WHERE username='menge'`);
      // Migration 0032 traegt fuer jede Set-Zeile eine Erfassung nach — hier
      // soll aber genau die Lage OHNE (oder mit abweichender) Erfassung
      // stehen. Also loeschen und gegebenenfalls neu setzen.
      await c.query(`DELETE FROM set_acquisitions`);
      if (erfassung !== null) {
        await c.query(`INSERT INTO set_acquisitions (user_id,set_number,quantity,condition)
                       SELECT id,'75192-1',$1,'N' FROM users WHERE username='menge'`,
          [erfassung]);
      }
      await c.query('BEGIN');
      try { await c.query(sql); await c.query('COMMIT'); return null; }
      catch (e) { await c.query('ROLLBACK').catch(() => {}); return e.message; }
    } finally { c.release(); }
  };

  // ── Lauf 1: die ganze Datei, Set-Zeile ohne Erfassung ────────────────────
  assert.equal(await lauf(skript), null,
    'Die Migration muss auf dieser Lage durchlaufen — Schritt 1 trägt die ' +
    'fehlende Erfassung ja gerade nach');
  const erf = await db.get(
    `SELECT quantity, condition, created_at FROM set_acquisitions WHERE set_number='75192-1'`);
  assert.ok(erf, 'Schritt 1 hat für die Set-Zeile keine Erfassung nachgetragen');
  assert.equal(Number(erf.quantity), 4,
    `Die Stückzahl ist beim Umzug verloren gegangen: ${erf.quantity} statt 4`);
  // toISOString, nicht String(): Der Treiber liefert ein Date, und dessen
  // Textform ist „Wed Feb 02 2022 …" — ein slice(0,10) darauf verglich
  // „Wed Feb 0" mit dem Datum und war immer rot.
  assert.equal(new Date(erf.created_at).toISOString().slice(0, 10), '2022-02-02',
    'Das Aufnahmedatum ist nicht mitgekommen — der Portfolio-Verlauf ordnet danach');
  assert.ok(!(await spaltenVon('sets')).includes('quantity'),
    'Schritt 3 hat die Spalte nicht gelöscht');

  // ── Lauf 2: ohne Schritt 1 — der Riegel muss greifen ─────────────────────
  const ohneNachtrag = skript.replace(nachtrag, '');
  assert.notEqual(ohneNachtrag, skript, 'Schritt 1 wurde nicht herausgeschnitten');
  const meldung = await lauf(ohneNachtrag);
  assert.match(String(meldung), /1 Set-Zeilen haben keine Erfassung/,
    `Der Riegel hat nicht gegriffen. Postgres sagte: ${meldung}`);
  assert.ok((await spaltenVon('sets')).includes('quantity'),
    'sets.quantity ist trotz Abbruch weg — dann rollt die Transaktion nicht zurück');
  const mengeDa = await db.get(`SELECT quantity FROM sets WHERE set_number='75192-1'`);
  assert.equal(Number(mengeDa.quantity), 4, 'Die Stückzahl ist trotz Abbruch verschwunden');

  // ── Lauf 3: GEGENPROBE, ohne Schritt 1 UND ohne Schritt 2 ────────────────
  //
  // Der Kern. Lauf 2 zeigt nur, dass es knallt; erst Lauf 3 zeigt, dass der
  // RIEGEL es ist, der den Verlust verhindert — und nicht Postgres, nicht die
  // Reihenfolge, nicht ein Zufall.
  const ohneBeides = ohneNachtrag.replace(riegel, '');
  assert.notEqual(ohneBeides, ohneNachtrag, 'Schritt 2 wurde nicht herausgeschnitten');
  assert.equal(await lauf(ohneBeides), null,
    'Ohne den Riegel muss die Datei durchlaufen — sonst beweist Lauf 2 nichts');
  assert.ok(!(await spaltenVon('sets')).includes('quantity'),
    'Ohne Riegel muss die Spalte gelöscht sein — sonst beweist Lauf 2 nichts');
  const verloren = await db.get(
    `SELECT COUNT(*)::int AS c FROM set_acquisitions WHERE set_number='75192-1'`);
  assert.equal(verloren.c, 0,
    'Ohne Schritt 1 darf es die Erfassung NICHT geben — die Stückzahl stand nur auf ' +
    'der Bestandszeile und ist damit restlos weg. Gibt es sie, trägt sie etwas ' +
    'anderes nach und Lauf 2 beweist nichts.');

  // ── Lauf 4: der DRIFT ────────────────────────────────────────────────────
  //
  // Erfassung vorhanden (Summe 2), Spalte sagt 4. Schritt 1 trägt nichts nach
  // — es gibt ja eine Erfassung. Genau hier muss die Migration anhalten und
  // einen Menschen fragen, statt eine der beiden Zahlen stillschweigend zu
  // gewinnen zu lassen. Das ist Marcos Server: Dort wurde der Drift gemessen.
  const driftMeldung = await lauf(skript, 2);
  assert.match(String(driftMeldung), /Bei 1 Set-Zeilen weicht sets\.quantity/,
    `Der Drift-Riegel hat nicht gegriffen. Postgres sagte: ${driftMeldung}`);
  assert.match(String(driftMeldung), /75192-1/,
    'Die Meldung nennt kein Beispiel — „1 Zeile weicht ab" sagt nicht, wo man nachsieht');
  assert.match(String(driftMeldung), /Spalte 4, Erfassungen 2/,
    'Die Meldung nennt die beiden Zahlen nicht — dann kann der Mensch nicht entscheiden');
  assert.ok((await spaltenVon('sets')).includes('quantity'),
    'sets.quantity ist trotz Drift-Abbruch weg — dann rollt die Transaktion nicht zurück');

  // ── Und die GEGENPROBE zum Drift ─────────────────────────────────────────
  //
  // Dieselbe Lage, aber Spalte und Summe stimmen überein: Dann muss die
  // Migration durchlaufen. Ohne diesen Lauf könnte der Riegel einfach immer
  // abbrechen, sobald eine Erfassung existiert.
  assert.equal(await lauf(skript, 4), null,
    'Bei übereinstimmender Spalte und Summe muss die Migration durchlaufen — ' +
    'sonst bricht der Riegel nicht beim Drift ab, sondern immer');
});

test('niemand schreibt die Stückzahl eines Sets mehr', () => {
  // Nur der QUELLTEXT, und nur die SCHREIBseite. Die Leseseite prüft nicht
  // dieser Test, sondern die Datenbank: Nach Migration 0036 gibt es die Spalte
  // nicht, jede verbliebene Lesestelle ist ein harter Fehler — und genau
  // deshalb laufen die Lesewege unten gegen eine migrierte Datenbank.
  //
  // Warum die Leseseite hier NICHT per Muster geprüft wird: `s.quantity` steht
  // in utils/handlers/sets.ts weiter im Sortierschlüssel und ist dort richtig
  // — `s` ist eine Unterabfrage, deren Mengenspalte `quantity` heisst. Ein
  // Muster müsste das auseinanderhalten und könnte es nicht; es hätte eine
  // richtige Stelle gemeldet und damit sich selbst entwertet.
  const dateien = [];
  const lauf = (verz) => {
    for (const e of fs.readdirSync(verz, { withFileTypes: true })) {
      const p = path.join(verz, e.name);
      if (e.isDirectory()) { lauf(p); continue; }
      if (/\.(ts|js)$/.test(e.name)) dateien.push(p);
    }
  };
  for (const teil of ['routes', 'utils', 'jobs', 'db', 'clients', 'scripts']) {
    const v = path.join(ROOT, teil);
    if (fs.existsSync(v)) lauf(v);
  }
  dateien.push(path.join(ROOT, 'server.ts'));
  assert.ok(dateien.length > 100, `Nur ${dateien.length} Quelldateien gefunden — der Pfad stimmt nicht`);

  /** Zeilen ohne Kommentare — ein Erklärtext, der eine Anweisung ZITIERT, ist
   *  kein Schreibzugriff. Genau diese Falle hat in diesem Baum schon eine
   *  Regel ihren eigenen Begründungstext melden lassen. */
  const codeZeilen = (txt) => txt.split('\n')
    .filter(z => { const t = z.trim(); return !(t.startsWith('//') || t.startsWith('*')
                                             || t.startsWith('/*') || t.startsWith('--')); });

  // Nur die sets-Tabelle: Die Erfassungstabellen schreiben ihre eigene
  // quantity natuerlich fort — sie sind die Wahrheit, nicht die Kopie.
  // GEMESSEN beim ersten Entwurf dieser Regel in ihrer breiteren Fassung: Sie
  // meldete `UPDATE part_acquisitions SET quantity=quantity-$1` als Verstoss,
  // und das ist genau der Weg, auf dem eine Erfassung kleiner wird.
  const setzt         = /UPDATE\s+sets\s+SET\s+[^;`']*\bquantity\s*=/i;
  const fortschreiben = /UPDATE\s+sets\s+SET\s+quantity\s*=\s*(?:sets\.)?quantity\s*[+-]/i;
  const beiKonflikt   = /INSERT\s+INTO\s+sets\b[^;]*DO\s+UPDATE\s+SET\s+[^;]*\bquantity\s*=/i;
  // Und die Spalte darf auch nicht wieder angelegt werden — ein
  // `ADD COLUMN quantity` auf sets wuerde die Kopie zurueckbringen, ohne eine
  // einzige der Regeln oben zu verletzen.
  const legtAn        = /ALTER\s+TABLE\s+sets\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?quantity/i;

  const stellen = [];
  for (const datei of dateien) {
    const rel = path.relative(ROOT, datei);
    const txt = fs.readFileSync(datei, 'utf8');
    for (const z of codeZeilen(txt)) {
      for (const [was, muster] of [['setzt', setzt], ['schreibt fort', fortschreiben],
                                   ['bei Konflikt', beiKonflikt], ['legt an', legtAn]]) {
        if (muster.test(z)) stellen.push(`${rel} (${was}): ${z.trim().slice(0, 90)}`);
      }
    }
  }

  assert.deepEqual(stellen, [],
    'Diese Stellen schreiben die Stückzahl eines Sets:\n  ' + stellen.join('\n  ') +
    '\nSie steht seit Migration 0036 ausschliesslich in set_acquisitions. Genau die ' +
    'zweite Schreibrichtung ist auseinandergelaufen: sets.quantity = 10 bei drei ' +
    'Erfassungen mit Summe 7.');

  // ── Selbstbeweis ─────────────────────────────────────────────────────────
  //
  // Die Muster oben finden jetzt nichts — das ist der Punkt, sagt aber allein
  // noch nicht, dass sie ueberhaupt etwas finden KOENNTEN. Also einmal an
  // erfundenen Zeilen nachgewiesen, in genau der Form, die vorher im Baum
  // stand (die Beispiele stehen so in utils/setService.ts, Fassung vor 0036).
  const proben = [
    ['UPDATE sets SET quantity = $1 WHERE user_id=$2', setzt],
    ['UPDATE sets SET quantity = quantity + $1 WHERE id=$2', fortschreiben],
    [`INSERT INTO sets (user_id,set_number,quantity) VALUES ($1,$2,$3)
        ON CONFLICT (user_id,set_number) DO UPDATE SET quantity = sets.quantity + 1`, beiKonflikt],
    ['ALTER TABLE sets ADD COLUMN IF NOT EXISTS quantity INTEGER', legtAn],
  ];
  for (const [zeile, muster] of proben) {
    assert.ok(muster.test(zeile),
      `Das Muster greift nicht mehr auf seine eigene Probe: ${zeile.slice(0, 60)}`);
  }
  // Und die Gegenrichtung: Was erlaubt ist, darf NICHT greifen.
  for (const zeile of [
    'UPDATE set_acquisitions SET quantity = quantity - $1 WHERE id=$2',
    'UPDATE parts SET quantity = COALESCE((SELECT SUM(a.quantity) FROM part_acquisitions a), 0)',
  ]) {
    for (const [was, muster] of [['setzt', setzt], ['schreibt fort', fortschreiben],
                                 ['bei Konflikt', beiKonflikt], ['legt an', legtAn]]) {
      assert.ok(!muster.test(zeile),
        `Das Muster „${was}" meldet eine erlaubte Zeile: ${zeile.slice(0, 70)}`);
    }
  }
});

test('die Lesewege liefern die Stückzahl aus den Erfassungen',
  { concurrency: 1 }, async (t) => {
  if (!(await dbDa(t))) return;

  await volleKette();

  const haupt = await db.get(
    `INSERT INTO users (username,password_hash) VALUES ('mengeleser','x') RETURNING id`);
  const kind = await db.get(
    `INSERT INTO users (username,password_hash) VALUES ('mengeleser_kind','x') RETURNING id`);
  const SN = '10290-1';

  await db.run(`INSERT INTO set_catalog (set_number,name,year,pieces)
                VALUES ($1,'Pickup Truck',2022,1677)
                ON CONFLICT (set_number) DO NOTHING`, [SN]);
  // Zwei Konten halten dasselbe Set — der Haushaltszweig von getSets() fasst
  // sie zu EINER Kachel zusammen und muss die Mengen addieren.
  await db.run(`INSERT INTO sets (user_id,set_number) VALUES ($1,$2),($3,$2)`,
    [haupt.id, SN, kind.id]);
  // Drei Erfassungen: zwei beim Hauptkonto (2+1), eine beim Kind (3).
  //
  // Verschiedene TAGE, und das ist keine Kosmetik: idx_set_acq_tag_zustand (Migration
  // 0004) erlaubt je Konto, Set und Tag genau eine Erfassung. Mit demselben
  // Datum brach das INSERT ab — gemessen, „duplicate key value violates
  // unique constraint idx_set_acq_tag_zustand".
  await db.run(`INSERT INTO set_acquisitions (user_id,set_number,quantity,purchase_price,condition,created_at)
                VALUES ($1,$2,2,100,'N', NOW() - INTERVAL '3 days'),
                       ($1,$2,1, 80,'U', NOW() - INTERVAL '1 day'),
                       ($3,$2,3, 90,'N', NOW() - INTERVAL '2 days')`,
    [haupt.id, SN, kind.id]);

  const H = _req('utils/handlers/sets.js');

  // ── Ein Konto ────────────────────────────────────────────────────────────
  const eins = await H.getSets([haupt.id], { page_size: 60 });
  const kachel = eins.sets.find(s => s.set_number === SN);
  assert.ok(kachel, `Das Set fehlt in der Antwort: ${JSON.stringify(eins.sets).slice(0, 300)}`);
  assert.equal(Number(kachel.quantity), 3,
    `Ein Konto, Erfassungen 2+1: erwartet 3, bekam ${kachel.quantity}`);
  // Der Treiber liefert BIGINT als ZEICHENKETTE. Ohne den ::int-Cast in
  // utils/bestandsmenge.ts haengt der JSON-Typ daran, welcher Zweig geantwortet
  // hat — genau dieser Fehler ist in utils/handlers/parts.ts schon aufgeflogen.
  assert.equal(typeof kachel.quantity, 'number',
    `quantity muss eine Zahl sein, war ${typeof kachel.quantity} (${kachel.quantity})`);

  // ── Haushalt ─────────────────────────────────────────────────────────────
  const beide = await H.getSets([haupt.id, kind.id], { page_size: 60 });
  const zusammen = beide.sets.find(s => s.set_number === SN);
  assert.ok(zusammen, 'Das Set fehlt in der Haushaltsantwort');
  assert.equal(Number(zusammen.quantity), 6,
    `Haushalt, Erfassungen 2+1+3: erwartet 6, bekam ${zusammen.quantity}`);
  assert.deepEqual([...(zusammen.owner_ids || [])].map(Number).sort((a, b) => a - b),
    [haupt.id, kind.id].sort((a, b) => a - b),
    'Beide Konten halten Exemplare und müssen beide als Besitzer erscheinen');

  // ── Detail ───────────────────────────────────────────────────────────────
  const detail = await H.getSet(haupt.id, SN);
  assert.ok(detail, 'Das Set-Detail antwortet nicht');
  assert.equal(Number(detail.quantity), 3,
    `Detail eines Kontos: erwartet 3, bekam ${detail.quantity}`);

  // ── GEGENPROBE: eine Erfassung ändern ────────────────────────────────────
  //
  // Der Kern dieses Tests. Ohne ihn könnten die Zahlen oben zufällig stimmen —
  // etwa aus einer anderen Quelle, die gerade dasselbe sagt. Erst wenn die
  // Antwort einer Änderung FOLGT, ist bewiesen, dass sie aus den Erfassungen
  // kommt.
  const eine = await db.get(
    `SELECT id FROM set_acquisitions WHERE user_id=$1 AND set_number=$2
      ORDER BY id ASC LIMIT 1`, [haupt.id, SN]);
  await db.run('UPDATE set_acquisitions SET quantity = 7 WHERE id=$1', [eine.id]);

  const nachher = await H.getSets([haupt.id], { page_size: 60 });
  const neu = nachher.sets.find(s => s.set_number === SN);
  assert.equal(Number(neu.quantity), 8,
    `Nach 2 → 7 muss die Summe 8 sein (7+1), bekam ${neu.quantity}. Dann liest die ` +
    'Liste die Menge nicht aus set_acquisitions.');

  const detail2 = await H.getSet(haupt.id, SN);
  assert.equal(Number(detail2.quantity), 8,
    `Das Detail folgt der Änderung nicht: ${detail2.quantity} statt 8`);

  // ── Und ohne Erfassung ist die Menge 0, nicht 1 ──────────────────────────
  //
  // Eine Bestandszeile ohne Erfassung sollte es nicht geben (Schritt 1 der
  // Migration traegt fuer jede eine nach), aber sie darf die Liste nicht
  // LEEREN — deshalb LEFT JOIN in utils/bestandsmenge.ts. Sie bedeutet dann
  // null Stueck.
  await db.run('DELETE FROM set_acquisitions WHERE user_id=$1 AND set_number=$2',
    [haupt.id, SN]);
  const leer = await H.getSets([haupt.id], { page_size: 60 });
  const nullStueck = leer.sets.find(s => s.set_number === SN);
  assert.ok(nullStueck,
    'Ohne Erfassung ist das Set aus der Liste gefallen — der JOIN muss ein LEFT JOIN ' +
    'sein, sonst verschwinden genau die Zeilen, denen etwas fehlt');
  assert.equal(Number(nullStueck.quantity), 0,
    `Ohne Erfassung muss die Menge 0 sein, nicht ${nullStueck.quantity}`);
});
