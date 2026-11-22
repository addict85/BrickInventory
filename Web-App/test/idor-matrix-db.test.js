/**
 * Every route with a row identifier in the path (`:id`, `:acqId`, `:instrId`, `:tokenId`,
 * `:jobId`, the files under /data), taken from the routers of the real app, called by another
 * household with the victim's identifiers: 403 or 404 (or the `deleted: 0` a missing row gets),
 * never its data, none of its rows changed. foreign-account-all-routes-db checks the contract
 * routes for leaks; this adds the status and the routes outside the contract.
 *
 * Counter-checks (measured 22.11.2026, each on its own):
 *   A  in deleteVoucher() (src/vouchers/repository/vouchers.ts) `user_id = $2` replaced by
 *      `$2::int > 0` and row security on `vouchers` switched off in the test copy → red: “never a
 *      2xx …” (DELETE /vouchers/:id 200) and “none of the victim's rows changes”. With row
 *      security on, the same change stays green: the database is the second wall.
 *   B  in routes/dataFiles.ts the seesAccount() check removed → red: “never a 2xx …”
 *      (GET /data/uploads/<victim>/… 200) and “no response carries the victim's data”
 *   C  the route filter only takes `:id` → red: “all kinds of identifiers are covered”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const WURZEL = fs.mkdtempSync(path.join(os.tmpdir(), 'idor-'));
fs.writeFileSync(path.join(WURZEL, 'package.json'), '{}');
process.env.APP_ROOT = WURZEL;
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.APP_BASE_URL = 'http://localhost';

const S = require('./helpers/sources');
const { catalogSet } = require('./helpers/inventory');
const { example } = require('./helpers/contract-example');
const _req = S.buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { mailFake } = require('./helpers/mail-fake');
mailFake();
const db = S.testData();
const bcrypt = require('bcryptjs');
const auth = _req('src/account/deviceToken.js');
const { CONTRACT } = _req('src/contract/index.js');

const MARKE = `IDOR${process.pid}`;
const VICTIM = `idor_opfer_${process.pid}`,
  FREMD = `idor_fremd_${process.pid}`,
  PASS = 'Idor-Passwort-1!';
const SET = '99281-1',
  SET2 = '99282-1',
  TEIL = '3001ik',
  FARBE = 5,
  FIGURE = 'ik0001';
const VOUCHER = '5045076374450029876';
/** Parameters that name a row (or a file) of an account. */
const ROW_IDS = /^(id|acqId|instrId|tokenId|jobId)$/;

/** Method and full path of every route of the app, with the router's mount prefix. */
function routesOf(app) {
  const aus = [];
  const walk = (r, praefix) => {
    for (const l of r.stack) {
      if (l.route) for (const m of Object.keys(l.route.methods)) aus.push([m.toUpperCase(), praefix + l.route.path]);
      else if (l.handle?.stack) walk(l.handle, l.handle.praefix ?? praefix);
    }
  };
  walk(app.router, '');
  return aus;
}

