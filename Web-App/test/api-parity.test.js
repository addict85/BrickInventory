/**
 * ONE address, BOTH credentials: session (web UI) and bearer token
 * (Android app) must deliver the same for the same route. Duplicate routes
 * no longer exist; what is checked is that no route depends on only one kind
 * of credential.
 *
 * Counter-check: in routes/api/finance.ts total_value taken from totals.avg instead of totals.qty_avg → red “v1 valuation: total_value is an alias of totals.qty_avg”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DB_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.DATABASE_URL = DB_URL;

// Build to dist/ instead of in place — see helpers/sources.js.
const _req = require('./helpers/sources').buildAndRequire();
const { noDb } = require('./helpers/db');
const { routerMounts, testData } = require('./helpers/sources');
const { holdsMinifig, holdsSet, holdsPart } = require('./helpers/inventory');

const db = testData();
const express = require(path.join(ROOT, 'node_modules', 'express'));

const USER = { id: null, username: 'parity-tester' };
const TOKEN = 'parity-test-token-0123456789';

async function dbReachable() {
  try {
    await db.get('SELECT 1 AS ok');
    return true;
  } catch {
    return false;
  }
}

/** Real schema initialization + fixtures across all domains. */
async function seed() {
  // Schema completely new: other suites (catalog-api) create slimmed-down
  // tables of the same name — CREATE IF NOT EXISTS would keep them.
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  // And the migrations, not only initSchema()
  const client = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(client);
  } finally {
    client.release();
  }

  // No RETURNING: the SQLite compat layer (toPostgres) appends to INSERTs
  // "ON CONFLICT DO NOTHING", which would be invalid after RETURNING.
  await db.run(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') ON CONFLICT DO NOTHING`, [USER.username]);
  USER.id = (await db.get(`SELECT id FROM users WHERE username = $1`, [USER.username])).id;

  // Bearer token as the Android app uses it — stored as a HASH.
  await db.run(`INSERT INTO api_tokens (token, user_id, label) VALUES ($1, $2, 'parity') ON CONFLICT DO NOTHING`, [
    _req('src/account/deviceToken.js').tokenDigest(TOKEN),
    USER.id,
  ]);

  // Sets: one with mixed entries (condition aggregate!), one without
  await holdsSet(db, USER.id, '75192-1', 0, { anywayIfDa: true }); // Quantity 0: the entry behind it carries it
  await holdsSet(db, USER.id, '6346-1', 0, { anywayIfDa: true }); // Quantity 0: the entry behind it carries it
  await db.run(
    `INSERT INTO set_acquisitions (user_id, set_number, purchase_price, condition)
     VALUES ($1,'75192-1',649.99,'N'), ($1,'75192-1',420.00,'U'), ($1,'6346-1',25.00,'N') ON CONFLICT DO NOTHING`,
    [USER.id],
  );
  await db
    .run(
      `INSERT INTO instructions (user_id, set_number, url) VALUES ($1,'75192-1','https://ins/75192.pdf') ON CONFLICT DO NOTHING`,
      [USER.id],
    )
    .catch(() => {});
  await db
    .run(
      `INSERT INTO shared_instructions (set_number, url) VALUES ('6346-1','https://ins/6346-shared.pdf') ON CONFLICT DO NOTHING`,
    )
    .catch(() => {});

  // Parts + minifigures (per set source and manual item)
  await holdsPart(db, USER.id, '3001', { setNumber: '75192-1', quantity: 10, colorId: 4, anywayIfDa: true });
  await holdsPart(db, USER.id, '3020', { quantity: 0, colorId: 0, anywayIfDa: true }); // Quantity 0: the entry behind it carries it
  await holdsMinifig(db, USER.id, 'sw0850', { setNumber: '75192-1', quantity: 1, anywayIfDa: true });
  await holdsMinifig(db, USER.id, 'sw0001', { quantity: 0, anywayIfDa: true }); // Quantity 0: the entry behind it carries it

  // Entries for parts/minifigures (own acquisition endpoints)
  await db.run(
    `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, unit_price, condition)
     VALUES ($1,'3020',0,3,0.15,'N'), ($1,'3020',0,2,0.10,'U') ON CONFLICT DO NOTHING`,
    [USER.id],
  );
  await db.run(
    `INSERT INTO minifig_acquisitions (user_id, fig_number, quantity, unit_price, condition)
     VALUES ($1,'sw0001',2,12.50,'U') ON CONFLICT DO NOTHING`,
    [USER.id],
  );

  // Price history for the price-history comparison
  await db
    .run(
      `INSERT INTO price_history (set_number, condition, currency_code, min_price, avg_price, max_price, qty_avg_price, recorded_at)
     VALUES ('75192-1','N','CHF',700,850,1000,860,NOW() - INTERVAL '2 days'),
            ('75192-1','N','CHF',710,860,1010,870,NOW() - INTERVAL '1 day') ON CONFLICT DO NOTHING`,
    )
    .catch(() => {});

  // Two identical throwaway sets for the write parity tests (PUT/DELETE)
  await holdsSet(db, USER.id, '40567-1', 0, { anywayIfDa: true }); // Quantity 0: the entry behind it carries it
  await holdsSet(db, USER.id, '40568-1', 0, { anywayIfDa: true }); // Quantity 0: the entry behind it carries it
  await db.run(
    `INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition)
     VALUES ($1,'40567-1',1,35.00,'N'), ($1,'40568-1',1,35.00,'N') ON CONFLICT DO NOTHING`,
    [USER.id],
  );

  // Settings: the template must cover BOTH paths
  await db.run(
    `INSERT INTO user_settings (user_id, key, value)
     VALUES ($1,'currency','CHF'), ($1,'user_default_condition','U') ON CONFLICT DO NOTHING`,
    [USER.id],
  );
  await db.run(
    `INSERT INTO global_settings (key, value)
     VALUES ('currency','USD'), ('price_cache_ttl','48'),
            ('default_price_condition','N'), ('app_theme','brick')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
  );

  // Fill price caches so that the valuation endpoints get by WITHOUT an external
  // price API (as in production after the price job)
  await db.run(
    `INSERT INTO price_cache (set_number, condition, currency_code, min_price, avg_price, max_price, qty_avg_price, total_quantity)
     VALUES ('75192-1','N','EUR',700,850,1000,860,40), ('75192-1','U','EUR',500,600,700,610,25),
            ('6346-1','N','EUR',30,45,60,44,10),      ('6346-1','U','EUR',15,22,30,21,12) ON CONFLICT DO NOTHING`,
  );
}

/** Remove envelope fields — the rest must be identical between both APIs. */
// total_value: v1 legacy, alias of totals.qty_avg (own subtest below)
const ENVELOPE = new Set(['success', 'count', 'page', 'page_size', 'total_value']);
// rate_limit: live counter (can change between two requests) — values
// are not deterministically comparable; a subtest checks the structure.
const VOLATILE = new Set(['rate_limit']);
function core(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return body;
  const out = {};
  for (const [k, v] of Object.entries(body)) if (!ENVELOPE.has(k) && !VOLATILE.has(k)) out[k] = v;
  return out;
}

test('API parity web app ↔ Android', async t => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    noDb(t, DB_URL);
    return;
  }
  await seed();

  const app = express();
  app.use(express.json());
  // Inject session — the real middlewares of both families accept it
  app.use((req, _res, next) => {
    if (!req.headers['x-no-session']) req.session = { userId: USER.id, username: USER.username, isAdmin: false };
    next();
  });
  // The mount points come from server.ts
  app.use(_req('src/http/apiV1Alias.js').apiV1Alias);
  app.use('/api/v2', require('./helpers/sources').routerFrom(_req, 'routes/api/index.js'));
  for (const r of routerMounts())
    app.use(r.mount, require('./helpers/sources').routerFrom(_req, 'routes/' + r.name + '.js'));

  const srv = app.listen(0);
  const base = `http://localhost:${srv.address().port}`;
  const get = async (p, headers = {}) => {
    const r = await fetch(base + p, { headers });
    return { status: r.status, body: await r.json().catch(() => null) };
  };

  // Merged routes: ONE address, BOTH credentials
  for (const [name, path] of [
    ['Set-Erfassungen', '/api/v2/sets/75192-1/acquisitions'],
    ['Teil-Erfassungen', '/api/v2/parts/3020/0/acquisitions'],
    ['Minifig-Erfassungen', '/api/v2/minifigs/sw0001/acquisitions'],
    // The minifigure list and manual minifigures are likewise
    // merged — previously they stood above as a PAIR, now they belong
    // here, where “one route, both credentials" is checked.
    ['Minifiguren-Liste', '/api/v2/minifigs'],
    ['Manuelle Minifiguren', '/api/v2/minifigs/manual'],
    // the same conversion for the sets.
    ['Sets-Liste', '/api/v2/sets'],
    ['Set-Detail', '/api/v2/sets/75192-1'],
    // the same conversion for the parts.
    ['Teile-Liste', '/api/v2/parts'],
    ['Teile-Liste (Suche)', '/api/v2/parts?search=Brick&page=1'],
    ['Teile-Farben', '/api/v2/parts/colors'],
    ['Teile-Statistik', '/api/v2/parts/stats'],
    ['Brick-Farbliste', '/api/v2/parts/brick-colors'],
    ['BL-Farb-Mapping', '/api/v2/parts/bl-color-map'],
    ['Manuelle Teile', '/api/v2/parts/manual'],
    // Stage 5: valuation, gain/loss, portfolio history and the three
    // price history routes. They stood above as a PAIR — the duplication was the
    // place where most recently the view for the minifigure history was missing on both
    // paths at once.
    ['Bewertung Sets', '/api/v2/finance/valuation'],
    ['Bewertung Teile', '/api/v2/finance/parts-valuation'],
    ['Bewertung Minifiguren', '/api/v2/finance/minifigs-valuation'],
    ['GuV', '/api/v2/finance/pnl'],
    ['Portfolio-Verlauf', '/api/v2/finance/portfolio-history'],
    ['Preisverlauf Set', '/api/v2/sets/75192-1/price-history'],
    ['Preisverlauf Teil', '/api/v2/parts/3001/4/price-history'],
    ['Preisverlauf Minifigur', '/api/v2/minifigs/sw0001/price-history'],
    // Stage 6: statistics, default condition and the household.
    ['Statistik', '/api/v2/stats'],
    ['Standard-Zustand (global)', '/api/v2/settings/default-condition'],
    ['Standard-Zustand (effektiv)', '/api/v2/settings/user/default-condition'],
    ['Haushalt', '/api/v2/settings/household'],
  ]) {
    await t.test(`merged: ${name} — session and token equivalent`, async () => {
      const withSession = await get(path);
      const withToken = await get(path, { authorization: `Bearer ${TOKEN}`, 'x-no-session': '1' });
      assert.equal(
        withSession.status,
        200,
        `${path} mit Sitzung -> ${withSession.status}: ${JSON.stringify(withSession.body)}`,
      );
      assert.equal(
        withToken.status,
        200,
        `${path} mit Token -> ${withToken.status}: ${JSON.stringify(withToken.body)}`,
      );
      assert.deepEqual(
        core(withToken.body),
        core(withSession.body),
        `${path}: Sitzung und Token liefern Verschiedenes — die Route hängt an der Auth-Art`,
      );
    });
  }

  // Opposite direction: the old second versions must NOT come back.
  await t.test('the acquisition routes exist only once now', async () => {
    // CAUTION: the OLD addresses are here on purpose — what is checked is that
    // they NO longer answer. In a mass rewrite of paths, leave these
    // three lines out (happened to me once while updating).
    for (const alt of [
      '/api/sets/75192-1/acquisitions',
      '/api/parts/3020/0/acquisitions',
      '/api/minifigs/sw0001/acquisitions',
      '/api/minifigs/',
      '/api/minifigs/manual',
      '/api/parts/',
      '/api/parts/manual',
      '/api/sets/',
      '/api/sets/household-members',
      // Stage 5. `/combined-valuation` is included: a
      // third valuation version that nobody called and that
      // would have computed wrongly in the household.
      '/api/finance/valuation',
      '/api/finance/parts-valuation',
      '/api/finance/minifigs-valuation',
      '/api/finance/pnl',
      '/api/finance/portfolio-history',
      '/api/finance/combined-valuation',
      '/api/finance/price-history/75192-1',
      '/api/finance/part-price-history/3001/4',
      '/api/finance/minifig-price-history/sw0001',
      // Stage 6.
      '/api/settings/stats',
      '/api/settings/default-condition',
      '/api/settings/user/default-condition',
      '/api/settings/household',
    ]) {
      const r = await get(alt);
      assert.equal(
        r.status,
        404,
        `${alt} antwortet wieder — dann existiert die Logik erneut doppelt, und ` +
          'genau das sollte der Umbau beenden',
      );
    }
  });

  await t.test('settings: curated v1 fields == web app values', async () => {
    // The web app view and the curated view of the app are NOT
    // merged, and that on purpose: the one carries the global
    // keys and the admin fields that the app neither needs nor should
    // get. Two different responses, not two versions of the same — …
    const web = (await get('/api/v2/settings/raw')).body.settings;
    const v1 = (await get('/api/v2/settings')).body.settings;
    assert.equal(v1.currency, web.currency);
    assert.equal(v1.price_cache_ttl, web.price_cache_ttl);
    assert.equal(v1.user_default_condition, web.user_default_condition);
    assert.equal(v1.default_price_condition, web.default_price_condition);
    assert.equal(v1.app_theme, web.app_theme);
    assert.equal(v1.effective_condition, 'U'); // user value beats global

    // The comparison above alone is not enough: if BOTH delivered the hard-
    // wired default, it would be green as well. Hence here the
    // absolute values from the template — 48 can only come from global_settings,
    // CHF only from user_settings.
    assert.equal(
      v1.price_cache_ttl,
      '48',
      'Ein GLOBAL gesetzter Wert erreicht die App nicht — liest die v1-Route ' +
        'wieder selbst auf user_settings statt über readSettings()?',
    );
    assert.equal(v1.currency, 'CHF', 'Der Wert des Nutzers muss den globalen überschreiben (global steht USD)');
  });

  await t.test('v1 valuation: total_value is an alias of totals.qty_avg', async () => {
    const r = await get('/api/v2/finance/valuation');
    assert.equal(r.body.total_value, r.body.totals.qty_avg);
  });

  await t.test('valuation: same response shape with both credentials', async () => {
    // What stood here before, and why it is gone
    const withSession = (await get('/api/v2/finance/valuation')).body;
    const withToken = (
      await get('/api/v2/finance/valuation', { authorization: `Bearer ${TOKEN}`, 'x-no-session': '1' })
    ).body;
    assert.deepEqual(
      Object.keys(withToken).sort(),
      Object.keys(withSession).sort(),
      'Sitzung und Token liefern verschiedene Felder — dann sieht die App etwas ' +
        'anderes als die Webapp, je nachdem womit sie sich ausweist',
    );
    assert.equal(withToken.total_value, withSession.total_value);
    assert.ok(
      !('rate_limit' in withToken),
      'rate_limit ist wieder in der Bewertung — es liest niemand, und es kostet ' + 'drei Abfragen je Aufruf',
    );
  });

  await t.test('v1 additional fields are consistent (count = sets.length)', async () => {
    const r = await get('/api/v2/sets');
    assert.equal(r.body.count, r.body.sets.length);
  });

  await t.test('price history set: series and chart arrive', async () => {
    // Previously this check compared the web app route with the v1 route. After
    // merging there is only one; the equivalence of the credentials
    // is above. What remains here is the statement of CONTENT: the history
    // delivers points at all, separated per condition (since …
    const b = (await get('/api/v2/sets/75192-1/price-history')).body;
    const pts = h => (h || []).filter(x => !x.is_purchase_price);
    assert.equal(b.success, true);
    assert.ok(pts(b.history_new).length + pts(b.history_used).length >= 2, 'kein Verlauf geliefert');
    assert.ok(b.chart && Array.isArray(b.chart.values), 'chart fehlt');
  });

  await t.test('price history part and minifigure: same shape as for the set', async () => {
    // All three kinds share src/finances/priceHistory.ts. What is checked therefore
    // is that they deliver the same FIELDS — if one kind drifts out of shape, it
    // shows here, even without a second route to compare.
    const felder = ['currency', 'by_condition', 'history_new', 'history_used', 'chart'];
    const set = (await get('/api/v2/sets/75192-1/price-history')).body;
    for (const path of ['/api/v2/parts/3001/4/price-history', '/api/v2/minifigs/sw0001/price-history']) {
      const b = (await get(path)).body;
      assert.equal(b.success, true, `${path} antwortet nicht`);
      for (const k of felder) assert.ok(k in b, `${path}: Feld ${k} fehlt (das Set liefert es: ${typeof set[k]})`);
    }
  });

  // ── Write parity: same call via both families -> same effect ──────────────
  await t.test('PUT set: web app and Android route have the same effect', async () => {
    const body = JSON.stringify({ quantity: 4, purchase_price: 42.5, condition: 'U' });
    const hdr = { 'content-type': 'application/json' };
    // There is only ONE write route left. What is checked therefore
    // is that it has the same effect via BOTH credentials — with a session on one
    // set, with a token on the other.
    const put = (p, extra = {}) => fetch(base + p, { method: 'PUT', headers: { ...hdr, ...extra }, body });
    assert.equal((await put('/api/v2/sets/40567-1')).status, 200, 'Schreiben mit Sitzung');
    assert.equal(
      (await put('/api/v2/sets/40568-1', { authorization: `Bearer ${TOKEN}`, 'x-no-session': '1' })).status,
      200,
      'Schreiben mit Token',
    );
    const a = (await get('/api/v2/sets/40567-1')).body.set;
    const b = (await get('/api/v2/sets/40568-1')).body.set;
    for (const k of ['quantity', 'purchase_price', 'condition'])
      assert.deepEqual(a[k], b[k], `Feld ${k} weicht ab — Sitzung und Token bewirken Verschiedenes`);
    assert.equal(a.quantity, 4);
  });

  await t.test('PUT acquisition: web app and Android route have the same effect', async () => {
    const idOf = async sn => (await get(`/api/v2/sets/${sn}/acquisitions`)).body.acquisitions[0].id;
    const hdr = { 'content-type': 'application/json' };
    const body = JSON.stringify({ quantity: 2, purchase_price: 30, condition: 'U' });
    // Merged: there is only ONE write route left. What is checked
    // therefore is that it has the same effect via BOTH credentials — with
    // a session on one set, with a token on the other; afterwards both sets must
    // show the same state. That is the statement that counts after the rebuild: …
    const rA = await fetch(base + `/api/v2/sets/40567-1/acquisitions/${await idOf('40567-1')}`, {
      method: 'PUT',
      headers: hdr,
      body,
    });
    const rB = await fetch(base + `/api/v2/sets/40568-1/acquisitions/${await idOf('40568-1')}`, {
      method: 'PUT',
      headers: { ...hdr, authorization: `Bearer ${TOKEN}`, 'x-no-session': '1' },
      body,
    });
    assert.equal(rA.status, 200, 'Schreiben mit Sitzung');
    assert.equal(rB.status, 200, 'Schreiben mit Token');
    const strip = a => a.map(({ quantity, purchase_price, condition }) => ({ quantity, purchase_price, condition }));
    const a = (await get('/api/v2/sets/40567-1/acquisitions')).body.acquisitions;
    const b = (await get('/api/v2/sets/40568-1/acquisitions')).body.acquisitions;
    assert.deepEqual(strip(a), strip(b), 'Sitzung und Token bewirken Verschiedenes auf derselben Route');
  });

  await t.test('DELETE set: web app and Android route have the same effect', async () => {
    // Likewise one route, both credentials.
    assert.equal((await fetch(base + '/api/v2/sets/40567-1', { method: 'DELETE' })).status, 200, 'Löschen mit Sitzung');
    assert.equal(
      (
        await fetch(base + '/api/v2/sets/40568-1', {
          method: 'DELETE',
          headers: { authorization: `Bearer ${TOKEN}`, 'x-no-session': '1' },
        })
      ).status,
      200,
      'Löschen mit Token',
    );
    assert.equal((await get('/api/v2/sets/40567-1')).status, 404);
    assert.equal((await get('/api/v2/sets/40568-1')).status, 404);
    // Cleanup behavior identical: no orphaned entries
    for (const sn of ['40567-1', '40568-1']) {
      const left = await db.get('SELECT COUNT(*)::int AS n FROM set_acquisitions WHERE user_id=$1 AND set_number=$2', [
        USER.id,
        sn,
      ]);
      assert.equal(left.n, 0, `verwaiste Erfassungen bei ${sn}`);
    }
  });

  await t.test('bearer token (Android auth) delivers the same as the session', async () => {
    const viaSession = await get('/api/v2/sets');
    const viaToken = await get('/api/v2/sets', { authorization: `Bearer ${TOKEN}`, 'x-no-session': '1' });
    assert.equal(viaToken.status, 200, `Bearer-Auth fehlgeschlagen: ${JSON.stringify(viaToken.body)}`);
    assert.deepEqual(core(viaToken.body), core(viaSession.body));
  });

  await t.test('without auth: both guards reject', async () => {
    // There is only ONE address space (/api/v1): an address outside it would answer
    // with 404, and that would look like a passed rejection.
    const withToken = await get('/api/v2/sets', { 'x-no-session': '1' });
    const onlySession = await get('/api/v2/settings/raw', { 'x-no-session': '1' });
    assert.equal(withToken.status, 401, 'requireToken laesst ohne Ausweis durch');
    assert.equal(onlySession.status, 401, 'requireLogin laesst ohne Sitzung durch');
  });

  srv.close();
  await db.pool.end();
});
