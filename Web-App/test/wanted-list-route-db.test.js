/**
 * The wanted list import via its real address.
 *
 * ── Counter-checks (performed, findings MEASURED) ───────────────────────────
 *
 *   a) preview no longer the default (always writes) → 2 AND 4 red
 *   b) <INVENTORY> check removed                    → 1 red
 *   c) BL number taken raw instead of mapped        → 4 red
 *   d) BL color taken instead of the mapped one     → 4 red
 *   e) (14.11.2026) in the wanted creator for sets `ifPresent: 'aufstocken'`
 *      omitted → 9 red (`aufgestockt` 0: the second time said “exists”)
 *
 * Two predictions were too narrow, and both say something about this test:
 *
 * For (a) I had only expected case 2. 4 turned red as well, and rightly so:
 * if the preview writes, parts are already there in the later write run, and
 * `angelegt` is no longer right. A chain effect — case 2 is the finding,
 * case 4 the consequence.
 *
 * For (c) I had expected 3 AND 4. Only 4 turned red. Case 3 counts the
 * LEVELS, and they are right even if the wrong number is taken over
 * — it does not check the mapping. Case 4 does, and only it.
 *
 * So a lot hangs on case 4: mapping of the number, mapping of the color,
 * quantity, and that the open item stays outside. That is deliberate — the
 * four statements belong to ONE operation (“what is in the holdings after
 * writing”), and checking them individually would mean running the same
 * import four times.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL. Without DB: skip, unless
 * REQUIRE_DB=1.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const { importWorker } = require('./helpers/jobs');
const { catalogSet } = require('./helpers/inventory');
const db = testData();
const { testServer } = require('./helpers/server');

test.after(async () => {
  await db.pool.end().catch(() => {});
});

let MAIN = 0;

function item(typ, id, farbe, quantity = 1) {
  return (
    `<ITEM>\n<ITEMTYPE>${typ}</ITEMTYPE>\n<ITEMID>${id}</ITEMID>\n` +
    (farbe === null ? '' : `<COLOR>${farbe}</COLOR>\n`) +
    `<MAXPRICE>-1.0000</MAXPRICE>\n<MINQTY>${quantity}</MINQTY>\n` +
    `<CONDITION>X</CONDITION>\n<NOTIFY>N</NOTIFY>\n</ITEM>`
  );
}
const liste = (...i) => `<?xml version="1.0" encoding="UTF-8"?>\n<INVENTORY>\n${i.join('\n')}\n</INVENTORY>\n`;

/** The test's file: two resolvable parts, one open. */
const XML = liste(
  item('P', '3001', 5, 3), // bl_mapping: NULL registration → stage 2
  item('P', '4162', 1, 2), // bl_mapping: deviating number → stage 1
  item('P', '99999', 5, 1), // nothing → open
);

async function hochladen(base, xml, abfrage = '') {
  const fd = new FormData();
  fd.append('file', new Blob([xml], { type: 'text/xml' }), 'wanted.xml');
  const r = await fetch(`${base}/api/v2/wanted-list/import/xml${abfrage}`, { method: 'POST', body: fd });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

/** The same address, but the response read LINE BY LINE (NDJSON). */
async function uploadStream(base, xml, abfrage) {
  const fd = new FormData();
  fd.append('file', new Blob([xml], { type: 'text/xml' }), 'wanted.xml');
  const r = await fetch(`${base}/api/v2/wanted-list/import/xml${abfrage}`, { method: 'POST', body: fd });
  const roh = await r.text();
  const zeilen = roh
    .split('\n')
    .filter(z => z.trim())
    .map(z => JSON.parse(z));
  return { status: r.status, typ: r.headers.get('content-type') || '', zeilen };
}

async function setup() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const c = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(c);
  } finally {
    c.release();
  }
  await db.run(`INSERT INTO users (username,password_hash) VALUES ('haupt','x')`);
  MAIN = (await db.get(`SELECT id FROM users WHERE username='haupt'`)).id;
  await db.run(`INSERT INTO part_catalog (part_number, part_name)
                VALUES ('3001','Brick 2x4'), ('98765','Umgetauft')`);
  await db.run(`INSERT INTO part_color_catalog (part_number,color_id,color_name)
                VALUES ('3001',4,'Rot'), ('98765',15,'Weiss')
                ON CONFLICT (part_number,color_id) DO NOTHING`);
  await db.run(`INSERT INTO bl_mapping (type, rb_id, bl_id)
                VALUES ('part','98765','4162'), ('part','3001', NULL)`);
  await db.run(`INSERT INTO rb_colors (id,name,bl_color_id) VALUES (4,'Red',5),(15,'White',1)`);
}

