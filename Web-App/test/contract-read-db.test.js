/**
 * Every GET route of the app against its contract (src/contract/): real
 * responses on a stock in which no list is empty — a set with
 * parts and minifigure, a manual part, a manual minifigure, wishlist,
 * storage location, voucher, price alert, prices in the cache. Which routes the app calls
 * is in shared/app-interface.json; that its models match the contract
 * is checked by the Android run (tools/contract/contract-kotlin.test.js).
 *
 * Counter-checks (measured 31.10.2026):
 *   A  in src/sets/repository/sets.ts the ::int on used_count removed → red:
 *      “every route answers” (/api/v2/sets: 500 contract_violated, text instead of
 *      number) and “that many routes checked”
 *   B  MIN_CHECKED set to 59 → red: “that many routes checked”
 *   C  in src/sets/content.ts `...einePage(…)` removed from the parts list →
 *      red: “every route answers” (parts-list: 500 contract_violated)
 *   D  in src/infra/page.ts slice() replaced by the whole list → red:
 *      “long lists page” (05.11.2026)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { routerMounts, testData } = require('./helpers/sources');
const { holdsSet, holdsPart, holdsMinifig, catalogSet } = require('./helpers/inventory');
const { contractTo, appRoutes } = require('./helpers/contract');
const db = testData();
const express = require(path.join(ROOT, 'node_modules', 'express'));

const NAME = `kvertrag_${process.pid}`;
const SET = '99074-1',
  TEIL = '3001kv',
  FARBE = 5,
  FIGURE = 'kv0001';

/** Routes that cannot run here — with reason. */
const OMITTED = new Map([
  ['/api/v2/sets/info/{setNumber}', 'fragt Rebrickable/Brickset im Netz'],
  ['/api/v2/sets/barcode/{barcode}', 'fragt die Barcode-Dienste im Netz'],
  ['/api/v2/wanted/{setNumber}/prices', 'fragt BrickLink im Netz'],
  ['/api/v2/startup-status', 'steht direkt in server.ts, nicht in einem Router'],
  ['/api/v2/sets/partslist-pdf/status/{jobId}', 'braucht einen laufenden PDF-Auftrag'],
  ['/api/v2/admin/logs', 'liest app_logs; der Inhalt hängt an fremden Läufen'],
]);
/** Lists that may stay empty here — with reason. */
const EMPTY_ALLOWED = new Map([
  ['/api/v2/admin/brickset-queue .entries', 'füllt nur ein gescheiterter Brickset-Abruf'],
]);
/** Additional query parameters without which a route only delivers empty results. */
const EXTRA = new Map([['/api/v2/alerts/pending', 'since=2000-01-01T00:00:00Z']]);
/** At least this many routes are really checked — so that the number does not silently sink. */
const MIN_CHECKED = 58;

