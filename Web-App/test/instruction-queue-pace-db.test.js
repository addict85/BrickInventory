/**
 * Der Takt der Anleitungs-Warteschlange gilt echten Abrufen, nicht Durchgängen.
 *
 * ── Marcos Befund (Nachtrag 142) ────────────────────────────────────────────
 * „Der Download der Handbücher ist extrem langsam."
 *
 * Die Warteschlange wartete nach JEDEM Set 15 Sekunden. Die Pause ist dazu da,
 * Brickset und brickinstructions.com zu schonen — aber Sets, die schon eine
 * Anleitung haben, fallen in `downloadSetInstructions()` sofort heraus, OHNE
 * eine Verbindung zu öffnen. Für die gibt es nichts zu schonen.
 *
 * Gemessen: ein solcher Durchgang dauert 0 ms und fragt niemanden. Bei 800
 * Sets, von denen 700 versorgt sind, waren das knapp DREI STUNDEN Warten für
 * nichts.
 *
 * ── Derselbe Fehler wie beim Bild-Job ───────────────────────────────────────
 * Nachtrag 217 (hardened-217): Dort wurde das CDN-Kontingent auf NOTIZEN
 * angewandt statt auf CDN-Anfragen; Übersprünge bremsten wie Downloads. 37
 * Minuten Wartezeit für „10 bearbeitet: 0/0/0 bereits vorhanden".
 *
 * Die Lehre gilt für jede Drosselung: Sie muss an der Handlung hängen, die
 * geschont werden soll — nicht an der Schleife darüber. Dass der Auftrag nur
 * nach einem echten Abruf pausiert, prüft test/anleitung-auftrag-db.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();

test('ein bereits versorgtes Set löst keinen Abruf aus', async (t) => {
  const db = _req('db/database.js');
  try { await db.initSchemaOnce(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw e;
    t.skip('Test-DB nicht erreichbar'); return;
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

