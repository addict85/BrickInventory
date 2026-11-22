/**
 * Checks from the review pass hardened-131.
 *
 * Counter-checks (measured 08.11.2026, each on its own):
 *   A  in the stream route the first send() moved before the registration of the listeners
 *      → red: “the CSV progress stream survives back pressure …”
 *      (ReferenceError in cleanup); the unsubscribe (subscribeCsvImportStatus) deleted in cleanup → red
 *      „kein Hörer bleibt …“ (15.11.2026: 1 subscribed, 0 unsubscribed)
 * Deleted because executed elsewhere: session keys in production →
 * startverbot.test.js K/L, compose.yaml without SESSION_SECRET → compose-
 * secrets A; path normalization → security-across-cut-db I.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { ROOT, buildAndRequire, ohneKommentare, testData, testAccess } = require('./helpers/sources');
const _reqCsv = buildAndRequire();
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const { portOf } = require('./helpers/server');
const db = testData();

/** Read a file without comments (see ohneKommentare() in helpers/sources.js). */
function source(...parts) {
  return ohneKommentare(fs.readFileSync(path.join(ROOT, ...parts), 'utf8'));
}

// ── Behavior ───────────────────────────────────────────────────────────────

async function dbReachable() {
  try {
    await db.get('SELECT 1 AS ok');
    return true;
  } catch {
    return false;
  }
}

test('parts fallback for foreign sets', async t => {
  if (!(await dbReachable())) {
    keineDb(t);
    return;
  }

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  // And the migrations: since migration 0034 the parts list reads from
  // part_catalog and part_color_catalog, and those only exist there —
  // initSchema() does not create them.
  const c0 = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(c0);
  } finally {
    c0.release();
  }
  await db.run(`INSERT INTO users (username, password_hash) VALUES ('marco','x')`);
  const uid = (await db.get(`SELECT id FROM users WHERE username='marco'`)).id;

  const { partsQuery } = require('./helpers/sources').handlerModule(_req);

  await t.test('without own parts the list comes from the CSV stock', async () => {
    await db.run(`INSERT INTO rb_inventories (id, set_num, version) VALUES (1,'10280-1',1)`);
    await db.run(
      `INSERT INTO rb_parts (part_num, name, part_img_url) VALUES ('3001','Brick 2x4','https://example.invalid/3001.png')`,
    );
    await db.run(`INSERT INTO rb_colors (id, name, rgb) VALUES (4,'Red','C91A09')`);
    await db.run(`INSERT INTO rb_inventory_parts (inventory_id, part_num, color_id, quantity, is_spare)
                  VALUES (1,'3001',4,6,false)`);

    const r = await partsQuery([uid], { set_number: '10280-1' });
    assert.equal(r.source, 'csv_cache', `Quelle war ${r.source}`);
    assert.equal(r.total, 1);
    assert.equal(r.parts[0].part_number, '3001');
  });

  await t.test('without a CSV entry and without an API key there is an empty list instead of an error', async () => {
    // The earlier crash lay exactly here: the API fallback level called a
    // name that the parts module never exported — TypeError instead of
    // a response. Without a key the branch is skipped; THAT it no longer throws a
    // TypeError is secured by test/require-exports.test.js.
    const r = await partsQuery([uid], { set_number: '99999-1' });
    assert.equal(r.total, 0);
    assert.equal(r.source, 'db');
  });
});
test.after(() => db.pool.end().catch(() => {}));

// ── Rules ──────────────────────────────────────────────────────────────────

