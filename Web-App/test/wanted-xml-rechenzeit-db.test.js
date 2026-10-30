/**
 * Die Wanted-Liste (XML) darf den Server nicht mit Rechenzeit lahmlegen.
 *
 * Das faule Muster `<ITEM>([\s\S]*?)</ITEM>` setzte bei einem offenen Tag
 * ohne Ende an jeder Fundstelle neu an: 469 KB `<ITEM>` hielten einen Worker
 * 8,4 s fest, quadratisch wachsend. Dazu nahm die Route 15 MB an.
 *
 * ── Gegenproben (durchgeführt, Befunde GEMESSEN) ────────────────────────────
 *
 *   a) leseWantedListe wieder mit dem faulen Muster für ITEM
 *      → 1 rot („ITEM ohne Ende: 8376 ms")
 *   b) feld() wieder mit dem faulen Muster → 1 rot („ITEMID ohne Ende: 6285 ms")
 *   c) Tag-Suche ohne Flag i → 2 rot (der klein geschriebene Posten fehlte)
 *   d) Route wieder mit csvEmpfang (15 MB) → 3 rot (Status 200, 29 138 Posten)
 *
 * Voraussetzung für Fall 3: Test-DB via TEST_DATABASE_URL. Ohne DB: skip,
 * ausser REQUIRE_DB=1.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const { leseWantedListe } = _req('utils/wantedListe.js');
const { XML_MAX_BYTES } = _req('utils/dateiEmpfang.js');
const { testServer } = require('./helpers/server');

test.after(async () => { await db.pool.end().catch(() => {}); });

function item(id, farbe, menge) {
  return `<ITEM><ITEMTYPE>P</ITEMTYPE><ITEMID>${id}</ITEMID><COLOR>${farbe}</COLOR>`
       + `<MAXPRICE>-1.0000</MAXPRICE><MINQTY>${menge}</MINQTY><CONDITION>X</CONDITION></ITEM>\n`;
}

function dauer(f) {
  const t = process.hrtime.bigint();
  const r = f();
  return { r, ms: Number(process.hrtime.bigint() - t) / 1e6 };
}

test('1. offene Tags ohne Ende kosten keine quadratische Rechenzeit', () => {
  // Je rund 480 KB; die alte Fassung brauchte dafür 8 bis 11 s.
  const faelle = {
    'ITEM ohne Ende':   '<INVENTORY>' + '<ITEM>'.repeat(80000),
    'ITEMID ohne Ende': '<INVENTORY><ITEM>' + '<ITEMID>'.repeat(60000) + '</ITEM>',
  };
  for (const [name, xml] of Object.entries(faelle)) {
    const { r, ms } = dauer(() => leseWantedListe(xml));
    assert.ok(ms < 500, `${name}: ${ms.toFixed(0)} ms — das Zerlegen ist nicht linear`);
    assert.equal(r.posten.length, 0, `${name}: ${r.posten.length} Posten aus Müll gelesen`);
  }
});

test('2. gültige Posten bleiben richtig, auch neben einem offenen Block', () => {
  const xml = '<INVENTORY>\n' + item('3001', 5, 3) + item('x126', 95, 14)
    + '<item><itemtype>P</itemtype><itemid>3002</itemid><minqty>2</minqty></item>\n'
    + '<ITEM><ITEMTYPE>P</ITEMTYPE><ITEMID>offen</ITEMID>\n</INVENTORY>';
  const r = leseWantedListe(xml);
  assert.deepEqual(r.posten.map(p => [p.blId, p.blFarbe, p.menge]),
    [['3001', 5, 3], ['x126', 95, 14], ['3002', null, 2]],
    'Die geschlossenen Blöcke werden gelesen, Klein-Schreibung inbegriffen; der offene nicht');
});

test('3. die Route weist eine Liste über der XML-Grenze ab', async (t) => {
  try { await db.get('SELECT 1'); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  await db.run(`INSERT INTO users (username,password_hash) VALUES ('xmlgrenze','x')`);
  const uid = (await db.get(`SELECT id FROM users WHERE username='xmlgrenze'`)).id;
  const srv = testServer(_req, {
    sitzung: { userId: uid }, apiNutzer: { user_id: uid, is_admin: 0 },
    routen: { '/api/v1': 'routes/api_v1/index.js' }, t,
  });
  const senden = async (xml) => {
    const fd = new FormData();
    fd.append('file', new Blob([xml], { type: 'text/xml' }), 'wanted.xml');
    const r = await fetch(`${srv.base}/api/v1/wanted-list/import/xml`, { method: 'POST', body: fd });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };

  // Eine GÜLTIGE Liste knapp über der Grenze — abgewiesen wird die Grösse,
  // nicht der Inhalt. Die Posten sind alle unbekannt, die Vorschau schreibt nichts.
  const ein = item('99999', 5, 1);
  const gross = '<INVENTORY>\n' + ein.repeat(Math.ceil(XML_MAX_BYTES / ein.length) + 10) + '</INVENTORY>';
  assert.ok(Buffer.byteLength(gross) > XML_MAX_BYTES);
  const zuGross = await senden(gross);
  assert.notEqual(zuGross.status, 200, `Status ${zuGross.status}: ${JSON.stringify(zuGross.body).slice(0, 200)}`);
  assert.ok(zuGross.status >= 400, `Status ${zuGross.status} statt einer Absage`);

  const klein = await senden('<INVENTORY>\n' + item('99999', 5, 1) + '</INVENTORY>');
  assert.equal(klein.status, 200, `kleine Liste: ${klein.status} ${JSON.stringify(klein.body)}`);
  assert.equal(klein.body.gelesen, 1);
});
