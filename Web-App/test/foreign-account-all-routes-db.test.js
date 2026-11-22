/**
 * Every route of the contract, called by a foreign account with identifiers and account IDs
 * of the victim (once with the victim's account ID in fields, once with the
 * own one): no response contains the victim's data, none of its rows
 * changes. Omitted: routes before login and deleting the own account.
 *
 * Counter-checks (measured 09.11.2026, each alone):
 *   A  in deleteVoucher() (src/vouchers/repository) `user_id = $2`
 *      replaced by `$2::int > 0` → red: “no row of the victim changes”
 *   B  in scopeIds() (src/household) a requested account ID taken over without checking
 *      membership → red: “no response contains the victim's
 *      data” and “no row of the victim changes”
 *   Green, by contrast, stayed removing the ownership check only when renaming
 *   or deleting a storage location: there the service already checks ownership
 *   once before (ortName), the second place is backup.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.APP_BASE_URL = 'http://localhost';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const ROOT = path.join(__dirname, '..');
const S = require('./helpers/sources');
const { catalogSet } = require('./helpers/inventory');
const _req = S.buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { mailAttrappe } = require('./helpers/mail-fake');
const { example } = require('./helpers/contract-example');
mailAttrappe();
const db = S.testData();
const auth = _req('src/account/deviceToken.js');
const { CONTRACT } = _req('src/contract/index.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const PDFDocument = require('pdfkit');

const MARKE = `GEHEIM${process.pid}`;
const VICTIM = `opfer_${MARKE}`,
  FREMD = `fremd_${process.pid}`,
  PASS = 'Fremd-Passwort-1!';
const SET = '99181-1',
  SET2 = '99182-1',
  SET3 = '99183-1',
  TEIL = '3001fk',
  FARBE = 5,
  FIGUR = 'fk0001';
const GUTSCHEIN = '5045076374450019876';
const BEFORE_THE_LOGIN =
  /^(POST|GET) \/api\/v1\/auth\/(login|register|forgot-password|reset-password|verify[\w/-]*|resend-verification|qr-login[\w/-]*|passkey\/anmelden[\w/-]*|name-frei|email-frei)$/;

function pdfWith(rows) {
  return new Promise(fertig => {
    const doc = new PDFDocument({ compress: false });
    const stuecke = [];
    doc.on('data', s => stuecke.push(s));
    doc.on('end', () => fertig(Buffer.concat(stuecke)));
    for (const z of rows) doc.text(z);
    doc.end();
  });
}

test('a foreign account sees and changes no data of another via any route', {
  concurrency: 1,
  timeout: 600_000,
}, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  await db.run('DELETE FROM users WHERE username = ANY($1)', [[VICTIM, FREMD]]);
  const hash = await bcrypt.hash(PASS, 4);
  const anlegen = async n =>
    (
      await db.get(
        `INSERT INTO users (username, email, password_hash, is_admin, is_active, email_verified)
     VALUES ($1, $2, $3, false, true, true) RETURNING id`,
        [n, `${n}@example.org`, hash],
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
    for (const tab of ['set_catalog', 'set_parts_catalog', 'set_minifigs_catalog'])
      await db.run(`DELETE FROM ${tab} WHERE set_number = ANY($1)`, [[SET, SET2, SET3]]).catch(() => {});
    await db.run('DELETE FROM part_color_catalog WHERE part_number = $1', [TEIL]).catch(() => {});
    await db.run('DELETE FROM part_catalog WHERE part_number = $1', [TEIL]).catch(() => {});
    await db.run('DELETE FROM minifigs_catalog WHERE fig_number = $1', [FIGUR]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  for (const s of [SET, SET2, SET3])
    await catalogSet(db, s, { name: 'Fremdprobe', year: 2024, theme: 'Test', pieces: 10, minifigs: 1 });
  await db.run(
    `INSERT INTO part_catalog (part_number, part_name, category_name) VALUES ($1, 'Stein 2x2', 'Steine')
                ON CONFLICT DO NOTHING`,
    [TEIL],
  );
  await db.run(
    `INSERT INTO part_color_catalog (part_number, color_id, color_name, color_hex) VALUES ($1, $2, 'Rot', 'C91A09')
                ON CONFLICT DO NOTHING`,
    [TEIL, FARBE],
  );
  await db.run(`INSERT INTO minifigs_catalog (fig_number, fig_name) VALUES ($1, 'Probefigur') ON CONFLICT DO NOTHING`, [
    FIGUR,
  ]);

  // ── Server as in server.ts; the session switches between the accounts ──
  let als = opfer;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const name = als === opfer ? VICTIM : FREMD;
    req.session = {
      userId: als,
      username: name,
      isAdmin: false,
      regenerate(cb) {
        cb();
      },
      save(cb) {
        cb?.();
      },
      destroy(cb) {
        cb?.();
      },
    };
    req.apiUser = { user_id: als, username: name, is_admin: 0 };
    next();
  });
  app.use('/api/v1', require('./helpers/sources').routerFrom(_req, 'routes/api_v1/index.js'));
  for (const r of S.routerEinhaengungen())
    app.use(r.mount, require('./helpers/sources').routerFrom(_req, `routes/${r.name}.js`));
  const srv = app.listen(0);
  t.after(async () => {
    srv.closeAllConnections?.();
    await new Promise(r => srv.close(r));
    // LISTEN connection and timers that routes trigger on the side would otherwise keep the process open.
    await S.testAccess()
      .notification.close()
      .catch(() => {});
  });
  const basis = `http://127.0.0.1:${srv.address().port}`;

  const ruf = async (methode, weg, body, form) => {
    const init = { method: methode, signal: AbortSignal.timeout(4000) };
    if (form) init.body = form;
    else if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers = { 'content-type': 'application/json' };
    }
    try {
      const r = await fetch(basis + weg, init);
      return { status: r.status, text: Buffer.from(await r.arrayBuffer()).toString('latin1') };
    } catch (e) {
      return { status: 0, text: String(e?.name) };
    }
  };
  const ok = async (methode, weg, body, form) => {
    const r = await ruf(methode, weg, body, form);
    assert.equal(r.status, 200, `${methode} ${weg}: ${r.text.slice(0, 300)}`);
    return JSON.parse(r.text);
  };

  // ── The victim creates via the API what it owns ─────────────────────────
  const ort = (await ok('POST', '/api/v1/storage/locations', { name: `Ort ${MARKE}` })).ort.id;
  await ok('POST', '/api/v1/sets', { set_number: SET, quantity: 1, purchase_price: 12.34, condition: 'N' });
  await ok('PUT', `/api/v1/sets/${SET}/storage`, { storage: `Ort ${MARKE}` });
  await ok('PUT', `/api/v1/sets/${SET}/alert`, { direction: 'unter', threshold: 30, condition: 'N' });
  const setAcq = (await db.get('SELECT id FROM set_acquisitions WHERE user_id = $1 AND set_number = $2', [opfer, SET]))
    .id;
  const pdf = await pdfWith(['Bauanleitung']);
  const f = new FormData();
  f.append('file', new Blob([pdf], { type: 'application/pdf' }), 'anleitung.pdf');
  f.append('description', `Anleitung ${MARKE}`);
  await ok('POST', `/api/v1/sets/${SET}/instructions/upload`, undefined, f);
  const anleitung = (await db.get('SELECT id FROM instructions WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [opfer]))
    .id;
  await ok('POST', '/api/v1/parts', {
    part_number: TEIL,
    color_id: FARBE,
    color_name: 'Rot',
    quantity: 3,
    unit_price: 0.2,
    condition: 'N',
  });
  await ok('PUT', `/api/v1/parts/${TEIL}/${FARBE}/storage`, { storage: `Kiste ${MARKE}` });
  const teilAcq = (await db.get('SELECT id FROM part_acquisitions WHERE user_id = $1', [opfer])).id;
  await ok('POST', '/api/v1/minifigs', { fig_number: FIGUR, quantity: 1, unit_price: 4, condition: 'N' });
  const figAcq = (await db.get('SELECT id FROM minifig_acquisitions WHERE user_id = $1', [opfer])).id;
  await ok('POST', '/api/v1/wanted', { set_number: SET2, condition: 'N' });
  const gutschein = (
    await ok('POST', '/api/v1/vouchers', { number: GUTSCHEIN, pin: '4711', amount: 50, currency: 'CHF' })
  ).voucher.id;
  await ok('POST', '/api/v1/sets', { set_number: SET3, quantity: 1, condition: 'N' });
  await ok('DELETE', `/api/v1/sets/${SET3}`);
  const trash = (await db.get('SELECT id FROM trash WHERE user_id = $1', [opfer])).id;
  const token = await auth.createToken(opfer, `Gerät ${MARKE}`, true);
  const nonce = `fremd${process.pid}${Date.now()}`;
  const qr = (
    await db.get(
      `INSERT INTO qr_login_tokens (token, user_id, expires_at, pickup_code, code_hash)
    VALUES ($1, $2, NOW() + INTERVAL '5 minutes', 'abh', 'x') RETURNING id`,
      [auth.tokenDigest(nonce), opfer],
    )
  ).id;

  /** What the victim owns, row by row; afterwards none of it may have changed. */
  const spalten = await db.all(`SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND column_name IN ('user_id', 'owner_user_id', 'main_user_id', 'sub_user_id')`);
  const bestand = async () => {
    const aus = { users: await db.all('SELECT * FROM users WHERE id = $1', [opfer]) };
    for (const { table_name: tab, column_name: sp } of spalten) {
      const rows = await db.all(`SELECT * FROM "${tab}" WHERE "${sp}" = $1`, [opfer]);
      aus[`${tab}.${sp}`] = rows.map(z => JSON.stringify(z)).sort();
    }
    return aus;
  };
  const vorher = await bestand();
  const rowsOfVictim = Object.values(vorher).reduce((n, z) => n + z.length, 0);
  assert.ok(rowsOfVictim >= 15, `nur ${rowsOfVictim} Zeilen des Opfers angelegt`);

  // ── Values of the victim for path, query and body ───────────────────────
  const idFor = p =>
    p.includes('/storage/locations/')
      ? ort
      : p.includes('/papierkorb/')
        ? trash
        : p.includes('/vouchers/')
          ? gutschein
          : p.includes('/qr-kopplung/')
            ? qr
            : p.includes('/parts/')
              ? teilAcq
              : p.includes('/minifigs/')
                ? figAcq
                : opfer;
  const acqFor = p => (p.startsWith('/api/v1/parts') ? teilAcq : p.startsWith('/api/v1/minifigs') ? figAcq : setAcq);
  const pathValue = (p, n) =>
    ({
      setNumber: p.includes('/wanted/') ? SET2 : SET,
      sn: SET,
      partNumber: TEIL,
      colorId: FARBE,
      figNumber: FIGUR,
      id: idFor(p),
      acqId: acqFor(p),
      instrId: anleitung,
      tokenId: auth.tokenDigest(token).slice(0, 16),
      jobId: '1700000000000-abcd',
      condition: 'N',
      type: 'anleitung',
      barcode: '5702016616354',
    })[n];
  /** `konto`: the victim (foreign account ID in the field) or the own one — then the request gets past the
   * account check and hits the row's ownership check with the victim's identifiers. */
  const fieldValue = (k, konto) =>
    ({
      accounts: String(konto),
      owner: String(konto),
      owner_user_id: konto,
      from_user_id: konto,
      sub_user_id: konto,
      main_user_id: konto,
      to_user_id: konto,
      neuer_inhaber: fremd,
      id: ort,
      acquisition_ids: [setAcq],
      set_number: SET,
      sets: [SET],
      set_numbers: [SET],
      part_number: TEIL,
      color_id: FARBE,
      fig_number: FIGUR,
      teile: [{ part_number: TEIL, color_id: FARBE }],
      parts: [{ part_number: TEIL, color_id: FARBE }],
      condition: 'N',
      storage: 'Lager des Fremden',
      name: 'Name des Fremden',
      search: 'GEHEIM',
      q: 'GEHEIM',
      // The own password: the attacker can confirm in the own account, what is asked is the ownership behind it.
      password: PASS,
      admin_password: PASS,
      current: PASS,
      password_current: PASS,
      number: '5045076374450010001',
      pin: '0001',
      passkey: undefined,
      date: '2024-01-01',
      acquired_at: '2024-01-01',
    })[k];
  const queryValue = (k, konto) => {
    const v = fieldValue(k, konto);
    return v === undefined ? undefined : Array.isArray(v) ? v.join(',') : String(v);
  };

  // ── The foreign account calls every route with these values ─────────────
  als = fremd;
  const leaks = [],
    gerufen = [];
  for (const [schluessel, route] of Object.entries(CONTRACT)) {
    if (BEFORE_THE_LOGIN.test(schluessel) || schluessel === 'DELETE /api/v1/auth/konto') continue;
    const [methode, muster] = schluessel.split(' ');
    const weg = muster.replace(/:(\w+)/g, (_, n) => encodeURIComponent(String(pathValue(muster, n) ?? 'x')));
    const felder = route.abfrage?.shape ? Object.keys(route.abfrage.shape) : [];
    for (const konto of [opfer, fremd]) {
      const w = k => fieldValue(k, konto);
      const abfrage = new URLSearchParams(
        felder.map(k => [k, queryValue(k, konto)]).filter(([, v]) => v !== undefined),
      ).toString();
      const rumpfe =
        methode === 'GET' || route.formular
          ? [undefined]
          : [example(route.eingabe, w, false), example(route.eingabe, w, true)];
      for (const rumpf of rumpfe)
        for (const q of abfrage ? [abfrage, ''] : ['']) {
          const r = await ruf(methode, weg + (q ? '?' + q : ''), rumpf);
          gerufen.push(`${schluessel} ${r.status}`);
          for (const geheim of [MARKE, GUTSCHEIN])
            if (r.text.includes(geheim))
              leaks.push(`${schluessel}${q ? '?' + q : ''} → ${r.status}: enthält ${geheim}`);
        }
    }
  }
  als = opfer;

  await t.test('every route was called', () => {
    const routen = new Set(gerufen.map(g => g.split(' ').slice(0, 2).join(' ')));
    assert.ok(routen.size >= 180, `nur ${routen.size} Routen gerufen`);
    // Without a reached check the whole thing proves nothing: a good share must get through the input check.
    const durch = gerufen.filter(g => !/ (400|0)$/.test(g)).length;
    assert.ok(
      durch >= gerufen.length / 2,
      `nur ${durch} von ${gerufen.length} Aufrufen kamen an der Eingabeprüfung vorbei`,
    );
  });

  await t.test("no response contains the victim's data", () => assert.deepEqual(leaks, []));

  await t.test('no row of the victim changes', async () => {
    const nachher = await bestand();
    const geaendert = Object.keys(vorher).filter(k => JSON.stringify(vorher[k]) !== JSON.stringify(nachher[k]));
    assert.deepEqual(
      geaendert.map(k => [k, vorher[k].length, nachher[k].length]),
      [],
    );
  });
});
