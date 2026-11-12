/**
 * „Set hinzufügen“ nennt die richtige Ursache: Ist der Set-Katalog noch gar
 * nicht geladen, meldet der Server katalog_nicht_geladen statt
 * set_nicht_im_katalog; die Oberfläche sagt dann, dass Rebrickable fehlt,
 * nicht „Nummer prüfen“. Ein Set der eigenen Sammlung heisst „schon in deiner
 * Sammlung“ und führt mit einem Knopf zum Set.
 *
 * Gegenproben (04.11.2026 gemessen, je einzeln):
 *   A  in routes/api_v1/catalog.ts immer 'set_nicht_im_katalog' → rot:
 *      „Server: leerer Katalog“ (Code set_nicht_im_katalog)
 *   B  in setUnbekannt() die Abfrage der eigenen Sammlung entfernt → rot:
 *      „Oberfläche: Set schon in der Sammlung“ (Meldung „unbekannt“)
 *   C  in setUnbekannt() katalog_nicht_geladen wie set_nicht_im_katalog
 *      behandelt → rot: „Oberfläche: Katalog nicht geladen“
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { oeffneOberflaeche, warte } = require('./helpers/oberflaeche');
const db = _req('db/database.js');

test('Server: leerer Katalog', { concurrency: 1 }, async t => {
  if (!(await dbOderSkip(t, _req))) return;
  const name = `ursache-${process.pid}`;
  await db.run('DELETE FROM users WHERE username=$1', [name]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1,'x') RETURNING id`, [name])).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id=$1', [uid]);
    await db.pool.end();
  });
  const { base } = testServer(_req, {
    sitzung: { userId: uid },
    apiNutzer: { user_id: uid, is_admin: 0 },
    routen: { '/api/v1': 'routes/api_v1/index.js' },
    t,
  });
  const frage = async nr => (await fetch(`${base}/api/v1/catalog/sets/${nr}`)).json();

  await db.run('TRUNCATE rb_sets CASCADE');
  assert.equal((await frage('10294-1')).code, 'katalog_nicht_geladen', 'leerer Katalog');
  await db.run(
    `INSERT INTO rb_sets (set_num, name, year, theme_id, num_parts) VALUES ('75192-1', 'Millennium Falcon', 2017, 158, 7541)`,
  );
  assert.equal((await frage('10294-1')).code, 'set_nicht_im_katalog', 'geladener Katalog ohne die Nummer');
  assert.equal((await frage('75192-1')).success, true, 'bekannte Nummer');
});

/** Öffnet „Set hinzufügen“, trägt die Nummer ein und liefert den Hinweis darunter. */
async function versuche(antworten, nr) {
  const o = await oeffneOberflaeche(antworten);
  const { d } = o;
  d.querySelector('button[data-click="oeffneErfassen"][data-arg="set"]').click();
  d.getElementById('add-num').value = nr;
  d.getElementById('btn-add').click();
  await warte(() => !d.getElementById('add-unbekannt').hidden);
  return {
    ...o,
    hinweis: d.getElementById('add-unbekannt').textContent.replace(/\s+/g, ' ').trim(),
    knopf: d.getElementById('btn-add').textContent.trim(),
  };
}

test('Oberfläche: Set schon in der Sammlung', async () => {
  const set = { set_number: '10294-1', name: 'Titanic', quantity: 2, conditions: ['N'], instructions: [] };
  const { w, d, aufrufe, hinweis, knopf } = await versuche(
    {
      '/v1/sets/10294-1': { success: true, set },
      '/v1/catalog/sets/10294-1': {
        $status: 404,
        success: false,
        code: 'katalog_nicht_geladen',
        error: 'Katalog nicht geladen',
      },
    },
    '10294',
  );
  try {
    assert.match(hinweis, /Titanic \(10294-1\) ist schon in deiner Sammlung \(×2\)/);
    assert.equal(knopf, 'Set öffnen');
    assert.equal(
      aufrufe.some(a => a.url.includes('add-stream')),
      false,
      'trotzdem angelegt',
    );
    // Ein Knopf „Set öffnen“ (UI-Prüfung 17, N2): der Hauptknopf.
    d.getElementById('btn-add').click();
    assert.ok(await warte(() => d.getElementById('set-modal').classList.contains('open')), 'das Set öffnet sich');
    assert.equal(
      d.getElementById('add-set-modal').classList.contains('open'),
      false,
      'der Erfassen-Dialog bleibt offen',
    );
  } finally {
    w.close();
  }
});

test('Oberfläche: Katalog nicht geladen', async () => {
  const { w, hinweis, knopf } = await versuche(
    {
      '/v1/sets/99999-1': { $status: 404, success: false, code: 'set_nicht_gefunden', error: 'Set nicht gefunden' },
      '/v1/catalog/sets/99999-1': {
        $status: 404,
        success: false,
        code: 'katalog_nicht_geladen',
        error: 'Katalog nicht geladen',
      },
    },
    '99999',
  );
  try {
    assert.match(hinweis, /Set-Katalog ist noch nicht geladen/);
    assert.doesNotMatch(hinweis, /Nummer prüfen/);
    assert.equal(knopf, 'Trotzdem anlegen');
  } finally {
    w.close();
  }
});
