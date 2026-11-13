/**
 * Eine von Hand eingetragene BrickLink-Nummer gilt nur für das Konto, das sie
 * einträgt (bl_zuordnung_eigen, Migration 0094). Zwei Konten ohne Haushalt:
 * Anna korrigiert beim Wanted-Import und an ihrer Figur, Bruno sieht weiter
 * die gemeinsame Zuordnung — in Preisabruf, Figurenpreis, Bewertung und …
 *
 * Gegenproben (am 04.11.2026 gemessen, je eine Änderung, danach zurück):
 *   A  routes/api_v1/wanted.ts: merkeNummer schreibt immer merkeBlNummer →
 *      rot: alle sieben Teiltests (Annas 3001 füllt den Vermerk für 3003)
 *   B  db/blZuordnungSql.ts: blNummerSql ohne `_e.bl_id` → rot: „Bewertung“
 *      (Anna sieht die gemeinsame Nummer)
 *   C  resolveBlPartNumber() übergeht `konto` → rot: „Preisabruf“
 *   D  schreibeBlNummer() wieder mit `DO UPDATE SET bl_id=…` ohne WHERE → rot:
 *      „die gemeinsame Zuordnung wird nur gefüllt, nie ersetzt“
 *   E  manuelleFiguren.ts schreibt die BrickLink-Nr. wieder mit merkeBlNummer →
 *      rot: „die BrickLink-Nr. einer eigenen Figur …“
 *
 * REQUIRE_DB=1.
 */
require('./helpers/systemrahmen');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const { importWorker } = require('./helpers/auftraege');
const db = testDaten();
const { testServer } = require('./helpers/server');

test.after(async () => {
  await db.pool.end().catch(() => {});
});

const item = (typ, id, farbe) =>
  `<ITEM><ITEMTYPE>${typ}</ITEMTYPE><ITEMID>${id}</ITEMID>` +
  (farbe === null ? '' : `<COLOR>${farbe}</COLOR>`) +
  '<MINQTY>1</MINQTY><CONDITION>N</CONDITION></ITEM>';
const liste = (...i) => `<?xml version="1.0" encoding="UTF-8"?>\n<INVENTORY>${i.join('')}</INVENTORY>\n`;

