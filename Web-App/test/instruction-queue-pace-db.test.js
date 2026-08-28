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
 * geschont werden soll — nicht an der Schleife darüber.
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

  const ins = _req('utils/instructions.js');
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

test('die Warteschlange bremst nur nach einem echten Abruf', () => {
  // Am Quelltext geprüft, weil es um die ENTSCHEIDUNG geht: Ein Test über die
  // Zeit müsste fünfzehn Sekunden warten, um das Gegenteil zu belegen.
  const fs = require('node:fs');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'jobs', 'instructionQueue.ts'), 'utf8');

  assert.match(src, /scheduleNext\(letzterAbrufWarExtern\(\) \? 15000 : \d+\)/,
    'Der Takt hängt wieder am Durchgang statt am Abruf — genau der Zustand, ' +
    'in dem 700 versorgte Sets knapp drei Stunden Wartezeit erzeugten.');

  // Und die lange Pause muss erhalten bleiben, wo wirklich gefragt wird.
  assert.ok(src.includes('15000'),
    'Ohne Pause nach einem echten Abruf läuft die Anwendung in die ' +
    'Cloudflare-Sperre, die weiter unten behandelt wird.');
});

test('der Job verzichtet auf die Pausen, die er selbst schon einhält', () => {
  // ── Die zweite Hälfte des Befunds (Nachtrag 142) ─────────────────────────
  //
  // downloadSetInstructions() legt nach dem BDP-Rückfallweg 5 Sekunden ein.
  // Die Warteschlange wartet danach nochmal 15 — zusammen 20, ohne dass ein
  // Server dadurch besser geschont würde: Der nächste Abruf kommt so oder so
  // frühestens nach 15 Sekunden.
  //
  // Die beiden ANDEREN Aufrufer (Set erfassen, Brickset-Wiederholung) haben
  // keinen Takt über sich. Für die bleiben die Pausen — deshalb ein Schalter
  // und kein Löschen.
  const fs = require('node:fs');
  const jobs = fs.readFileSync(path.join(__dirname, '..', 'jobs', 'instructionQueue.ts'), 'utf8');
  const ins  = fs.readFileSync(path.join(__dirname, '..', 'utils', 'instructions.ts'), 'utf8');

  assert.match(jobs, /downloadSetInstructions\(row\.set_number, null, true\)/,
    'Der Job meldet nicht mehr, dass er den Takt selbst einhält — dann wartet ' +
    'er wieder 20 Sekunden statt 15.');
  assert.match(ins, /if \(!eigenerTakt\) await sleep\(5000\)/,
    'Die Pausen sind nicht mehr abschaltbar');

  // Und sie müssen für die übrigen Aufrufer erhalten bleiben.
  const anzahl = (ins.match(/if \(!eigenerTakt\) await sleep\(5000\)/g) || []).length;
  assert.equal(anzahl, 2,
    `${anzahl} statt 2 Pausen — für „Set erfassen" und die Brickset-Wiederholung ` +
    'gibt es keinen Takt darüber, dort sind sie die einzige Bremse.');
});