test('IDOR: identifiers of another household give 403/404 on every route', {
  concurrency: 1,
  timeout: 300_000,
}, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[VICTIM, FREMD]]);
  const hash = await bcrypt.hash(PASS, 4);
  const anlegen = async n =>
    (
      await db.get(
        `INSERT INTO users (username, email, password_hash, is_admin, is_active, email_verified)
         VALUES ($1, $1 || '@example.org', $2, false, true, true) RETURNING id`,
        [n, hash],
      )
    ).id;
  const opfer = await anlegen(VICTIM),
    fremd = await anlegen(FREMD);
  for (const k of [opfer, fremd])
    await db.run(
      `INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'currency', 'EUR')
       ON CONFLICT (user_id, key) DO UPDATE SET value = 'EUR'`,
      [k],
    );
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[opfer, fremd]]).catch(() => {});
    await db.run('DELETE FROM set_catalog WHERE set_number = ANY($1)', [[SET, SET2]]).catch(() => {});
    await db.run('DELETE FROM part_color_catalog WHERE part_number = $1', [TEIL]).catch(() => {});
    await db.run('DELETE FROM part_catalog WHERE part_number = $1', [TEIL]).catch(() => {});
    await db.run('DELETE FROM minifigs_catalog WHERE fig_number = $1', [FIGURE]).catch(() => {});
    await db.pool.end().catch(() => {});
    fs.rmSync(WURZEL, { recursive: true, force: true });
  });
  for (const s of [SET, SET2]) await catalogSet(db, s, { name: 'Idorprobe', year: 2024, theme: 'Test', pieces: 10 });
  await db.run(`INSERT INTO part_catalog (part_number, part_name) VALUES ($1, 'Stein') ON CONFLICT DO NOTHING`, [TEIL]);
  await db.run(
    `INSERT INTO part_color_catalog (part_number, color_id, color_name, color_hex) VALUES ($1, $2, 'Rot', 'C91A09')
     ON CONFLICT DO NOTHING`,
    [TEIL, FARBE],
  );
  await db.run(`INSERT INTO minifigs_catalog (fig_number, fig_name) VALUES ($1, 'Figur') ON CONFLICT DO NOTHING`, [
    FIGURE,
  ]);

  const sitzung = {};
  const als = uid => {
    for (const k of Object.keys(sitzung)) delete sitzung[k];
    Object.assign(sitzung, { userId: uid, username: uid === opfer ? VICTIM : FREMD, isAdmin: false });
  };
  const { app, base } = testServer(_req, { sitzung, t });
  const callFn = async (methode, weg, body) => {
    const r = await fetch(base + weg, {
      method: methode,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    }).catch(e => ({ status: 0, text: async () => String(e?.name) }));
    return { status: r.status, text: await r.text() };
  };
  const ok = async (methode, weg, body) => {
    const r = await callFn(methode, weg, body);
    assert.equal(r.status, 200, `${methode} ${weg}: ${r.text.slice(0, 300)}`);
    return JSON.parse(r.text);
  };

  // ── What the victim owns, created through the API ───────────────────────
  als(opfer);
  const location = (await ok('POST', '/api/v2/storage/locations', { name: `Ort ${MARKE}` })).location.id;
  await ok('POST', '/api/v2/sets', { set_number: SET, quantity: 1, purchase_price: 12.34, condition: 'N' });
  await ok('POST', '/api/v2/parts', {
    part_number: TEIL,
    color_id: FARBE,
    color_name: 'Rot',
    quantity: 3,
    condition: 'N',
  });
  await ok('POST', '/api/v2/minifigs', { fig_number: FIGURE, quantity: 1, unit_price: 4, condition: 'N' });
  const gutschein = (
    await ok('POST', '/api/v2/vouchers', { number: VOUCHER, pin: '4711', amount: 50, currency: 'CHF' })
  ).voucher.id;
  const id1 = sql => db.get(sql, [opfer]).then(z => z.id);
  const setAcq = await id1('SELECT id FROM set_acquisitions WHERE user_id = $1');
  const teilAcq = await id1('SELECT id FROM part_acquisitions WHERE user_id = $1');
  const figAcq = await id1('SELECT id FROM minifig_acquisitions WHERE user_id = $1');
  const anleitung = (
    await db.get(
      `INSERT INTO instructions (user_id, set_number, url, description, local_path)
       VALUES ($1, $2, 'https://example.org/a.pdf', $3, $4) RETURNING id`,
      [opfer, SET, `Anleitung ${MARKE}`, `/data/instructions/${SET}_1.pdf`],
    )
  ).id;
  await ok('POST', '/api/v2/sets', { set_number: SET2, quantity: 1, condition: 'N' });
  await ok('DELETE', `/api/v2/sets/${SET2}`);
  const trash = await id1('SELECT id FROM trash WHERE user_id = $1');
  const token = await auth.createToken(opfer, `Gerät ${MARKE}`, true);
  const nonce = `idor${process.pid}${Date.now()}`;
  const qr = (
    await db.get(
      `INSERT INTO qr_login_tokens (token, user_id, expires_at, pickup_code, code_hash, device)
       VALUES ($1, $2, NOW() + INTERVAL '5 minutes', $3, 'x', $4) RETURNING id`,
      [auth.tokenDigest(nonce), opfer, `abh${process.pid}`, `Gerät ${MARKE}`],
    )
  ).id;
  const datei = path.join(WURZEL, 'data', 'uploads', String(opfer));
  fs.mkdirSync(datei, { recursive: true });
  fs.writeFileSync(path.join(datei, 'rechnung.pdf'), `Rechnung ${MARKE}`);
  fs.mkdirSync(path.join(WURZEL, 'data', 'instructions'), { recursive: true });
  fs.writeFileSync(path.join(WURZEL, 'data', 'instructions', `${SET}_1.pdf`), `Anleitung ${MARKE}`);

  // The victim reaches its own rows with the same identifiers: the matrix hits real rows.
  assert.equal((await callFn('GET', `/api/v2/auth/qr-pairing/${qr}`)).status, 200);
  assert.equal((await callFn('GET', `/data/uploads/${opfer}/rechnung.pdf`)).status, 200);
  assert.equal((await callFn('GET', `/data/instructions/${SET}_1.pdf`)).status, 200);

  const spalten = await db.all(`SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND column_name IN ('user_id', 'owner_user_id', 'main_user_id', 'sub_user_id')`);
  const holding = async () => {
    const aus = { users: (await db.all('SELECT * FROM users WHERE id = $1', [opfer])).map(z => JSON.stringify(z)) };
    for (const { table_name: tab, column_name: sp } of spalten)
      aus[`${tab}.${sp}`] = (await db.all(`SELECT * FROM "${tab}" WHERE "${sp}" = $1`, [opfer]))
        .map(z => JSON.stringify(z))
        .sort();
    return aus;
  };
  const vorher = await holding();

  // ── The routes from the routers, and the victim's values for them ────────
  const ids = {
    id: [location, gutschein, trash, qr, opfer, setAcq],
    acqId: [setAcq, teilAcq, figAcq],
    instrId: [anleitung],
    tokenId: [auth.tokenDigest(token).slice(0, 16)],
    jobId: ['1700000000000-abcd'],
  };
  const fest = {
    setNumber: SET,
    sn: SET,
    partNumber: TEIL,
    colorId: FARBE,
    figNumber: FIGURE,
    condition: 'N',
    kind: 'x',
  };
  const routen = routesOf(app).filter(
    ([, p]) => p.startsWith('/data/') || [...p.matchAll(/:(\w+)/g)].some(m => ROW_IDS.test(m[1])),
  );
  const geprueft = new Set();
  const deviating = [],
    leaks = [],
    erreicht = new Set();
  /** What a request with this route but an identifier nobody has gets: foreign must look the same. */
  const keiner = muster =>
    muster.replace(/:(\w+)/g, (_, n) =>
      ROW_IDS.test(n)
        ? n === 'tokenId'
          ? 'f'.repeat(16)
          : n === 'jobId'
            ? '1700000000000-zzzz'
            : '2000000000'
        : encodeURIComponent(String(fest[n] ?? 'x')),
    );
  const wert = k => ({ password: PASS, admin_password: PASS, name: 'Name des Fremden' })[k];
  als(fremd);
  for (const [methode, muster] of routen) {
    const vertrag = CONTRACT[`${methode} ${muster}`];
    const param = [...muster.matchAll(/:(\w+)/g)].map(m => m[1]).find(n => ROW_IDS.test(n));
    const pathList = muster.startsWith('/data/')
      ? [muster.includes('instructions') ? `/data/instructions/${SET}_1.pdf` : `/data/uploads/${opfer}/rechnung.pdf`]
      : (ids[param] ?? []).map(v =>
          muster.replace(/:(\w+)/g, (_, n) => encodeURIComponent(String(n === param ? v : (fest[n] ?? 'x')))),
        );
    if (param) geprueft.add(param);
    // Without, then with the optional fields: one of the two should get past the input check.
    const bodies =
      methode === 'GET' || vertrag?.formular
        ? [undefined]
        : [example(vertrag?.input, wert), example(vertrag?.input, wert, true)];
    for (const rumpf of bodies) {
      const leer = muster.startsWith('/data/') ? null : await callFn(methode, keiner(muster), rumpf);
      for (const weg of pathList) {
        const r = await callFn(methode, weg, rumpf);
        if (r.status !== 400) erreicht.add(`${methode} ${muster}`);
        for (const geheim of [MARKE, VOUCHER]) if (r.text.includes(geheim)) leaks.push(`${methode} ${weg}`);
        if (r.status === 403 || r.status === 404) continue;
        // A DELETE that answers `deleted: 0` for a missing row may say the same for a foreign one.
        if (r.status === 200 && leer?.status === 200 && r.text === leer.text) continue;
        if (r.status !== 400) deviating.push(`${methode} ${weg} → ${r.status} ${r.text.slice(0, 120)}`);
      }
    }
  }
  als(opfer);

  await t.test('the input check lets the requests through to the ownership', () => {
    // A 400 says nothing about ownership; per route at least one body must get past it.
    const neverReached = routen.map(([m, p]) => `${m} ${p}`).filter(r => !erreicht.has(r));
    assert.deepEqual(neverReached, []);
  });
  await t.test('all kinds of identifiers are covered', () => {
    assert.deepEqual([...geprueft].sort(), ['acqId', 'id', 'instrId', 'jobId', 'tokenId']);
    assert.ok(routen.length >= 30, `nur ${routen.length} Routen mit Kennung`);
    assert.ok(
      routen.some(([, p]) => p === '/data/uploads/*pfad'),
      'die Dateien ausserhalb des Vertrags fehlen',
    );
  });
  await t.test('never a 2xx, always 403 or 404', () => assert.deepEqual(deviating, []));
  await t.test("no response carries the victim's data", () => assert.deepEqual(leaks, []));
  await t.test("none of the victim's rows changes", async () => {
    const nachher = await holding();
    assert.deepEqual(
      Object.keys(vorher).filter(k => JSON.stringify(vorher[k]) !== JSON.stringify(nachher[k])),
      [],
    );
  });
});