test('wanted list: preview and writing via the real address', { concurrency: 1 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    keineDb(t, e);
    return;
  }
  await setup();

  importWorker(t, _req);
  const srv = testServer(_req, { sitzung: { userId: MAIN }, t });

  await t.test('1. a file without <INVENTORY> is rejected beforehand', async () => {
    const { status, body } = await hochladen(srv.base, '<?xml version="1.0"?>\n<FOO/>\n');
    assert.equal(status, 422, `Erwartet 422, bekam ${status}`);
    assert.match(
      String(body.error || ''),
      /Wanted-Liste/,
      `Abgelehnt mit „${body.error}" — der Text soll sagen, DASS es keine Liste ist. ` +
        '„0 Posten gelesen" wäre mehrdeutig: Das kann auch eine leere Liste sein.',
    );
  });

  await t.test('2. the preview writes NOTHING', async () => {
    const { status, body } = await hochladen(srv.base, XML);
    assert.equal(status, 200, `Erwartet 200, bekam ${status}: ${JSON.stringify(body)}`);
    assert.equal(body.preview, true, 'Ohne schreiben=1 ist das keine Vorschau');
    assert.equal(body.parsed, 3, `${body.parsed} Posten gelesen statt 3`);
    assert.equal(body.created, 0, `${body.created} angelegt — die Vorschau schreibt nicht`);

    // Checked against the TABLE and not the response: a route that
    // reports "vorschau: true" and writes anyway would look right in the
    // response.
    assert.equal(
      (await db.get('SELECT COUNT(*)::int c FROM parts WHERE user_id=$1', [MAIN])).c,
      0,
      'Die Vorschau hat Teile angelegt',
    );
  });

  await t.test('3. the preview names the stages separately and the open items', async () => {
    const { body } = await hochladen(srv.base, XML);
    assert.deepEqual(
      body.levels,
      { gleich_vermerkt: 1, zuordnung: 1 },
      `Stufen: ${JSON.stringify(body.levels)} — erwartet je eine aus bl_mapping`,
    );
    assert.equal(body.open.length, 1, `${body.open.length} offen statt 1`);
    assert.equal(
      body.open[0].blId,
      '99999',
      'Der offene Posten wird nicht mit seiner BrickLink-Nummer genannt — dann kann ' + 'ihn niemand nachsehen',
    );
    // Rebrickable was NOT asked: without rebrickable=1 the import costs
    // no quota.
    assert.equal(body.rebrickable, undefined, 'Es wurde bei Rebrickable gefragt, obwohl rebrickable=1 fehlte');
  });

  await t.test('4. with schreiben=1 manual parts are created — with quantity and color', async () => {
    const { body } = await hochladen(srv.base, XML, '?write=1');
    assert.equal(body.preview, false);
    assert.equal(body.created, 2, `${body.created} angelegt statt 2: ${JSON.stringify(body.items)}`);
    assert.equal(body.failed, 0, `${body.failed} Fehler: ${JSON.stringify(body.items)}`);

    // Stage 2: the number stays, the color is mapped (BL 5 → RB 4).
    const a = await db.get(
      `SELECT p.color_id, COALESCE(SUM(pa.quantity),0)::int AS quantity
         FROM parts p LEFT JOIN part_acquisitions pa
           ON pa.user_id=p.user_id AND pa.part_number=p.part_number AND pa.color_id=p.color_id
        WHERE p.user_id=$1 AND p.part_number='3001' GROUP BY p.color_id`,
      [MAIN],
    );
    assert.ok(a, '3001 wurde nicht angelegt');
    assert.equal(Number(a.color_id), 4, `Farbe ${a.color_id} statt 4 (BL 5 = Rebrickable 4)`);
    assert.equal(a.quantity, 3, `Menge ${a.quantity} statt 3 — MINQTY war 3`);

    // Stage 1: the deviating number must be CONVERTED, not taken over.
    assert.ok(
      await db.get(`SELECT 1 FROM parts WHERE user_id=$1 AND part_number='98765'`, [MAIN]),
      'Die BrickLink-Nummer 4162 wurde nicht auf 98765 abgebildet',
    );
    assert.equal(
      (await db.get(`SELECT COUNT(*)::int c FROM parts WHERE user_id=$1 AND part_number='4162'`, [MAIN])).c,
      0,
      'Die BrickLink-Nummer 4162 steht roh im Bestand — sie ist KEINE ' +
        'Rebrickable-Nummer, und ein Teil darunter findet keinen Katalogeintrag',
    );

    // The open item was NOT created.
    assert.equal(
      (await db.get(`SELECT COUNT(*)::int c FROM parts WHERE user_id=$1 AND part_number='99999'`, [MAIN])).c,
      0,
      'Ein Posten ohne bekannte Rebrickable-Nummer wurde trotzdem angelegt',
    );
  });

  await t.test('5. no purchase price from MAXPRICE', async () => {
    // MAXPRICE is a SEARCH LIMIT, not a price paid. Here it is -1, and
    // even a real value must not end up as purchase price — otherwise the
    // finance view would show an amount nobody spent.
    // The column is called `unit_price`, not `price` — looked up after my …
    const preise = await db.all('SELECT unit_price FROM part_acquisitions WHERE user_id=$1', [MAIN]);
    assert.ok(preise.length > 0, 'Vorbedingung: es gibt Erfassungen');
    for (const p of preise) {
      assert.ok(
        p.unit_price === null || Number(p.unit_price) >= 0,
        `Ein Kaufpreis von ${p.unit_price} ist aus MAXPRICE entstanden — MAXPRICE ist ` +
          'eine Suchgrenze, kein bezahlter Preis',
      );
    }
  });

  await t.test('6. foreign kinds are in the report', async () => {
    const mit = liste(item('P', '3001', 5), item('B', '5002', null), item('G', '6001', null));
    const { body } = await hochladen(srv.base, mit);
    assert.deepEqual(
      body.foreignTypes,
      { B: 1, G: 1 },
      `fremdeArten: ${JSON.stringify(body.foreignTypes)} — ein Buch und ein Zubehör`,
    );
  });

  // The progress

  await t.test('7. with strom=1 progress lines come, finally the report', async () => {
    const { status, typ, zeilen } = await uploadStream(srv.base, XML, '?write=1&stream=1');
    assert.equal(status, 200);
    assert.match(
      typ,
      /ndjson/,
      `Content-Type „${typ}" — eine Zeilen-Antwort darf nicht als application/json ` +
        'ausgegeben werden, sonst versucht der Browser sie als EIN Dokument zu lesen',
    );

    // The import runs as a job; the request reads its state at intervals,
    // so intermediate states can coincide. The last one always arrives.
    const melde = zeilen.filter(z => z.progress);
    assert.ok(melde.length >= 1, 'keine Fortschrittszeile');
    const fertig = melde.map(z => z.progress.done);
    assert.deepEqual(
      fertig,
      [...fertig].sort((a, b) => a - b),
      'Die Zählung muss aufsteigen',
    );
    assert.equal(fertig.at(-1), 3, 'Der letzte Stand nennt alle Posten (sonst bliebe der Balken vor dem Ende stehen)');
    for (const z of melde) {
      assert.equal(z.progress.total, 3, 'Der Nenner ist die Zahl der Posten');
      assert.equal(z.progress.phase, 'write');
    }

    const letzte = zeilen[zeilen.length - 1];
    assert.equal(letzte.success, true, 'Die letzte Zeile ist der Bericht');
    assert.equal(letzte.preview, false, 'mit schreiben=1 ist es kein Probelauf');
    assert.equal(letzte.parsed, 3);
    assert.ok(!letzte.fortschritt, 'Der Bericht ist keine Fortschrittszeile');
  });

  // The same bar as for the set import

  await t.test('9. an import leaves a completed job', async () => {
    await db.run('DELETE FROM import_status WHERE user_id = $1', [MAIN]);
    const { body } = await hochladen(srv.base, XML, '?write=1');
    assert.equal(body.success, true);

    const job = await db.get('SELECT * FROM import_status WHERE user_id=$1', [MAIN]);
    assert.ok(
      job,
      'Ohne Auftragszeile zeigt weder die App noch eine zweite ' + 'Sitzung etwas an — genau darum geht es',
    );
    assert.equal(
      job.status,
      'done',
      `Status „${job.status}" — nach dem Import muss der Auftrag ZU sein, sonst ` +
        'steht der Balken in der App auf „läuft", bis jemand einen neuen startet',
    );
    assert.equal(Number(job.total), 3, 'Der Nenner ist die Zahl der Posten');
    assert.equal(Number(job.done), Number(job.total), 'Am Ende muss der Balken voll sein');
    assert.equal(job.current, null, 'Was „gerade dran" ist, gibt es nicht mehr');
    // buildJobStatus computes ok/warn/err from `results` — without the list the
    // bar would say "0 ok" after the end although two items were created.
    const results = Array.isArray(job.results) ? job.results : JSON.parse(job.results || '[]');
    assert.equal(
      results.filter(r => r.success).length,
      body.created + body.topped_up,
      `results zählt ${results.length} Einträge, der Bericht nennt ` +
        `${body.created} angelegt und ${body.topped_up} aufgestockt`,
    );

    // Every line NAMES its item (Marco's finding of 21.10.)
    assert.equal(results.length, 3, 'Je Posten eine Zeile, auch für den offenen');
    for (const r of results) {
      assert.ok(
        r.set_number,
        `Ein Eintrag ohne set_number: ${JSON.stringify(r)}. Daraus wird im ` + 'Protokoll „undefined – updated_at"',
      );
    }
    assert.deepEqual(
      results.map(r => r.set_number).sort(),
      ['3001', '4162', '99999'],
      'Die BrickLink-Nummern aus der Datei — das sind die Zeilen, die Marco ' +
        'hochgeladen hat. 4162 trägt bei Rebrickable eine ANDERE Nummer; im ' +
        'Protokoll steht die aus seiner Datei',
    );
    const created = results.filter(r => r.success);
    assert.ok(
      created.every(r => r.action === 'added' || r.action === 'updated'),
      `action muss 'added' oder 'updated' sein, sonst schreibt die Anzeige ` +
        `„updated_at" für alles: ${JSON.stringify(created)}`,
    );
    const open = results.find(r => r.set_number === '99999');
    assert.equal(
      open.isWarning,
      true,
      'Ein offener Posten ist eine Anmerkung, kein Fehler — dieselbe ' + 'Einteilung wie bei den Zahlen darüber',
    );
    assert.ok(open.error, 'Ohne Grund steht in der Zeile nur die Nummer');
  });

  await t.test('10. a PREVIEW creates no job', async () => {
    await db.run('DELETE FROM import_status WHERE user_id = $1', [MAIN]);
    const { body } = await hochladen(srv.base, XML);
    assert.equal(body.preview, true, 'Vorbedingung: das ist eine Vorschau');
    const job = await db.get('SELECT * FROM import_status WHERE user_id=$1', [MAIN]);
    assert.equal(
      job,
      undefined,
      'Eine Vorschau ändert nichts. Ein Balken „Import läuft" dafür wäre eine ' +
        'Lüge in drei Oberflächen gleichzeitig.',
    );
  });

  await t.test('11. a running CSV import is not displaced', async () => {
    // The CSV import of 380 sets is what someone is waiting for. Throwing it
    // out of the bar because a wanted list is being read alongside would be
    // the wrong trade — the wanted import runs anyway, just without a bar.
    await db.run(
      `INSERT INTO import_status (user_id, status, total, done, current, results, updated_at)
       VALUES ($1,'running',380,42,'10256-1','[]', NOW())
       ON CONFLICT (user_id) DO UPDATE SET status='running', total=380, done=42,
         current='10256-1', results='[]'`,
      [MAIN],
    );

    const { body } = await hochladen(srv.base, XML, '?write=1');
    assert.equal(body.success, true, 'Der Import selbst läuft weiter');

    const job = await db.get('SELECT * FROM import_status WHERE user_id=$1', [MAIN]);
    assert.equal(job.status, 'running', 'Der fremde Auftrag muss unberührt bleiben');
    assert.equal(Number(job.total), 380, `total=${job.total} — der Wanted-Import hat den CSV-Auftrag überschrieben`);
    assert.equal(Number(job.done), 42, 'auch die Zählung gehört dem anderen Import');
    assert.equal(job.current, '10256-1');
    await db.run('DELETE FROM import_status WHERE user_id = $1', [MAIN]);
  });

  await t.test('8. without strom=1 the address responds unchanged as JSON', async () => {
    // The path of the Android app and all other checks. It must NOT have
    // changed because of the stream.
    const r = await (async () => {
      const fd = new FormData();
      fd.append('file', new Blob([XML], { type: 'text/xml' }), 'wanted.xml');
      return fetch(`${srv.base}/api/v2/wanted-list/import/xml`, { method: 'POST', body: fd });
    })();
    assert.match(r.headers.get('content-type') || '', /application\/json/);
    const roh = await r.text();
    assert.ok(!roh.includes('"progress"'), 'Ohne strom=1 darf keine Fortschrittszeile in der Antwort stehen');
    const body = JSON.parse(roh);
    assert.equal(body.success, true);
    assert.equal(body.parsed, 3);
  });

  await t.test('9. a set goes through acquireSet: created, then topped up, with follow-up work', async () => {
    const SN = '76001-1';
    await catalogSet(db, SN, { name: 'Wanted-Set', minifigs: 0 });
    const datei = liste(item('S', SN, null, 2));
    const erst = (await hochladen(srv.base, datei, '?write=1')).body;
    assert.equal(erst.created, 1, JSON.stringify(erst));
    const dann = (await hochladen(srv.base, datei, '?write=1')).body;
    assert.equal(dann.topped_up, 1, JSON.stringify(dann));
    const quantity = await db.get(
      'SELECT SUM(quantity)::int AS n FROM set_acquisitions WHERE user_id = $1 AND set_number = $2',
      [MAIN, SN],
    );
    assert.equal(quantity.n, 4);
    const nacharbeit = await db.all("SELECT 1 FROM jobs WHERE type = 'rework' AND payload->>'set_number' = $1", [SN]);
    assert.ok(nacharbeit.length >= 1, 'ohne Nacharbeit bliebe das Set ohne Katalog');
  });
});
