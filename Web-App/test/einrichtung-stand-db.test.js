/**
 * Der Einrichtungsstand vor der Anmeldung: öffentlich, aber ohne Konten und
 * ohne Schlüssel; der Eingang lässt ohne Sitzung nur diesen Pfad durch.
 *
 * Gegenproben:
 *   A  Konten-Zähler in einrichtungStand.ts entfernt → rot: „für den Verwalter steht das Konto erst auf bereit, …“
 *   B  Pfad aus OEFFENTLICH gestrichen               → rot: 401 statt 200
 *   C  users-Zeile in die Antwort übernommen         → rot: „keine Adressen, keine Namen“
 *   D  BrickLink-/Rebrickable-Prüfung in einrichtungStand.ts entfernt → rot: „mit hinterlegter Quelle gilt die Einrichtung als begonnen“
 *   E  in routes/api_v1/einrichtung.ts `verwalter: true` fest gesetzt (07.11.2026)
 *      → rot: „ohne Verwalter verrät der Stand kein Startpasswort“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testDaten();

// Eine offene Verbindung aus dem Pool hält den Prozess am Leben; im Volllauf steht dann
// die ganze Datei still, statt zu enden. Deshalb schliesst die Datei ihren Pool selbst.
after(() => db.pool.end().catch(() => {}));

test('Einrichtungsstand ohne Anmeldung', { concurrency: 1 }, async t => {
  if (!(await datenOderSkip(t, _req, { migrieren: false }))) return;

  const schluessel = ['einrichtung_erledigt', 'rebrickable_api_key'];
  const vorher = await db.all('SELECT key, value FROM global_settings WHERE key = ANY($1)', [schluessel]);
  await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [schluessel]);
  t.after(async () => {
    await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [schluessel]);
    for (const z of vorher) {
      await db.run(
        `INSERT INTO global_settings (key, value) VALUES ($1, $2)
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [z.key, z.value],
      );
    }
  });

  const name = `es_${process.pid}`;
  const uid = (
    await db.get(
      "INSERT INTO users (username, password_hash, is_admin, must_change_password) VALUES ($1,'x',true,true) RETURNING id",
      [name],
    )
  ).id;
  t.after(() => db.run('DELETE FROM users WHERE id = $1', [uid]));

  const srv = testServer(_req, { sitzung: {}, t });
  const r = await fetch(srv.base + '/api/v1/einrichtung/stand');
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.success, true);
  assert.equal(d.erledigt, false);
  assert.equal(d.konfiguriert, false, 'ohne Quelle ist nichts konfiguriert');
  assert.equal(d.ca.download, '/ca.crt');
  assert.ok(Array.isArray(d.schritte) && d.schritte.length >= 5, 'die Prüfungen fehlen');
  for (const s of d.schritte) {
    assert.equal(typeof s.ok, 'boolean');
    assert.equal(typeof s.pflicht, 'boolean');
  }
  // Ein Startpasswort ist noch gesetzt; ohne Verwalter heisst „konto“ nur „es gibt eines“.
  const konto = d.schritte.find(s => s.id === 'konto');
  assert.equal(konto.ok, true, 'ohne Verwalter verrät der Stand kein Startpasswort');
  assert.equal(d.basis_url, null, 'ohne Verwalter keine Basis-URL');
  const verwalter = testServer(_req, { sitzung: { userId: uid, isAdmin: true }, t });
  const dv = await (await fetch(verwalter.base + '/api/v1/einrichtung/stand')).json();
  assert.equal(
    dv.schritte.find(s => s.id === 'konto').ok,
    false,
    'für den Verwalter steht das Konto erst auf bereit, wenn das Startpasswort ersetzt ist',
  );
  // Keine Adressen, keine Namen, keine Schlüsselnamen.
  const text = JSON.stringify(d);
  assert.doesNotMatch(text, /@/);
  assert.doesNotMatch(text, new RegExp(name));
  assert.doesNotMatch(text, /api_key|smtp_|password/i);

  // Eine hinterlegte Quelle beendet die Ersteinrichtung: Der Prüfknopf verschwindet.
  // Über den echten Schreibweg, weil Schlüssel verschlüsselt liegen (SECRET_KEYS).
  await _req('src/einstellungen/settings.js').setGlobalSetting('rebrickable_api_key', 'probe');
  const d2 = await (await fetch(srv.base + '/api/v1/einrichtung/stand')).json();
  assert.equal(d2.konfiguriert, true, 'mit hinterlegter Quelle gilt die Einrichtung als begonnen');
});

test('der Eingang lässt ohne Sitzung nur den Stand durch', async t => {
  if (!(await datenOderSkip(t, _req, { migrieren: false }))) return;
  const app = express();
  const mw = _req('routes/api_v1/middleware.js');
  app.use('/api/v1', mw.anmeldungAmEingang);
  app.use('/api/v1', (req, res) => res.json({ success: true, pfad: req.path }));
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  const adresse = srv.address();
  const base = `http://localhost:${typeof adresse === 'object' && adresse ? adresse.port : 0}/api/v1`;

  const offen = await fetch(base + '/einrichtung/stand');
  assert.equal(offen.status, 200, 'der Stand muss vor der Anmeldung erreichbar sein');
  const zu = await fetch(base + '/sets');
  assert.equal(zu.status, 401, 'alles andere bleibt zu');
});