async function hochladen(base, xml, korrekturen) {
  const fd = new FormData();
  fd.append('file', new Blob([xml], { type: 'text/xml' }), 'wanted.xml');
  fd.append('korrekturen', JSON.stringify(korrekturen));
  const r = await fetch(`${base}/api/v1/wanted-list/import/xml?schreiben=1`, { method: 'POST', body: fd });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

test('BrickLink-Zuordnung je Konto', { concurrency: 1 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    keineDb(t, e);
    return;
  }
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  importWorker(t, _req);
  {
    const c = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(c);
    } finally {
      c.release();
    }
  }

  const neu = async name =>
    (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [name])).id;
  const ANNA = await neu('anna'),
    BRUNO = await neu('bruno');
  await db.run(
    `INSERT INTO part_catalog (part_number, part_name) VALUES ('3001','Brick 2 x 4'), ('3003','Brick 2 x 2')`,
  );
  await db.run(`INSERT INTO part_color_catalog (part_number, color_id, color_name, image_url)
                VALUES ('3001',4,'Red','https://cdn.rebrickable.com/a.jpg'), ('3003',4,'Red','https://cdn.rebrickable.com/b.jpg')`);
  await db.run(`INSERT INTO minifigs_catalog (fig_number, fig_name, image_url)
                VALUES ('fig-000001','Han Solo','https://cdn.rebrickable.com/f.jpg')`);
  await db.run(`INSERT INTO rb_colors (id, name, bl_color_id) VALUES (4,'Red',5)`);
  // Geprüft: 3003 heisst bei BrickLink gleich, die Figur sw0001.
  await db.run(
    `INSERT INTO bl_zuordnung (art, rb_id, bl_id) VALUES ('part','3003',NULL), ('fig','fig-000001','sw0001')`,
  );
  const gemeinsam = async () =>
    (await db.all('SELECT art, rb_id, bl_id FROM bl_zuordnung ORDER BY art, rb_id')).map(
      z => `${z.art}|${z.rb_id}|${z.bl_id}`,
    );
  const vorher = await gemeinsam();

  // Bruno hält dieselben Dinge, damit seine Bewertung Zeilen hat.
  const { addManualPart } = _req('src/teile/manuelleTeile.js');
  const { addManualFig, updateManualFig } = _req('src/figuren/manuelleFiguren.js');
  await addManualPart(BRUNO, { part_number: '3003', color_id: 4, quantity: 1, unit_price: 1 });
  await addManualFig(BRUNO, { fig_number: 'fig-000001', quantity: 1, unit_price: 1 });

  const anna = testServer(_req, {
    sitzung: { userId: ANNA },
    apiNutzer: { user_id: ANNA, is_admin: 0 },
    routen: { '/api/v1': 'routes/api_v1/index.js' },
    t,
  });

  await t.test('der Import schreibt nur Annas Zuordnung', async () => {
    const { status, body } = await hochladen(anna.base, liste(item('M', 'sw0001a', null), item('P', '3001', 5)), [
      { index: 0, blId: 'sw0001a', art: 'fig', rbId: 'fig-000001' },
      { index: 1, blId: '3001', art: 'part', rbId: '3003', rbFarbe: 4 },
    ]);
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.korrekturen?.angewandt, 2, JSON.stringify(body.korrekturen));
    assert.deepEqual(await gemeinsam(), vorher, 'die gemeinsame Zuordnung hat sich verändert');
    const eigen = await db.all('SELECT user_id, art, rb_id, bl_id FROM bl_zuordnung_eigen ORDER BY art');
    assert.deepEqual(
      eigen.map(z => `${z.user_id}|${z.art}|${z.rb_id}|${z.bl_id}`),
      [`${ANNA}|fig|fig-000001|sw0001a`, `${ANNA}|part|3003|3001`],
    );
  });

  const { resolveBlPartNumber, fetchPartPrice } = _req('src/finanzen/rechnung/preise.js');
  const { blNummerVon } = _req('src/katalog/blZuordnung.js');

  await t.test('Preisabruf: Anna fragt BrickLink nach 3001, Bruno nach 3003', async () => {
    assert.equal(await resolveBlPartNumber('3003', ANNA), '3001');
    assert.equal(await resolveBlPartNumber('3003', BRUNO), '3003');
    assert.equal(await resolveBlPartNumber('3003'), '3003', 'ohne Konto gilt die gemeinsame Zuordnung');
    // Der Abruf selbst liest den Preis unter der übersetzten Nummer.
    await db.run(`INSERT INTO part_price_cache (part_number, color_id, condition, currency_code, avg_price, fetched_at)
                  VALUES ('3001',5,'N','EUR',7,NOW()), ('3003',5,'N','EUR',2,NOW())`);
    assert.equal(Number((await fetchPartPrice('3003', 4, 'N', 'EUR', 24, null, ANNA))?.avg_price), 7);
    assert.equal(Number((await fetchPartPrice('3003', 4, 'N', 'EUR', 24, null, BRUNO))?.avg_price), 2);
  });

  await t.test('Figurenpreis: jedes Konto nach seiner Nummer', async () => {
    assert.equal(await blNummerVon('fig', 'fig-000001', ANNA), 'sw0001a');
    assert.equal(await blNummerVon('fig', 'fig-000001', BRUNO), 'sw0001');
  });

  await t.test('Bewertung: Nummern je Konto', async () => {
    const repo = _req('src/finanzen/prozess.js').finanzenBereich().bewertung;
    const figuren = await repo.manuelleFigurenZurBewertung([ANNA, BRUNO]);
    const teile = await repo.manuelleTeileZurBewertung([ANNA, BRUNO]);
    const je = (zeilen, feld) => Object.fromEntries(zeilen.map(z => [z.user_id, z[feld]]));
    assert.deepEqual(je(figuren, 'bl_fig_number'), { [ANNA]: 'sw0001a', [BRUNO]: 'sw0001' });
    assert.deepEqual(je(teile, 'bl_part_number'), { [ANNA]: '3001', [BRUNO]: '3003' });
  });

  await t.test('der nächste Import: Annas Korrektur löst bei Anna auf, nicht bei Bruno', async () => {
    const { loeseLokalAuf } = _req('src/merkliste/wantedAufloesung.js');
    const { leseWantedListe } = _req('src/merkliste/wantedParser.js');
    const { posten } = leseWantedListe(liste(item('P', '3001', 5)));
    assert.equal((await loeseLokalAuf(posten, ANNA))[0].rbId, '3003');
    const bruno = (await loeseLokalAuf(posten, BRUNO))[0];
    assert.equal(bruno.rbId, '3001');
    assert.equal(bruno.sicherheit, 'katalogtreffer');
  });

  await t.test('die BrickLink-Nr. einer eigenen Figur bleibt beim Konto', async () => {
    await updateManualFig(BRUNO, 'fig-000001', { bl_fig_number: 'sw9999' });
    assert.deepEqual(await gemeinsam(), vorher);
    assert.equal(await blNummerVon('fig', 'fig-000001', BRUNO), 'sw9999');
    assert.equal(await blNummerVon('fig', 'fig-000001', ANNA), 'sw0001a');
  });

  await t.test('die gemeinsame Zuordnung wird nur gefüllt, nie ersetzt', async () => {
    const { merkeBlNummer, merkeBlNummern } = _req('src/katalog/blZuordnung.js');
    await merkeBlNummer('fig', 'fig-000001', 'falsch');
    await merkeBlNummern('fig', [{ rbId: 'fig-000001', blId: 'auch-falsch' }]);
    await merkeBlNummer('part', '3003', '3003b');
    await merkeBlNummer('part', '3004', '3004');
    assert.deepEqual(
      await gemeinsam(),
      ['fig|fig-000001|sw0001', 'part|3003|3003b', 'part|3004|null'],
      'ein vorhandener Wert bleibt, ein leerer wird gefüllt, ein neuer angelegt',
    );
  });
});
