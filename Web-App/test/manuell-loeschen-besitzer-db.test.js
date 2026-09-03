/**
 * Der Papierkorb löscht die Karte, auf die geklickt wurde.
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 * Der manuelle Bereich zeigt im Haushalt die Einträge ALLER Konten — mit
 * Besitzer-Plakette und einem Papierkorb je Karte (getManualParts und
 * getManualMinifigs lesen `user_id = ANY(uids)`). Die Löschroute bekam aber
 * nur Nummer und Farbe und löschte damit immer die Zeile des AUFRUFERS.
 *
 * NACHGEMESSEN mit zwei verknüpften Konten, beide mit einem manuellen Teil
 * 3001/Farbe 4:
 *
 *     Manueller Bereich zeigt 2 Karten: [{owner:2, ×5}, {owner:3, ×9}]
 *     Hauptkonto klickt den Papierkorb der Karte des Kindes
 *     DELETE /api/v1/parts/3001/4  ->  {"success":true}
 *     NACHHER: nur noch user 3: ×9
 *
 * Geklickt war die fremde Karte, gelöscht wurde die eigene, und die Antwort
 * sagte „success". Die fremde Karte blieb stehen.
 *
 * ── Die Lösung, und warum sie so aussieht ───────────────────────────────────
 * `?owner=<id>` sagt, WESSEN Zeile gemeint ist; ob das erlaubt ist, entscheidet
 * resolveWriteTarget() über canWriteFor() — derselbe Helfer, den das ERFASSEN
 * schon benutzt (owner_user_id). Ohne den Parameter bleibt es beim eigenen
 * Konto, ein Client, der ihn nicht kennt, läuft also unverändert weiter.
 *
 * Voraussetzung: Test-DB über TEST_DATABASE_URL (Inhalt wird geleert!).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');

async function erreichbar() {
  try { await db.get('SELECT 1'); return true; } catch { return false; }
}

test('der Papierkorb trifft die geklickte Karte, nicht die eigene', async (t) => {
  if (!await erreichbar()) {
    if (process.env.REQUIRE_DB === '1') assert.fail('Test-DB nicht erreichbar, REQUIRE_DB=1');
    t.skip('keine Test-DB'); return;
  }
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchemaOnce();
  t.after(() => db.pool.end());

  await db.run(`INSERT INTO users (username,password_hash) VALUES ('haupt','x'),('kind','x'),('fremd','x')`);
  const id = async (n) => (await db.get(`SELECT id FROM users WHERE username=$1`, [n])).id;
  const haupt = await id('haupt'), kind = await id('kind'), fremd = await id('fremd');
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2)`, [haupt, kind]);

  // Dieselbe Nummer bei beiden — genau der Fall, den die Route nicht
  // unterscheiden konnte.
  await db.run(`INSERT INTO parts (user_id,part_number,color_id,part_name,quantity,source)
                VALUES ($1,'3001',4,'Brick 2x4',5,'manual'), ($2,'3001',4,'Brick 2x4',9,'manual')`, [haupt, kind]);
  await db.run(`INSERT INTO minifigs (user_id,fig_number,fig_name,quantity,source)
                VALUES ($1,'sw0001','Luke',1,'manual'), ($2,'sw0001','Luke',2,'manual')`, [haupt, kind]);

  const { base } = testServer(_req, {
    sitzung: { userId: haupt },
    apiNutzer: { user_id: haupt, is_admin: 0, username: 'haupt' },
    routen: { '/api/v1': 'routes/api_v1/index.js' },
    t,
  });
  const ruf = async (pfad, methode = 'GET') => {
    const r = await fetch(base + pfad, { method: methode });
    return { status: r.status, body: await r.json() };
  };
  const teile = async () => (await db.all(
    `SELECT user_id, quantity FROM parts WHERE part_number='3001' ORDER BY user_id`))
    .map(r => `${r.user_id}:${r.quantity}`);
  const figuren = async () => (await db.all(
    `SELECT user_id FROM minifigs WHERE fig_number='sw0001' ORDER BY user_id`)).map(r => r.user_id);

  assert.deepEqual(await teile(), [`${haupt}:5`, `${kind}:9`], 'Vorlage');

  // Die Karte des KINDES löschen.
  const a = await ruf(`/api/v1/parts/3001/4?owner=${kind}`, 'DELETE');
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.deepEqual(await teile(), [`${haupt}:5`],
    'Geklickt war die Karte des Unterkontos — genau die muss weg sein, und die eigene bleiben');

  // Danach die eigene, ohne Parameter (Verhalten wie vorher).
  const b = await ruf('/api/v1/parts/3001/4', 'DELETE');
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.deepEqual(await teile(), [], 'Ohne owner das eigene Konto');

  // Dasselbe für Minifiguren.
  assert.deepEqual(await figuren(), [haupt, kind], 'Vorlage Minifiguren');
  const c = await ruf(`/api/v1/minifigs/sw0001?owner=${kind}`, 'DELETE');
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.deepEqual(await figuren(), [haupt], 'Die Figur des Unterkontos muss weg sein');

  // Ein Konto ausserhalb des Haushalts geht nicht — der Parameter ist eine
  // Angabe der Ansicht, kein Zugriffsweg.
  const d = await ruf(`/api/v1/minifigs/sw0001?owner=${fremd}`, 'DELETE');
  assert.equal(d.status, 403, 'Fremdes Konto muss abgelehnt werden, nicht stillschweigend ignoriert');
  assert.deepEqual(await figuren(), [haupt], 'und nichts anfassen');
});
