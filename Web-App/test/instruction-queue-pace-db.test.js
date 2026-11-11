/**
 * Der Takt der Anleitungs-Warteschlange gilt echten Abrufen, nicht Durchgängen.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { keineDb } = require('./helpers/db');

test('ein bereits versorgtes Set löst keinen Abruf aus', async (t) => {
  const db = _req('db/database.js');
  try { await db.initSchemaOnce(); }
  catch (e) {
    keineDb(t, e); return;
  }

  const ins = _req('src/katalog/instructions.js');
  const sn = '99999-1';
  await db.run('DELETE FROM shared_instructions WHERE set_number = $1', [sn]);
  await db.run(
    `INSERT INTO shared_instructions (set_number, url, description, local_path)
     VALUES ($1, 'http://example.invalid/a.pdf', 'A', '/data/instructions/a.pdf')`, [sn]);

  const t0 = Date.now();
  const anzahl = await ins.downloadSetInstructions(sn, null);
  const dauer = Date.now() - t0;

  assert.equal(anzahl, 1, 'Die vorhandene Anleitung wurde nicht gezählt');
  assert.equal(ins.letzterAbrufWarExtern(), false,
    'Für ein versorgtes Set darf kein fremder Server befragt werden');
  assert.ok(dauer < 2000, `${dauer} ms — hier darf nichts über das Netz gehen`);

  await db.run('DELETE FROM shared_instructions WHERE set_number = $1', [sn]);

  // Pool schliessen, sonst hält die Datei den Testlauf offen bis zur
  // Zeitgrenze — die Prüfungen sind dann grün, die DATEI aber rot.
  await db.pool.end().catch(() => {});
});