test('the responses of the app routes keep their contract', { concurrency: 1, timeout: 120_000 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, email, password_hash, is_admin, is_active, email_verified)
                             VALUES ($1, $2, 'x', true, true, true) RETURNING id`,
      [NAME, `${NAME}@example.org`],
    )
  ).id;
  await db.run('DELETE FROM users WHERE username = $1', [`${NAME}_sub`]);
  const sub = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified)
                             VALUES ($1, 'x', true, true) RETURNING id`,
      [`${NAME}_sub`],
    )
  ).id;
  // A parent account and a separated account so that `parents` and
  // `former_links` of the household response do not arrive empty.
  const subAccount = async zusatz => {
    await db.run('DELETE FROM users WHERE username = $1', [`${NAME}_${zusatz}`]);
    return (
      await db.get(
        `INSERT INTO users (username, password_hash, is_active, email_verified)
                          VALUES ($1, 'x', true, true) RETURNING id`,
        [`${NAME}_${zusatz}`],
      )
    ).id;
  };
  const oben = await subAccount('oben'),
    getrennt = await subAccount('getrennt');
  // Global catalogs: only remove what this test created itself.
  const aufraeumen = [];
  const katalog = async (sql, values, weg, routeValues) => {
    if ((await db.run(sql + ' ON CONFLICT DO NOTHING', values)).changes) aufraeumen.push([weg, routeValues]);
  };
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[uid, sub, oben, getrennt]]).catch(() => {});
    for (const tab of ['set_parts', 'set_minifigs', 'price_cache', 'price_history', 'set_catalog'])
      await db.run(`DELETE FROM ${tab} WHERE set_number = $1`, [SET]).catch(() => {});
    for (const tab of ['part_price_cache', 'part_price_history', 'part_catalog', 'part_color_catalog'])
      await db.run(`DELETE FROM ${tab} WHERE part_number = $1`, [TEIL]).catch(() => {});
    for (const tab of ['minifig_price_cache', 'minifig_price_history', 'minifigs_catalog'])
      await db.run(`DELETE FROM ${tab} WHERE fig_number = $1`, [FIGURE]).catch(() => {});
    for (const [sql, values] of aufraeumen) await db.run(sql, values).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  // ── Stock ──────────────────────────────────────────────────────────────
  await db
    .run(
      `INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'currency', 'EUR')
                ON CONFLICT (user_id, key) DO UPDATE SET value = 'EUR'`,
      [uid],
    )
    .catch(() => {});
  await catalogSet(db, SET, { name: 'Vertragsprobe', year: 2024, theme: 'Test', pieces: 100, minifigs: 1 });
  await db.run(
    `INSERT INTO set_parts (set_number, part_number, color_id, quantity)
                VALUES ($1, $2, $3, 4) ON CONFLICT DO NOTHING`,
    [SET, TEIL, FARBE],
  );
  await db.run(`INSERT INTO part_catalog (part_number, part_name) VALUES ($1, 'Stein 2x2') ON CONFLICT DO NOTHING`, [
    TEIL,
  ]);
  await db.run(
    `INSERT INTO part_color_catalog (part_number, color_id, color_name)
                VALUES ($1, $2, 'Rot') ON CONFLICT DO NOTHING`,
    [TEIL, FARBE],
  );
  await db.run(
    `INSERT INTO set_minifigs (set_number, fig_number, quantity)
                VALUES ($1, $2, 1) ON CONFLICT DO NOTHING`,
    [SET, FIGURE],
  );
  await db.run(`INSERT INTO minifigs_catalog (fig_number, fig_name) VALUES ($1, 'Probefigur') ON CONFLICT DO NOTHING`, [
    FIGURE,
  ]);
  for (const condition of ['N', 'U']) {
    await db.run(
      `INSERT INTO price_cache (set_number, condition, currency_code, min_price, avg_price, max_price, qty_avg_price, total_quantity)
                  VALUES ($1, $2, 'EUR', 40, 50, 60, 52, 7)`,
      [SET, condition],
    );
    await db.run(
      `INSERT INTO price_history (set_number, condition, currency_code, avg_price, recorded_at)
                  VALUES ($1, $2, 'EUR', 48, NOW() - INTERVAL '2 days')`,
      [SET, condition],
    );
  }
  await katalog(
    `INSERT INTO rb_themes (id, name) VALUES (999074, 'Vertragsthema')`,
    [],
    'DELETE FROM rb_themes WHERE id = 999074',
    [],
  );
  await katalog(
    `INSERT INTO rb_sets (set_num, name, year, theme_id, num_parts) VALUES ($1, 'Vertragsprobe', 2024, 999074, 100)`,
    [SET],
    'DELETE FROM rb_sets WHERE set_num = $1',
    [SET],
  );
  await katalog(
    `INSERT INTO rb_colors (id, name, rgb, is_trans) VALUES ($1, 'Rot', 'C91A09', 'f')`,
    [FARBE],
    'DELETE FROM rb_colors WHERE id = $1',
    [FARBE],
  );
  await katalog(
    `INSERT INTO rb_inventories (id, set_num, version) VALUES (999074, $1, 1)`,
    [SET],
    'DELETE FROM rb_inventories WHERE id = 999074',
    [],
  );
  await katalog(
    `INSERT INTO rb_inventory_parts (id, inventory_id, part_num, color_id, quantity, is_spare)
                 VALUES (999074, 999074, $1, $2, 4, false)`,
    [TEIL, FARBE],
    'DELETE FROM rb_inventory_parts WHERE id = 999074',
    [],
  );
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
  for (const condition of ['N', 'U']) {
    await db.run(
      `INSERT INTO part_price_cache (part_number, color_id, condition, currency_code, avg_price, qty_avg_price)
                  VALUES ($1, $2, $3, 'EUR', 0.2, 0.18)`,
      [TEIL, FARBE, condition],
    );
    await db.run(
      `INSERT INTO part_price_history (part_number, color_id, condition, currency_code, avg_price, recorded_at)
                  VALUES ($1, $2, $3, 'EUR', 0.19, NOW() - INTERVAL '2 days')`,
      [TEIL, FARBE, condition],
    );
    await db.run(
      `INSERT INTO minifig_price_cache (fig_number, condition, currency_code, avg_price, qty_avg_price)
                  VALUES ($1, $2, 'EUR', 4.5, 4.2)`,
      [FIGURE, condition],
    );
    await db.run(
      `INSERT INTO minifig_price_history (fig_number, condition, currency_code, avg_price, recorded_at)
                  VALUES ($1, $2, 'EUR', 4.4, NOW() - INTERVAL '2 days')`,
      [FIGURE, condition],
    );
  }
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [uid, sub]);
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [oben, uid]);
  await db.run('INSERT INTO household_former_links (main_user_id, sub_user_id, via_user_id) VALUES ($1, $2, $3)', [
    uid,
    getrennt,
    sub,
  ]);
  await _req('src/account/deviceToken.js').createToken(uid, 'Vertragsprobe');
  // Background jobs: a job with progress and a pause so that
  // /admin/jobs delivers no empty lists.
  const auftrag = await {
    ..._req('src/jobQueue/service.js'),
    ...require('./helpers/sources').testArea('jobQueue').jobs,
  }.placeJobOne('instructions', { set_number: SET }, { schluessel: `vertrag-get:${process.pid}` });
  await db.run(`UPDATE jobs SET progress = '{"done":1,"total":3,"text":"Seiten"}'::jsonb WHERE id = $1`, [auftrag]);
  await db.run(`INSERT INTO job_pauses (type, until_at, reason) VALUES ('exchange_rates', NOW() + INTERVAL '1 hour', 'Vertrag')
                ON CONFLICT (type) DO UPDATE SET until_at = EXCLUDED.until_at, reason = EXCLUDED.reason`);
  aufraeumen.push(
    [`DELETE FROM jobs WHERE id = $1`, [auftrag]],
    [`DELETE FROM job_pauses WHERE reason = 'Vertrag'`, []],
  );
  await holdsSet(db, uid, SET, 2, { preis: 49.9 });
  await holdsPart(db, uid, TEIL, { setNumber: SET, colorId: FARBE, quantity: 4 });
  await holdsPart(db, uid, TEIL, { colorId: FARBE, quantity: 3 });
  await holdsMinifig(db, uid, FIGURE, { setNumber: SET, quantity: 1 });
  await holdsMinifig(db, uid, FIGURE, { quantity: 1 });
  await db.run(`INSERT INTO wanted (user_id, set_number) VALUES ($1, $2)`, [uid, SET]);
  const location = (
    await db.get(`INSERT INTO storage_locations (user_id, name) VALUES ($1, 'Regal A') RETURNING id`, [uid])
  ).id;
  await db.run('UPDATE sets SET storage_id = $2 WHERE user_id = $1 AND set_number = $3', [uid, location, SET]);
  await require('./helpers/sources')
    .testArea('vouchers')
    .vouchers.createVoucher(uid, { number: '50451230', pin: null, amount: 25, currency: 'CHF' });
  await db.run(
    `INSERT INTO price_alerts (user_id, set_number, condition, direction, threshold, currency_code, triggered, last_triggered_at, last_price)
                VALUES ($1, $2, 'N', 'below', 55, 'EUR', true, NOW(), 50)`,
    [uid, SET],
  );

  // ── Server as in server.ts ─────────────────────────────────────────────
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { userId: uid, username: NAME, isAdmin: true };
    req.apiUser = { user_id: uid, username: NAME, is_admin: 1 };
    next();
  });
  app.use(_req('src/http/apiV1Alias.js').apiV1Alias);
  app.use('/api/v2', require('./helpers/sources').routerFrom(_req, 'routes/api/index.js'));
  for (const r of routerMounts())
    app.use(r.mount, require('./helpers/sources').routerFrom(_req, `routes/${r.name}.js`));
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  const basis = `http://127.0.0.1:${srv.address().port}`;

  const routen = appRoutes(_req).filter(r => r.method === 'GET');
  const values = { setNumber: SET, partNumber: TEIL, colorId: String(FARBE), figNumber: FIGURE };

  const deviations = [],
    leer = [],
    status = [];
  let geprueft = 0;
  for (const r of routen) {
    const vertrag = contractTo(_req, 'GET', r.path);
    if (!vertrag?.response || OMITTED.has(r.path)) continue;
    const path = r.path.replace(/\{(\w+)\}/g, (_, n) => encodeURIComponent(values[n] ?? `<${n}>`));
    if (path.includes('%3C')) {
      status.push(`${r.path}: kein Wert für einen Platzhalter`);
      continue;
    }
    const anfrage = [...r.query.filter(q => q.required).map(q => `${q.name}=60`), EXTRA.get(r.path)]
      .filter(Boolean)
      .join('&');
    const response = await fetch(basis + path + (anfrage ? '?' + anfrage : ''));
    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      status.push(`${r.path}: ${response.status} kein JSON`);
      continue;
    }
    if (response.status !== 200) {
      status.push(`${r.path}: ${response.status} ${text.slice(0, 120)}`);
      continue;
    }
    geprueft++;
    const checked_ = vertrag.response.safeParse(json);
    if (!checked_.success)
      deviations.push(...checked_.error.issues.map(i => `${r.path} $.${i.path.join('.')}: ${i.message}`));
    for (const [k, v] of Object.entries(json)) if (Array.isArray(v) && v.length === 0) leer.push(`${r.path} .${k}`);
  }

  await t.test('every route answers', () => assert.deepEqual(status, []));
  await t.test('this many routes checked', () =>
    assert.ok(geprueft >= MIN_CHECKED, `nur ${geprueft} Routen geprüft, erwartet mindestens ${MIN_CHECKED}`),
  );
  await t.test('matches the contract', () => assert.deepEqual(deviations, []));
  await t.test('no list is unnoticeably empty', () =>
    assert.deepEqual(
      leer.filter(l => !EMPTY_ALLOWED.has(l)),
      [],
      'Eine leere Liste prüft kein einziges Feld',
    ),
  );
  t.diagnostic(`geprüft: ${geprueft}`);

  // Every route with page_size: page 2 of size 1 is empty, total still counts
  // the whole list, and without page_size everything comes.
  const { openapi } = _req('src/contract/openapi.js');
  const paged = Object.entries(openapi(2).paths)
    .filter(([p, ops]) => !p.includes('{') && ops.get?.parameters?.some(x => x.name === 'page_size'))
    .map(([p]) => p);
  const pagesError = [];
  for (const p of paged) {
    const fetchIt = async q => (await fetch(`${basis}${p}${q}`)).json();
    const ganz = await fetchIt(''),
      zweite = await fetchIt('?page_size=1&page=2');
    const field = Object.keys(ganz).find(k => Array.isArray(ganz[k]) && ganz[k].length > 0);
    if (!field) {
      if (![...EMPTY_ALLOWED.keys()].some(k => k.startsWith(p + ' '))) pagesError.push(`${p}: keine gefüllte Liste`);
      continue;
    }
    // The catalog has tens of thousands of sets: it always pages, without page_size by 60.
    if (p !== '/api/v2/catalog/sets' && ganz.total !== ganz[field].length)
      pagesError.push(`${p}: ohne page_size nicht alles (${ganz[field].length}/${ganz.total})`);
    if (zweite[field]?.length !== Math.max(0, Math.min(1, ganz.total - 1)))
      pagesError.push(`${p}: Seite 2 hat ${zweite[field]?.length} Einträge`);
    if (zweite.total !== ganz.total) pagesError.push(`${p}: total ${zweite.total} statt ${ganz.total}`);
  }
  await t.test('long lists page', () => {
    assert.ok(paged.length >= 10, `nur ${paged.length} geblätterte Routen gefunden`);
    assert.deepEqual(pagesError, []);
  });
});
