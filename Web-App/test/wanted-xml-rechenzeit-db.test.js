/**
 * The wanted list (XML) must not paralyze the server with computing time.
 *
 * The lazy pattern `<ITEM>([\s\S]*?)</ITEM>` restarted at every match for an
 * open tag without an end: 469 KB of `<ITEM>` held a worker for
 * 8.4 s, growing quadratically. On top of that the route accepted 15 MB.
 *
 * ── Counter-checks (performed, findings MEASURED) ───────────────────────────
 *
 *   a) readWantedList again with the lazy pattern for ITEM
 *      → 1 red („ITEM ohne Ende: 8376 ms")
 *   b) feld() again with the lazy pattern → 1 red („ITEMID ohne Ende: 6285 ms")
 *   c) tag search without flag i → 2 red (the lowercase item was missing)
 *   d) route again with csvReceive (15 MB) → 3 red (status 200, 29 138 items)
 *
 * Prerequisite for case 3: test DB via TEST_DATABASE_URL. Without DB: skip,
 * unless REQUIRE_DB=1.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const { importWorker } = require('./helpers/jobs');
const db = testData();
const { readWantedList } = _req('src/wanted/wantedParser.js');
const { XML_MAX_BYTES } = _req('src/http/fileUpload.js');
const { testServer } = require('./helpers/server');

test.after(async () => {
  await db.pool.end().catch(() => {});
});

function item(id, farbe, quantity) {
  return (
    `<ITEM><ITEMTYPE>P</ITEMTYPE><ITEMID>${id}</ITEMID><COLOR>${farbe}</COLOR>` +
    `<MAXPRICE>-1.0000</MAXPRICE><MINQTY>${quantity}</MINQTY><CONDITION>X</CONDITION></ITEM>\n`
  );
}

function duration(f) {
  const t = process.hrtime.bigint();
  const r = f();
  return { r, ms: Number(process.hrtime.bigint() - t) / 1e6 };
}

test('1. open tags without an end cost no quadratic computing time', () => {
  // About 480 KB each; the old version needed 8 to 11 s for it.
  const faelle = {
    'ITEM ohne Ende': '<INVENTORY>' + '<ITEM>'.repeat(80000),
    'ITEMID ohne Ende': '<INVENTORY><ITEM>' + '<ITEMID>'.repeat(60000) + '</ITEM>',
  };
  for (const [name, xml] of Object.entries(faelle)) {
    const { r, ms } = duration(() => readWantedList(xml));
    assert.ok(ms < 500, `${name}: ${ms.toFixed(0)} ms — das Zerlegen ist nicht linear`);
    assert.equal(r.items.length, 0, `${name}: ${r.items.length} Posten aus Müll gelesen`);
  }
});

test('2. valid items stay correct, even next to an open block', () => {
  const xml =
    '<INVENTORY>\n' +
    item('3001', 5, 3) +
    item('x126', 95, 14) +
    '<item><itemtype>P</itemtype><itemid>3002</itemid><minqty>2</minqty></item>\n' +
    '<ITEM><ITEMTYPE>P</ITEMTYPE><ITEMID>offen</ITEMID>\n</INVENTORY>';
  const r = readWantedList(xml);
  assert.deepEqual(
    r.items.map(p => [p.blId, p.blColor, p.quantity]),
    [
      ['3001', 5, 3],
      ['x126', 95, 14],
      ['3002', null, 2],
    ],
    'Die geschlossenen Blöcke werden gelesen, Klein-Schreibung inbegriffen; der offene nicht',
  );
});

test('3. the route rejects a list above the XML limit', async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    keineDb(t, e);
    return;
  }
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const c = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(c);
  } finally {
    c.release();
  }
  await db.run(`INSERT INTO users (username,password_hash) VALUES ('xmlgrenze','x')`);
  const uid = (await db.get(`SELECT id FROM users WHERE username='xmlgrenze'`)).id;
  importWorker(t, _req);
  const srv = testServer(_req, { sitzung: { userId: uid }, t });
  const senden = async xml => {
    const fd = new FormData();
    fd.append('file', new Blob([xml], { type: 'text/xml' }), 'wanted.xml');
    const r = await fetch(`${srv.base}/api/v2/wanted-list/import/xml`, { method: 'POST', body: fd });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };

  // A VALID list just above the limit — the size is rejected,
  // not the content. The items are all unknown, the preview writes nothing.
  const ein = item('99999', 5, 1);
  const gross = '<INVENTORY>\n' + ein.repeat(Math.ceil(XML_MAX_BYTES / ein.length) + 10) + '</INVENTORY>';
  assert.ok(Buffer.byteLength(gross) > XML_MAX_BYTES);
  const tooLarge = await senden(gross);
  assert.notEqual(tooLarge.status, 200, `Status ${tooLarge.status}: ${JSON.stringify(tooLarge.body).slice(0, 200)}`);
  assert.ok(tooLarge.status >= 400, `Status ${tooLarge.status} statt einer Absage`);

  const klein = await senden('<INVENTORY>\n' + item('99999', 5, 1) + '</INVENTORY>');
  assert.equal(klein.status, 200, `kleine Liste: ${klein.status} ${JSON.stringify(klein.body)}`);
  assert.equal(klein.body.parsed, 1);
});