test('image downloads are capped', () => {
  const src = source('src/images/setImages.ts');
  const fn = src.slice(src.indexOf('async function downloadSetImage'));
  const ende = fn.indexOf('\n}\n');
  const body = fn.slice(0, ende);

  assert.doesNotMatch(
    body,
    /fs\.writeFileSync|fs\.existsSync/,
    'blockierende Dateizugriffe im Anfragepfad — dieselbe Sache wie in routes/parts.ts',
  );
  // fetchImage (clients/imageCdn.ts) goes via the same helper with a redirect limit.
  assert.match(
    body,
    /(?:hole(?:Https|Bild)|fetch(?:Https|Image))\(url, \{/,
    'eigener Abruf statt des Helfers mit Umleitungsgrenze',
  );
  assert.match(body, /MAX_BYTES/, 'kein Grössendeckel — eine beliebig grosse Antwort landet komplett im Speicher');
});

test('write endpoints without login carry a throttle', () => {
  // routes/auth.ts is the only router without a continuous requireLogin —
  // here stand the endpoints that are naturally reachable before login.
  // Every writing one may either require a login (via
  // middleware or in the body), or it counts attempts per IP. qr-login had …
  const src = ohneKommentare(require('./helpers/sources').loginSource());
  // Old form router.post('/pfad' and contract form router.endpoint('POST /api/v2/auth/pfad'.
  // Every route ends the body of the one before, reading ones too: a POST used to pass
  // because the GET /me after it reads req.session.userId.
  const stellen = [
    ...src.matchAll(/router\.(?:(get|post|put|delete)\(\s*'|endpoint\(\s*'(GET|POST|PUT|DELETE) )([^']+)'/g),
  ];
  assert.ok(stellen.length >= 6, `nur ${stellen.length} Endpunkte gefunden — die Prüfung liefe ins Leere`);
  /** Writing without login or throttle, on purpose. */
  const WITHOUT = {
    'POST /api/v2/auth/logout': 'beendet nur die Sitzung oder das Token, mit dem es gerufen wird',
  };

  const open = [];
  for (let i = 0; i < stellen.length; i++) {
    const method = (stellen[i][1] ?? stellen[i][2]).toUpperCase();
    if (method === 'GET') continue;
    const von = stellen[i].index;
    const bis = i + 1 < stellen.length ? stellen[i + 1].index : src.length;
    const rumpf = src.slice(von, bis);
    const geschuetzt =
      /requireLogin|requireToken|requireAdmin|ipThrottle|loginAllowed|checkCredentials|login\(|req\.session\??\.?\.?userId/.test(
        rumpf,
      );
    const name = `${method} ${stellen[i][3]}`;
    if (!geschuetzt && !Object.hasOwn(WITHOUT, name)) open.push(name);
  }
  assert.deepEqual(open, [], `weder Anmeldung noch Drossel: ${open.join(', ')}`);
});

test('the barcode search counts its Rebrickable calls', () => {
  // The barcode search (src/sets/barcode.ts) only asks Rebrickable via
  // rebrickableJson() — and that counts and throttles.
  const dienst = source('src/sets/barcode.ts');
  assert.match(dienst, /rebrickableJson\(/, 'die Barcode-Suche fragt Rebrickable nicht über den Client');
  assert.doesNotMatch(dienst, /https\.get\(/, 'eigener Abrufweg am Tageskontingent vorbei');
  const client = source('clients/rebrickable.ts');
  const rbJson = client.slice(
    client.indexOf('async function rebrickableJson'),
    client.indexOf('function httpsGetRobust'),
  );
  assert.match(rbJson, /dailyQuotaFree/, 'rebrickableJson zählt nicht mit');
  assert.match(rbJson, /waitForSlot/, 'rebrickableJson umgeht die Drossel');
});

test('CSV export defuses formulas, the own import reverses it', () => {
  const { csvField, defuse, defusingUndo, csvRowsClean } = _reqCsv('src/infra/csvExport.js');

  // A field that Excel would execute when opening.
  assert.equal(defuse('=HYPERLINK("http://x";"Klick")'), `'=HYPERLINK("http://x";"Klick")`);
  for (const anfang of ['=', '+', '-', '@', '\t', '\r']) {
    assert.equal(defuse(`${anfang}böse`)[0], "'", `${JSON.stringify(anfang)} nicht entschärft`);
  }

  // Numbers stay numbers — otherwise every negative purchase price would come back with an apostrophe
  // and the own importer would read it as text.
  for (const zahl of ['-5', '-5.00', '-5,00', '42']) {
    assert.equal(defuse(zahl), zahl, `${zahl} wurde fälschlich entschärft`);
  }

  // Harmless texts stay unchanged.
  assert.equal(defuse('Millennium Falcon'), 'Millennium Falcon');

  // Round trip: what the export writes the import reads back as the original.
  const original = '=1+1';
  assert.equal(defusingUndo(defuse(original)), original);
  // A field that really begins with an apostrophe stays untouched.
  assert.equal(defusingUndo("'Zitat"), "'Zitat");
  assert.deepEqual(csvRowsClean([{ a: "'=1+1", b: 'x', c: 3 }]), [{ a: '=1+1', b: 'x', c: 3 }]);

  // And the quoting stays correct: the apostrophe stands INSIDE the
  // quotation marks, otherwise the row would be broken.
  assert.equal(csvField('=A1,B1'), `"'=A1,B1"`);
});

/**
 * Semicolon, tab and carriage return separate fields or rows in Excel:
 * unquoted, the next cell would begin with a formula. Counter-checks
 * (measured 03.11.2026): A  csvField quotes again only at `",\n` → red:
 * „Rot;=1+1 bleibt eine Zelle“; B  FORMULA_START without whitespace and full
 * width → red: „ =1+1 …“.
 */
test('CSV export: separators in the field are quoted, formulas also defused after whitespace', () => {
  const { csvField, toCsv, defuse, defusingUndo, csvRowsFromRequest } = _reqCsv('src/infra/csvExport.js');
  assert.equal(csvField('Rot;=1+1'), '"Rot;=1+1"', 'Rot;=1+1 bleibt eine Zelle');
  for (const t of ['a\rb', 'a\tb', 'a\nb', 'a,b', 'a"b']) assert.equal(csvField(t)[0], '"', JSON.stringify(t));
  for (const boese of [' =1+1', '\u3000=1+1', '＝1+1', '＋1', '\n=1']) {
    assert.equal(defuse(boese)[0], "'", `${JSON.stringify(boese)} nicht entschärft`);
    assert.equal(defusingUndo(defuse(boese)), boese);
  }
  assert.equal(defuse(' -5 '), ' -5 ', 'Zahlen mit Leerraum bleiben Zahlen');
  const csv = toCsv(['a', 'b'], [{ a: 'Rot;=1+1\r=2', b: ' @SUMME(1)' }]);
  assert.deepEqual(csvRowsFromRequest(csv).cleaned, [{ a: 'Rot;=1+1\r=2', b: ' @SUMME(1)' }], 'Rundlauf');
  const row = csv.split('\r\n')[1];
  assert.ok(row.startsWith('"Rot;=1+1\r=2",') && row.includes("' @SUMME(1)"), JSON.stringify(row));
});

test('all three CSV import paths defuse back', () => {
  // The row readers of the imports run here themselves: the one of the sets and the
  // shared one for parts and figures (csvRowsFromRequest). That both
  // imports use it is shown by test/csv-round-run-db.test.js.
  // Counter-check (29.10.2026): defusingUndo left out in setCsvRows
  // → red („Sets: …“).
  const { setCsvRows } = _reqCsv('src/sets/csvImport.js');
  const { csvRowsFromRequest } = _reqCsv('src/infra/csvExport.js');
  assert.equal(
    setCsvRows("set_number,quantity\n'-10001-1,1\n").rows[0].sn,
    '-10001-1',
    'Sets: ein hier erzeugter Export käme mit Hochkomma zurück',
  );
  assert.equal(
    csvRowsFromRequest("part_number,quantity\n'=X1,1\n").cleaned[0].part_number,
    '=X1',
    'Teile und Figuren: ein hier erzeugter Export käme mit Hochkomma zurück',
  );
});

test('the CSV progress stream survives back pressure on the first write', async t => {
  if (!(await dbReachable())) {
    keineDb(t);
    return;
  }
  const uid = (
    await db.get(`INSERT INTO users (username, password_hash) VALUES ($1,'x') RETURNING id`, [`strom_${process.pid}`])
  ).id;
  t.after(() => db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {}));
  // A full buffer already on the first write: send() then calls cleanup() immediately.
  const express = require('express');
  const app = express();
  let geschrieben = 0;
  app.use((req, res, next) => {
    /** @type {any} */ (req).session = { userId: uid };
    const schreibe = res.write.bind(res);
    res.write = (...a) => {
      schreibe(...a);
      return ++geschrieben > 1;
    };
    next();
  });
  app.use(_req('src/http/apiV1Alias.js').apiV1Alias);
  app.use('/api/v2', require('./helpers/sources').routerFrom(_req, 'routes/api/index.js'));
  const error = [];
  app.use((e, _req2, res, _next) => {
    error.push(e);
    res.end();
  });
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  // The stream listens to NOTIFY of other workers; the connection for it would keep the process open.
  t.after(() => testAccess().notification.close());
  // The stream listens via the signal path of the access; counting happens on it.
  const signals = testAccess().notification;
  const zahl = { an: 0, ab: 0 };
  const { listen, unlisten } = signals;
  signals.listen = (kanal, h) => {
    if (kanal === 'csv_import_progress') zahl.an++;
    return listen.call(signals, kanal, h);
  };
  signals.unlisten = (kanal, h) => {
    if (kanal === 'csv_import_progress') zahl.ab++;
    return unlisten.call(signals, kanal, h);
  };
  t.after(() => {
    signals.listen = listen;
    signals.unlisten = unlisten;
  });
  const r = await fetch(`http://localhost:${portOf(srv)}/api/v2/sets/import/csv/stream`, {
    signal: AbortSignal.timeout(10_000),
  });
  const text = await r.text();
  assert.equal(r.status, 200);
  assert.match(text, /^data: \{/, 'Der erste Stand kommt nicht an');
  assert.deepEqual(
    error.map(e => e.message),
    [],
    'cleanup() greift auf noch nicht angelegte Hörer zu',
  );
  // Cleaned up: no listener stays hanging on the signal path.
  for (let i = 0; i < 40 && zahl.ab < zahl.an; i++) await new Promise(r => setTimeout(r, 50));
  assert.ok(zahl.an > 0, 'der Strom horchte gar nicht — greift die Zählung noch?');
  assert.equal(zahl.ab, zahl.an, 'kein Hörer bleibt am Signalweg hängen');
});
