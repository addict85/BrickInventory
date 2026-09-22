/**
 * Die Teileliste liefert die REBRICKABLE-Nummer, nicht die BrickLink-Nummer.
 *
 * ── Marcos Befund, in drei Schritten ────────────────────────────────────────
 *
 *   „Ich besitze das Set 2x wie kann es dann sein, dass Teile fehlen?"
 *   „Ist evtl. die BL und Rebrickable-ID das Problem (werden diese
 *    verglichen)?"
 *   — und nach der ersten Reparatur: „Leider nicht."
 *
 * Er hatte recht, und zwar eine Ebene tiefer, als zuerst gesucht wurde. In
 * /sets/:setNumber/parts-list stand:
 *
 *     const blId = cat.bl_part_number || p.bl_part_number || p.part_number;
 *     const key  = `${blId}|${p.color_id}`;
 *     …
 *     part_number:    blId,     ← die Rebrickable-Nummer wurde ueberschrieben
 *     bl_part_number: blId,
 *
 * Der Endpunkt gab in BEIDEN Feldern die BrickLink-Nummer zurueck. Der
 * Bestandsabgleich fragt danach `parts` ab, und dort steht die
 * Rebrickable-Nummer: Ein Tile 1x1 heisst bei Rebrickable `3070b`, bei
 * BrickLink `3070`. Gefragt wurde nach `3070`, gefunden wurde nichts — und
 * „nicht gefunden" sieht aus wie „habe ich nicht".
 *
 * NACHGEMESSEN an Marcos Bestand (60052-1, 291 Positionen): 45 galten als
 * fehlend, und KEINE der gemeldeten Nummern (3070, 3068, x1687, 55423c01 …)
 * stand ueberhaupt in `rb_inventory_parts` — sie waren alle erst in diesem
 * Schritt entstanden.
 *
 * ── Warum mit DB und nicht am Quelltext ─────────────────────────────────────
 *
 * Eine Quelltext-Regel haette hier nichts genuetzt: Die vorige Fassung sah
 * richtig aus (`part_number` stand da, nur mit dem falschen Wert). Was zaehlt,
 * ist die Antwort — und die entsteht aus drei Tabellen (rb_inventory_parts,
 * rb_bl_mapping, set_parts_catalog), die sich gegenseitig ueberschreiben.
 *
 * Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL.
 *
 * Gegenprobe (durchgefuehrt): `part_number: p.part_number` zurueck auf
 * `blId` gesetzt → Schritt 1 wird rot; zusaetzlich den Schluessel auf
 * `${blId}|…` zurueckgedreht → Schritt 2 wird rot.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

async function seed() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); } finally { client.release(); }

  await db.run(`INSERT INTO users (username, password_hash) VALUES ('bauer','x')`);

  await db.run(`INSERT INTO rb_inventories (id, set_num, version) VALUES (900,'60052-1',2)`);
  // Drei Zeilen, die den Fall vollstaendig beschreiben:
  //   3070b → BrickLink 3070   (die Umbenennung, an der es scheiterte)
  //   3069b → BrickLink 3070   (zweite Rebrickable-Nummer, GLEICHE BL-Nummer)
  //   3001  → keine Zuordnung  (BrickLink-Nummer = Rebrickable-Nummer)
  await db.run(`INSERT INTO rb_inventory_parts (inventory_id, part_num, color_id, quantity, is_spare)
                VALUES (900,'3070b',0,4,'f'), (900,'3069b',0,2,'f'), (900,'3001',0,7,'f')`);
  await db.run(`INSERT INTO rb_parts (part_num, name) VALUES
                ('3070b','Tile 1x1'), ('3069b','Tile 1x2'), ('3001','Brick 2x4')`);
  await db.run(`INSERT INTO rb_bl_mapping (part_num, bl_part_num) VALUES
                ('3070b','3070'), ('3069b','3070')`);
}

async function dbErreichbar() {
  try { await db.get('SELECT 1 AS ok'); return true; } catch { return false; }
}

test('die Teileliste benennt die Teile mit beiden Nummern', { concurrency: 1 }, async (t) => {
  if (!(await dbErreichbar())) {
    await db.pool.end().catch(() => {});
    if (process.env.REQUIRE_DB === '1') throw new Error('REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar.');
    t.skip('Test-DB nicht erreichbar');
    return;
  }
  await seed();

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { userId: 1 };
    req.apiUser = { user_id: 1, is_admin: 0 };
    next();
  });
  app.use('/api/v1', _req('routes/api_v1/index.js'));
  const srv = app.listen(0);
  t.after(async () => { srv.close(); await db.pool.end().catch(() => {}); });

  const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/v1/sets/60052-1/parts-list`);
  const d = await r.json();
  assert.equal(d.success, true, JSON.stringify(d));
  const nach = (nr) => d.parts.find(p => p.part_number === nr);

  await t.test('`part_number` ist die Rebrickable-Nummer', () => {
    assert.ok(nach('3070b'),
      'Die Antwort kennt `3070b` nicht. Steht dort die BrickLink-Nummer 3070, ' +
      'sucht der Bestandsabgleich in `parts` nach einer Nummer, die es dort ' +
      'nicht gibt — genau Marcos „Teile fehlen".\n' +
      'Geliefert wurde: ' + d.parts.map(p => p.part_number).join(', '));
    assert.equal(nach('3070b').bl_part_number, '3070',
      'Die BrickLink-Nummer muss daneben stehen bleiben — Anzeige und Export leben davon');
  });

  await t.test('zwei Rebrickable-Teile mit EINER BrickLink-Nummer bleiben zwei Zeilen', () => {
    // Der Grund, warum der Schluessel mitwandern musste: Auf der
    // BrickLink-Nummer faenden 3070b und 3069b zu einer Zeile zusammen — mit
    // addiertem Bedarf (6) unter einer der beiden Nummern.
    assert.ok(nach('3069b'), 'Die zweite Nummer ist verschluckt worden');
    assert.equal(nach('3070b').total_quantity, 4, 'Der Bedarf von 3070b stimmt nicht mehr');
    assert.equal(nach('3069b').total_quantity, 2, 'Der Bedarf von 3069b stimmt nicht mehr');
    assert.equal(nach('3069b').bl_part_number, '3070',
      'Beide tragen dieselbe BrickLink-Nummer — der Export fasst sie dort wieder zusammen');
  });

  await t.test('ohne Zuordnung bleibt die Nummer, wie sie ist', () => {
    // Die Gegenrichtung: Wo es keine BrickLink-Nummer gibt, darf nichts
    // erfunden werden — beide Felder tragen dann die Rebrickable-Nummer.
    assert.ok(nach('3001'), '3001 fehlt ganz');
    assert.equal(nach('3001').bl_part_number, '3001');
  });
});
