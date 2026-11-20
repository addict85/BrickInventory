/**
 * Die Lagerort-VORGABE gegen eine echte Datenbank.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const { holdsSet } = require('./helpers/inventory');
const db = testData();

const U = {};

async function seed() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const client = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(client);
  } finally {
    client.release();
  }

  for (const name of ['ich', 'kind']) {
    await db.run(`INSERT INTO users (username, password_hash) VALUES ($1,'x')`, [name]);
    U[name] = (await db.get('SELECT id FROM users WHERE username=$1', [name])).id;
  }
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1,$2)', [U.ich, U.kind]);
  await holdsSet(db, U.ich, '10179-1', 1);
}

async function dbReachable() {
  try {
    await db.get('SELECT 1 AS ok');
    return true;
  } catch {
    return false;
  }
}

test('storage location default against a real database', async t => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    keineDb(t);
    return;
  }
  await seed();
  const bestand = require('./helpers/sources').testArea('inventory');
  const L = { ..._req('src/inventory/storageLocation.js'), ...bestand.locationService, setDefault: bestand.setDefault };

  const estrich = (await L.putLocationAn(U.ich, 'Estrich')).ort;
  const cellar = (await L.putLocationAn(U.ich, 'Keller')).ort;
  const fremd = (await L.putLocationAn(U.kind, 'Kinderzimmer')).ort;

  await t.test('without a star there is no default', async () => {
    // Der Ausgangszustand, und er ist eine eigene Aussage: Eine Oberflaeche,
    // die hier einen Ort bekaeme, wuerde beim ersten Erfassen etwas
    // vorauswaehlen, das niemand gesetzt hat.
    assert.equal(await L.vorgabeVon(U.ich), null);
  });

  await t.test('the star sets the default and it reads back', async () => {
    const gesetzt = await L.setDefault(U.ich, estrich.id);
    assert.equal(gesetzt.name, 'Estrich');
    const gelesen = await L.vorgabeVon(U.ich);
    assert.equal(gelesen?.id, estrich.id);
    assert.equal(gelesen?.name, 'Estrich');
  });

  await t.test('a second star replaces the first', async () => {
    // Eine Vorgabe mit genau einem Wert: Zwei gleichzeitig waeren beim
    // Erfassen eine Frage ohne Antwort. Dass das ohne Zutun gilt, ist der
    // Gewinn aus der Ablage in user_settings (ein Schluessel, ein Wert).
    await L.setDefault(U.ich, cellar.id);
    assert.equal((await L.vorgabeVon(U.ich))?.name, 'Keller');
    const n = (
      await db.get(`SELECT COUNT(*)::int c FROM user_settings WHERE user_id=$1 AND key=$2`, [U.ich, L.DEFAULT_KEY])
    ).c;
    assert.equal(n, 1, `${n} Zeilen fuer die Vorgabe — es darf genau eine geben`);
    await L.setDefault(U.ich, estrich.id);
  });

  await t.test('a foreign place is rejected', async () => {
    // Das Kinderzimmer des Kindes ist nicht mein Regal (Migration 0020). Ohne
    // diese Grenze stuende mein Stern an einem Ort in einer anderen Wohnung.
    // Geprueft wird `e.code` und nicht der Text: Der erste Entwurf suchte
    // „lagerort_unbekannt" in der MELDUNG, und die lautet auf Deutsch …
    await assert.rejects(
      () => L.setDefault(U.ich, fremd.id),
      (/** @type {any} */ e) => String(e.code) === 'lagerort_unbekannt',
      'Ein fremder Ort liess sich als eigene Vorgabe setzen',
    );
    assert.equal(
      (await L.vorgabeVon(U.ich))?.name,
      'Estrich',
      'Die abgelehnte Zuweisung hat die bestehende Vorgabe veraendert',
    );
  });

  await t.test('RENAME: the default stays and has a new name', async () => {
    // Die Aussage, fuer die es diese Datei gibt. Es steht KEINE Zeile in
    // benenneOrtUm, die die Vorgabe nachzieht — es braucht sie nicht, weil
    // die ID gespeichert ist. Mit dem Namen waere das hier rot.
    await L.benenneOrtUm(U.ich, estrich.id, 'Dachboden');
    const v = await L.vorgabeVon(U.ich);
    assert.equal(v?.id, estrich.id, 'Die Vorgabe zeigt nach dem Umbenennen ins Leere');
    assert.equal(
      v?.name,
      'Dachboden',
      'Die Vorgabe traegt noch den alten Namen — dann steht beim Erfassen ein ' +
        'Ort, den die Auswahlliste nicht mehr kennt',
    );
    await L.benenneOrtUm(U.ich, estrich.id, 'Estrich');
  });

  await t.test('DELETE: the default is gone, not broken', async () => {
    // Die zweite Aussage. Ein Ort laesst sich nur loeschen, wenn nichts darin
    // liegt (loescheOrt) — deshalb ein eigener, leerer Ort fuer diese Probe.
    const kiste = (await L.putLocationAn(U.ich, 'Kiste 7')).ort;
    await L.setDefault(U.ich, kiste.id);
    assert.equal((await L.vorgabeVon(U.ich))?.name, 'Kiste 7');
    await L.loescheOrt(U.ich, kiste.id);
    assert.equal(
      await L.vorgabeVon(U.ich),
      null,
      'Nach dem Loeschen des Ortes meldet die Vorgabe noch etwas — sie heilt ' +
        'sich also nicht selbst, und die Oberflaeche waehlt einen Ort vor, den ' +
        'es nicht gibt',
    );
    // Die verwaiste Zeile in user_settings darf bleiben: Sie ist stumm (der
    // JOIN findet nichts) und wird beim naechsten Stern ueberschrieben. Sie
    // aufzuraeumen waere genau der Code, den dieser Entwurf einspart.
    const rest = (await db.get(`SELECT value FROM user_settings WHERE user_id=$1 AND key=$2`, [U.ich, L.DEFAULT_KEY]))
      ?.value;
    assert.equal(
      rest,
      String(kiste.id),
      'Erwartet war die stumme, verwaiste Zeile — steht dort etwas anderes, ' +
        'stimmt die Begruendung in src/inventory/storageLocation.ts nicht mehr',
    );
  });

  await t.test('the star can be switched off again', async () => {
    await L.setDefault(U.ich, cellar.id);
    assert.equal((await L.vorgabeVon(U.ich))?.name, 'Keller');
    assert.equal(await L.setDefault(U.ich, null), null);
    assert.equal(await L.vorgabeVon(U.ich), null, 'Der Stern liess sich nicht loeschen');
    const n = (
      await db.get(`SELECT COUNT(*)::int c FROM user_settings WHERE user_id=$1 AND key=$2`, [U.ich, L.DEFAULT_KEY])
    ).c;
    assert.equal(n, 0, 'Die Einstellung steht noch da');
  });

  await db.pool.end().catch(() => {});
});
