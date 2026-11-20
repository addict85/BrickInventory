/**
 * Der Papierkorb steht nur an SELBST hochgeladenen Anleitungen. Die App liest dasselbe
 * Feld (is_manual); dass ihr Modell es kennt, prüft der Android-Lauf gegen den Vertrag.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, ohneKommentare, testData } = require('./helpers/sources');
const { holdsSet } = require('./helpers/inventory');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const { readSet, setsLesen } = require('./helpers/sources').areaPage('sets');

test('instructions: the server says which one was uploaded by the user', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const USER = `anlh-${process.pid}`;
  // Endet auf "-<Ziffern>", damit withVersion() nichts anhaengt: shared_
  // instructions wird unter der Nummer MIT Versionsanhang gelesen.
  const SN = `70999-${process.pid}`;

  await db.run(`DELETE FROM users WHERE username=$1`, [USER]);
  await db.run(`DELETE FROM shared_instructions WHERE set_number=$1`, [SN]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x')`, [USER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [USER])).id;

  await holdsSet(db, uid, SN, 1);
  // Die automatische Suche: kein Konto, Datei unter /data/instructions/.
  await db.run(
    `INSERT INTO shared_instructions (set_number,url,description,local_path)
                VALUES ($1,$2,'Anleitung automatisch',$3)`,
    [SN, `https://example.invalid/${SN}.pdf`, `/data/instructions/${SN}_1.pdf`],
  );
  // Der eigene Upload: mit Konto, Datei unter /data/uploads/<id>/.
  await db.run(
    `INSERT INTO instructions (user_id,set_number,url,description,local_path)
                VALUES ($1,$2,$3,'Anleitung selbst',$3)`,
    [uid, SN, `/data/uploads/${uid}/${SN}_1.pdf`],
  );

  try {
    // ── 1. Detail: jede Zeile traegt ihre Herkunft ─────────────────────────
    const detail = await readSet(uid, SN);
    assert.ok(detail, 'Set nicht gefunden');
    assert.equal(
      detail.instructions.length,
      2,
      'Es sollen beide Anleitungen ankommen — geteilt und selbst hochgeladen',
    );

    const geteilt = detail.instructions.find(i => i.description === 'Anleitung automatisch');
    const eigene = detail.instructions.find(i => i.description === 'Anleitung selbst');
    assert.ok(geteilt && eigene, 'Beide Anleitungen sollen in der Liste stehen');

    assert.equal(
      geteilt.is_manual,
      false,
      'Die automatisch importierte Anleitung ist NICHT selbst hochgeladen — kein Papierkorb',
    );
    assert.equal(
      eigene.is_manual,
      true,
      'Die selbst hochgeladene Anleitung traegt is_manual=true — nur hier ein Papierkorb',
    );

    // ── 2. Gegenprobe zur alten Regel: `id != null` trennt nichts ──────────
    //
    // Genau daran hing der Papierkorb bisher. Beide Zeilen haben eine Kennung,
    // und die Zaehler der beiden Tabellen sind voneinander unabhaengig — die
    // Nummern koennen sich also decken.
    assert.notEqual(
      geteilt.id,
      null,
      'Gemessen: auch die geteilte Anleitung bringt eine id mit — die alte Regel trennte nicht',
    );
    assert.notEqual(eigene.id, null, 'Die eigene Anleitung bringt ebenfalls eine id mit');

    // ── 3. Liste: dieselbe Markierung, damit die Kachel gleich zaehlt ──────
    const { sets } = await setsLesen(uid, {});
    const inList = sets.find(s => s.set_number === SN);
    assert.ok(inList, 'Set fehlt in der Galerie');
    assert.deepEqual(
      inList.instructions.map(i => i.is_manual).sort(),
      [false, true],
      'Auch die Galerie soll beide Herkuenfte unterscheiden',
    );
  } finally {
    await db.run(`DELETE FROM shared_instructions WHERE set_number=$1`, [SN]).catch(() => {});
    await db.run(`DELETE FROM users WHERE username=$1`, [USER]).catch(() => {});
    // Ohne das bleibt der Verbindungspool offen und der Testlauf haengt bis
    // zur Zeitgrenze — so halten es alle DB-Tests hier.
    await db.pool.end().catch(() => {});
  }
});

test('instructions: the web app attaches the trash to is_manual', () => {
  const galerie = ohneKommentare(fs.readFileSync(path.join(ROOT, 'public/js/set-detail.js'), 'utf8'));

  assert.ok(
    /const isUpload = !!i\.is_manual;/.test(galerie),
    'Die Webapp soll die Herkunft vom Server nehmen, nicht selbst am Pfad ablesen',
  );
  assert.ok(
    !/local_path\.startsWith\('\/data\/uploads\/'\)/.test(galerie),
    'Der Pfadvergleich war die zweite Fassung derselben Regel und soll weg sein',
  );
  assert.ok(
    /\$\{isUpload \? (?:html)?`<button data-click="delInstr"/.test(galerie),
    'Der Loeschknopf der Webapp soll nur bei selbst hochgeladenen Anleitungen stehen',
  );
});
