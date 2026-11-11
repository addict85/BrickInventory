/**
 * Die Teileliste liefert die REBRICKABLE-Nummer, nicht die BrickLink-Nummer.
 *
 * Gegenprobe (durchgefuehrt): `part_number: p.part_number` zurueck auf
 * `blId` gesetzt → Schritt 1 wird rot; zusaetzlich den Schluessel auf
 * `${blId}|…` zurueckgedreht → Schritt 2 wird rot.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { keineDb } = require('./helpers/db');
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
                VALUES (900,'3070b',0,4,false), (900,'3069b',0,2,false), (900,'3001',0,7,false)`);
  await db.run(`INSERT INTO rb_parts (part_num, name) VALUES
                ('3070b','Tile 1x1'), ('3069b','Tile 1x2'), ('3001','Brick 2x4')`);
  // Seit Migration 0037 in bl_zuordnung, mit Art-Unterscheidung.
  await db.run(`INSERT INTO bl_zuordnung (art, rb_id, bl_id) VALUES
                ('part','3070b','3070'), ('part','3069b','3070')`);
}

async function dbErreichbar() {
  try { await db.get('SELECT 1 AS ok'); return true; } catch { return false; }
}

test('die Teileliste benennt die Teile mit beiden Nummern', { concurrency: 1 }, async (t) => {
  if (!(await dbErreichbar())) {
    await db.pool.end().catch(() => {});
    keineDb(t);
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
