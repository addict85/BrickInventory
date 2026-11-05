/**
 * EINE Adresse, BEIDE Ausweise: Sitzung (Weboberfläche) und Bearer-Token
 * (Android-App) müssen für dieselbe Route dasselbe liefern. Doppelte Routen
 * gibt es nicht mehr; geprüft wird, dass keine Route nur an einer Ausweisart
 * hängt.
 * Ausführlich: docs/begruendungen/test/api-parity.test.js.md#kopf
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DB_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.DATABASE_URL = DB_URL;

// Nach dist/ bauen statt in-place — siehe helpers/sources.js.
const _req = require('./helpers/sources').buildAndRequire();
const { routerEinhaengungen } = require('./helpers/sources');
const { haeltFigur, haeltSet, haeltTeil } = require('./helpers/bestand');

const db = _req('db/database.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));

const USER = { id: null, username: 'parity-tester' };
const TOKEN = 'parity-test-token-0123456789';

async function dbReachable() {
  try { await db.get('SELECT 1 AS ok'); return true; } catch { return false; }
}

/** Echte Schema-Initialisierung + Fixtures über alle Domänen. */
async function seed() {
  // Schema komplett neu: andere Suiten (catalog-api) legen abgespeckte
  // Tabellen gleichen Namens an — CREATE IF NOT EXISTS würde die behalten.
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  // Und die Migrationen, nicht nur initSchema()
  // Ausführlich: docs/begruendungen/test/api-parity.test.js.md#client
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); } finally { client.release(); }

  // Kein RETURNING: der SQLite-Kompat-Layer (toPostgres) hängt an INSERTs
  // "ON CONFLICT DO NOTHING" an, was hinter RETURNING ungültig wäre.
  await db.run(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') ON CONFLICT DO NOTHING`, [USER.username]);
  USER.id = (await db.get(`SELECT id FROM users WHERE username = $1`, [USER.username])).id;

  // Bearer-Token wie ihn die Android-App nutzt — als HASH abgelegt.
  // Ausführlich: docs/begruendungen/test/api-parity.test.js.md#stelle
  await db.run(`INSERT INTO api_tokens (token, user_id, label) VALUES ($1, $2, 'parity') ON CONFLICT DO NOTHING`,
    [_req('src/konto/auth.js').hashToken(TOKEN), USER.id]);

  // Sets: eines mit gemischten Erfassungen (Zustand-Aggregat!), eines ohne
  await haeltSet(db, USER.id, '75192-1', 0, { egalWennDa: true });  // Menge 0: die Erfassung dahinter traegt sie
  await haeltSet(db, USER.id, '6346-1', 0, { egalWennDa: true });  // Menge 0: die Erfassung dahinter traegt sie
  await db.run(
    `INSERT INTO set_acquisitions (user_id, set_number, purchase_price, condition)
     VALUES ($1,'75192-1',649.99,'N'), ($1,'75192-1',420.00,'U'), ($1,'6346-1',25.00,'N') ON CONFLICT DO NOTHING`, [USER.id]);
  await db.run(
    `INSERT INTO instructions (user_id, set_number, url) VALUES ($1,'75192-1','https://ins/75192.pdf') ON CONFLICT DO NOTHING`,
    [USER.id]).catch(() => {});
  await db.run(
    `INSERT INTO shared_instructions (set_number, url) VALUES ('6346-1','https://ins/6346-shared.pdf') ON CONFLICT DO NOTHING`)
    .catch(() => {});

  // Teile + Minifiguren (je Set-Quelle und manuelle Position)
  await haeltTeil(db, USER.id, '3001', { setNumber: '75192-1', menge: 10, colorId: 4, egalWennDa: true });
  await haeltTeil(db, USER.id, '3020', { menge: 0, colorId: 0, egalWennDa: true });  // Menge 0: die Erfassung dahinter traegt sie
  await haeltFigur(db, USER.id, 'sw0850', { setNumber: '75192-1', menge: 1, egalWennDa: true });
  await haeltFigur(db, USER.id, 'sw0001', { menge: 0, egalWennDa: true });  // Menge 0: die Erfassung dahinter traegt sie

  // Erfassungen für Teile/Minifiguren (eigene Acquisition-Endpunkte)
  await db.run(
    `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, unit_price, condition)
     VALUES ($1,'3020',0,3,0.15,'N'), ($1,'3020',0,2,0.10,'U') ON CONFLICT DO NOTHING`, [USER.id]);
  await db.run(
    `INSERT INTO minifig_acquisitions (user_id, fig_number, quantity, unit_price, condition)
     VALUES ($1,'sw0001',2,12.50,'U') ON CONFLICT DO NOTHING`, [USER.id]);

  // Preisverlauf für den price-history-Vergleich
  await db.run(
    `INSERT INTO price_history (set_number, condition, currency_code, min_price, avg_price, max_price, qty_avg_price, recorded_at)
     VALUES ('75192-1','N','CHF',700,850,1000,860,NOW() - INTERVAL '2 days'),
            ('75192-1','N','CHF',710,860,1010,870,NOW() - INTERVAL '1 day') ON CONFLICT DO NOTHING`).catch(() => {});

  // Zwei identische Wegwerf-Sets für die Schreib-Paritätstests (PUT/DELETE)
  await haeltSet(db, USER.id, '40567-1', 0, { egalWennDa: true });  // Menge 0: die Erfassung dahinter traegt sie
  await haeltSet(db, USER.id, '40568-1', 0, { egalWennDa: true });  // Menge 0: die Erfassung dahinter traegt sie
  await db.run(
    `INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition)
     VALUES ($1,'40567-1',1,35.00,'N'), ($1,'40568-1',1,35.00,'N') ON CONFLICT DO NOTHING`, [USER.id]);

  // Einstellungen: die Vorlage muss BEIDE Wege abdecken
  // Ausführlich: docs/begruendungen/test/api-parity.test.js.md#stelle-2
  await db.run(
    `INSERT INTO user_settings (user_id, key, value)
     VALUES ($1,'currency','CHF'), ($1,'user_default_condition','U') ON CONFLICT DO NOTHING`,
    [USER.id]);
  await db.run(
    `INSERT INTO global_settings (key, value)
     VALUES ('currency','USD'), ('price_cache_ttl','48'),
            ('default_price_condition','N'), ('app_theme','brick')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);

  // Preis-Caches füllen, damit die Bewertungs-Endpunkte OHNE externe
  // Preis-API auskommen (wie in Produktion nach dem Preis-Job)
  await db.run(
    `INSERT INTO price_cache (set_number, condition, currency_code, min_price, avg_price, max_price, qty_avg_price, total_quantity)
     VALUES ('75192-1','N','EUR',700,850,1000,860,40), ('75192-1','U','EUR',500,600,700,610,25),
            ('6346-1','N','EUR',30,45,60,44,10),      ('6346-1','U','EUR',15,22,30,21,12) ON CONFLICT DO NOTHING`);
}

/** Envelope-Felder entfernen — der Rest muss zwischen beiden APIs identisch sein. */
// total_value: v1-Altbestand, Alias von totals.qty_avg (eigener Subtest unten)
const ENVELOPE = new Set(['success', 'count', 'page', 'page_size', 'total_value']);
// rate_limit: Live-Zähler (kann sich zwischen zwei Requests ändern) — Werte
// sind nicht deterministisch vergleichbar; die Struktur prüft ein Subtest.
const VOLATILE = new Set(['rate_limit']);
function core(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return body;
  const out = {};
  for (const [k, v] of Object.entries(body))
    if (!ENVELOPE.has(k) && !VOLATILE.has(k)) out[k] = v;
  return out;
}

test('API-Parität Webapp ↔ Android', async (t) => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    if (process.env.REQUIRE_DB === '1') {
      throw new Error(`REQUIRE_DB=1, aber die Test-Datenbank ist nicht erreichbar: ${DB_URL}`);
    }
    t.skip(`Test-DB nicht erreichbar (${DB_URL}) — Suite übersprungen`);
    return;
  }
  await seed();

  const app = express();
  app.use(express.json());
  // Session injizieren — die echten Middlewares beider Familien akzeptieren sie
  app.use((req, _res, next) => {
    if (!req.headers['x-no-session'])
      req.session = { userId: USER.id, username: USER.username, isAdmin: false };
    next();
  });
  // Die Einhaengepunkte kommen aus server.ts
  // Ausführlich: docs/begruendungen/test/api-parity.test.js.md#stelle-3
  app.use('/api/v1',       _req('routes/api_v1/index.js'));
  for (const r of routerEinhaengungen())
    app.use(r.mount, _req('routes/' + r.name + '.js'));

  const srv = app.listen(0);
  const base = `http://localhost:${srv.address().port}`;
  const get = async (p, headers = {}) => {
    const r = await fetch(base + p, { headers });
    return { status: r.status, body: await r.json().catch(() => null) };
  };

  // Zusammengelegte Routen: EINE Adresse, BEIDE Ausweise
  // Ausführlich: docs/begruendungen/test/api-parity.test.js.md#for-stelle
  for (const [name, pfad] of [
    ['Set-Erfassungen',     '/api/v1/sets/75192-1/acquisitions'],
    ['Teil-Erfassungen',    '/api/v1/parts/3020/0/acquisitions'],
    ['Minifig-Erfassungen', '/api/v1/minifigs/sw0001/acquisitions'],
    // Minifiguren-Liste und manuelle Minifiguren sind ebenfalls
    // zusammengelegt — vorher standen sie oben als PAAR, jetzt gehören sie
    // hierher, wo „eine Route, beide Ausweise" geprüft wird.
    ['Minifiguren-Liste',   '/api/v1/minifigs'],
    ['Manuelle Minifiguren', '/api/v1/minifigs/manual'],
    // dieselbe Umstellung für die Sets.
    ['Sets-Liste', '/api/v1/sets'],
    ['Set-Detail', '/api/v1/sets/75192-1'],
    // dieselbe Umstellung für die Teile.
    ['Teile-Liste', '/api/v1/parts'],
    ['Teile-Liste (Suche)', '/api/v1/parts?search=Brick&page=1'],
    ['Teile-Farben', '/api/v1/parts/colors'],
    ['Teile-Statistik', '/api/v1/parts/stats'],
    ['Brick-Farbliste', '/api/v1/parts/brick-colors'],
    ['BL-Farb-Mapping', '/api/v1/parts/bl-color-map'],
    ['Manuelle Teile', '/api/v1/parts/manual'],
    // Etappe 5: Bewertung, GuV, Portfolio-Verlauf und die drei
    // Preisverlaufs-Routen. Sie standen oben als PAAR — die Doppelung war die
    // Stelle, an der zuletzt das Blickfeld beim Minifiguren-Verlauf auf beiden
    // Wegen gleichzeitig fehlte.
    ['Bewertung Sets',        '/api/v1/finance/valuation'],
    ['Bewertung Teile',       '/api/v1/finance/parts-valuation'],
    ['Bewertung Minifiguren', '/api/v1/finance/minifigs-valuation'],
    ['GuV',                   '/api/v1/finance/pnl'],
    ['Portfolio-Verlauf',     '/api/v1/finance/portfolio-history'],
    ['Preisverlauf Set',      '/api/v1/sets/75192-1/price-history'],
    ['Preisverlauf Teil',     '/api/v1/parts/3001/4/price-history'],
    ['Preisverlauf Minifigur','/api/v1/minifigs/sw0001/price-history'],
    // Etappe 6: Statistik, Standard-Zustand und der Haushalt.
    ['Statistik',              '/api/v1/stats'],
    ['Standard-Zustand (global)', '/api/v1/settings/default-condition'],
    ['Standard-Zustand (effektiv)', '/api/v1/settings/user/default-condition'],
    ['Haushalt',               '/api/v1/settings/household'],
  ]) {
    await t.test(`Zusammengelegt: ${name} — Sitzung und Token gleichwertig`, async () => {
      const mitSitzung = await get(pfad);
      const mitToken   = await get(pfad, { authorization: `Bearer ${TOKEN}`, 'x-no-session': '1' });
      assert.equal(mitSitzung.status, 200,
        `${pfad} mit Sitzung -> ${mitSitzung.status}: ${JSON.stringify(mitSitzung.body)}`);
      assert.equal(mitToken.status, 200,
        `${pfad} mit Token -> ${mitToken.status}: ${JSON.stringify(mitToken.body)}`);
      assert.deepEqual(core(mitToken.body), core(mitSitzung.body),
        `${pfad}: Sitzung und Token liefern Verschiedenes — die Route hängt an der Auth-Art`);
    });
  }

  // Gegenrichtung: Die alten Zweitfassungen dürfen NICHT zurückkehren.
  await t.test('die Erfassungs-Routen gibt es nur noch einmal', async () => {
    // ACHTUNG: Hier stehen absichtlich die ALTEN Adressen — geprüft wird, dass
    // sie NICHT mehr antworten. Bei einer Massenumstellung von Pfaden diese
    // drei Zeilen auslassen (mir selbst beim Nachziehen einmal passiert).
    for (const alt of ['/api/sets/75192-1/acquisitions',
                       '/api/parts/3020/0/acquisitions',
                       '/api/minifigs/sw0001/acquisitions',
                       '/api/minifigs/',
                       '/api/minifigs/manual',
                       '/api/parts/', '/api/parts/manual',
                       '/api/sets/', '/api/sets/household-members',
                       // Etappe 5. `/combined-valuation` steht mit dabei: eine
                       // dritte Bewertungsfassung, die niemand aufrief und die
                       // im Haushalt falsch gerechnet hätte.
                       '/api/finance/valuation', '/api/finance/parts-valuation',
                       '/api/finance/minifigs-valuation', '/api/finance/pnl',
                       '/api/finance/portfolio-history', '/api/finance/combined-valuation',
                       '/api/finance/price-history/75192-1',
                       '/api/finance/part-price-history/3001/4',
                       '/api/finance/minifig-price-history/sw0001',
                       // Etappe 6.
                       '/api/settings/stats', '/api/settings/default-condition',
                       '/api/settings/user/default-condition',
                       '/api/settings/household']) {
      const r = await get(alt);
      assert.equal(r.status, 404,
        `${alt} antwortet wieder — dann existiert die Logik erneut doppelt, und ` +
        'genau das sollte der Umbau beenden');
    }
  });

  await t.test('Einstellungen: kuratierte v1-Felder == Webapp-Werte', async () => {
    // Die Webapp-Sicht und die kuratierte Sicht der App sind NICHT
    // zusammengelegt, und das mit Absicht: Die eine trägt die globalen
    // Schlüssel und die Admin-Felder, die die App weder braucht noch bekommen
    // soll. Zwei verschiedene Antworten, nicht zwei Fassungen derselben — …
    // Ausführlich: docs/begruendungen/test/api-parity.test.js.md#web-stelle
    const web = (await get('/api/v1/settings/raw')).body.settings;
    const v1 = (await get('/api/v1/settings')).body.settings;
    assert.equal(v1.currency, web.currency);
    assert.equal(v1.price_cache_ttl, web.price_cache_ttl);
    assert.equal(v1.user_default_condition, web.user_default_condition);
    assert.equal(v1.default_price_condition, web.default_price_condition);
    assert.equal(v1.app_theme, web.app_theme);
    assert.equal(v1.effective_condition, 'U');   // User-Wert schlägt global

    // Der Vergleich oben allein reicht nicht: Lieferten BEIDE die fest
    // verdrahtete Vorgabe, wäre er ebenfalls grün. Deshalb hier die
    // absoluten Werte aus der Vorlage — 48 kann nur aus global_settings
    // stammen, CHF nur aus user_settings.
    assert.equal(v1.price_cache_ttl, '48',
      'Ein GLOBAL gesetzter Wert erreicht die App nicht — liest die v1-Route ' +
      'wieder selbst auf user_settings statt über readSettings()?');
    assert.equal(v1.currency, 'CHF',
      'Der Wert des Nutzers muss den globalen überschreiben (global steht USD)');
  });

  await t.test('v1 valuation: total_value ist Alias von totals.qty_avg', async () => {
    const r = await get('/api/v1/finance/valuation');
    assert.equal(r.body.total_value, r.body.totals.qty_avg);
  });

  await t.test('Bewertung: gleiche Antwortform mit beiden Ausweisen', async () => {
    // Was hier vorher stand, und warum es weg ist
    // Ausführlich: docs/begruendungen/test/api-parity.test.js.md#mitsitzung
    const mitSitzung = (await get('/api/v1/finance/valuation')).body;
    const mitToken = (await get('/api/v1/finance/valuation',
      { authorization: `Bearer ${TOKEN}`, 'x-no-session': '1' })).body;
    assert.deepEqual(Object.keys(mitToken).sort(), Object.keys(mitSitzung).sort(),
      'Sitzung und Token liefern verschiedene Felder — dann sieht die App etwas ' +
      'anderes als die Webapp, je nachdem womit sie sich ausweist');
    assert.equal(mitToken.total_value, mitSitzung.total_value);
    assert.ok(!('rate_limit' in mitToken),
      'rate_limit ist wieder in der Bewertung — es liest niemand, und es kostet ' +
      'drei Abfragen je Aufruf');
  });

  await t.test('v1-Zusatzfelder sind konsistent (count = sets.length)', async () => {
    const r = await get('/api/v1/sets');
    assert.equal(r.body.count, r.body.sets.length);
  });

  await t.test('Preisverlauf Set: Reihen und Diagramm kommen an', async () => {
    // Vorher verglich diese Prüfung die Webapp-Route gegen die v1-Route. Nach
    // dem Zusammenlegen gibt es nur eine; die Gleichwertigkeit der Ausweise
    // steht oben. Was hier bleibt, ist die INHALTLICHE Aussage: Der Verlauf
    // liefert überhaupt Punkte, und zwar je Zustand getrennt (seit …
    // Ausführlich: docs/begruendungen/test/api-parity.test.js.md#b-stelle
    const b = (await get('/api/v1/sets/75192-1/price-history')).body;
    const pts = h => (h || []).filter(x => !x.is_purchase_price);
    assert.equal(b.success, true);
    assert.ok(pts(b.history_new).length + pts(b.history_used).length >= 2,
      'kein Verlauf geliefert');
    assert.ok(b.chart && Array.isArray(b.chart.values), 'chart fehlt');
  });

  await t.test('Preisverlauf Teil und Minifigur: gleiche Form wie beim Set', async () => {
    // Alle drei Arten teilen sich src/finanzen/priceHistory.ts. Geprüft wird deshalb,
    // dass sie dieselben FELDER liefern — läuft eine Art aus der Form, fällt
    // es hier auf, auch ohne zweite Route zum Vergleichen.
    const felder = ['currency', 'by_condition', 'history_new', 'history_used', 'chart'];
    const set = (await get('/api/v1/sets/75192-1/price-history')).body;
    for (const pfad of ['/api/v1/parts/3001/4/price-history',
                        '/api/v1/minifigs/sw0001/price-history']) {
      const b = (await get(pfad)).body;
      assert.equal(b.success, true, `${pfad} antwortet nicht`);
      for (const k of felder)
        assert.ok(k in b, `${pfad}: Feld ${k} fehlt (das Set liefert es: ${typeof set[k]})`);
    }
  });

  // ── Schreib-Parität: gleicher Aufruf über beide Familien -> gleicher Effekt ──
  await t.test('PUT Set: Webapp- und Android-Route bewirken dasselbe', async () => {
    const body = JSON.stringify({ quantity: 4, purchase_price: 42.5, condition: 'U' });
    const hdr = { 'content-type': 'application/json' };
    // Es gibt nur noch EINE Schreibroute. Geprüft wird deshalb,
    // dass sie über BEIDE Ausweise dieselbe Wirkung hat — mit Sitzung am einen
    // Set, mit Token am anderen.
    const put = (p, extra = {}) =>
      fetch(base + p, { method: 'PUT', headers: { ...hdr, ...extra }, body });
    assert.equal((await put('/api/v1/sets/40567-1')).status, 200, 'Schreiben mit Sitzung');
    assert.equal((await put('/api/v1/sets/40568-1',
      { authorization: `Bearer ${TOKEN}`, 'x-no-session': '1' })).status, 200, 'Schreiben mit Token');
    const a = (await get('/api/v1/sets/40567-1')).body.set;
    const b = (await get('/api/v1/sets/40568-1')).body.set;
    for (const k of ['quantity', 'purchase_price', 'condition'])
      assert.deepEqual(a[k], b[k], `Feld ${k} weicht ab — Sitzung und Token bewirken Verschiedenes`);
    assert.equal(a.quantity, 4);
  });

  await t.test('PUT Erfassung: Webapp- und Android-Route bewirken dasselbe', async () => {
    const idOf = async (sn) =>
      (await get(`/api/v1/sets/${sn}/acquisitions`)).body.acquisitions[0].id;
    const hdr = { 'content-type': 'application/json' };
    const body = JSON.stringify({ quantity: 2, purchase_price: 30, condition: 'U' });
    // Zusammengelegt: Es gibt nur noch EINE Schreibroute. Geprüft
    // wird deshalb, dass sie über BEIDE Ausweise dieselbe Wirkung hat — mit
    // Sitzung am einen Set, mit Token am anderen, danach müssen beide Sets
    // denselben Stand zeigen. Das ist die Aussage, die nach dem Umbau zählt: …
    // Ausführlich: docs/begruendungen/test/api-parity.test.js.md#ra-stelle
    const rA = await fetch(base + `/api/v1/sets/40567-1/acquisitions/${await idOf('40567-1')}`,
      { method: 'PUT', headers: hdr, body });
    const rB = await fetch(base + `/api/v1/sets/40568-1/acquisitions/${await idOf('40568-1')}`,
      { method: 'PUT',
        headers: { ...hdr, authorization: `Bearer ${TOKEN}`, 'x-no-session': '1' },
        body });
    assert.equal(rA.status, 200, 'Schreiben mit Sitzung');
    assert.equal(rB.status, 200, 'Schreiben mit Token');
    const strip = a => a.map(({ quantity, purchase_price, condition }) => ({ quantity, purchase_price, condition }));
    const a = (await get('/api/v1/sets/40567-1/acquisitions')).body.acquisitions;
    const b = (await get('/api/v1/sets/40568-1/acquisitions')).body.acquisitions;
    assert.deepEqual(strip(a), strip(b),
      'Sitzung und Token bewirken Verschiedenes auf derselben Route');
  });

  await t.test('DELETE Set: Webapp- und Android-Route bewirken dasselbe', async () => {
    // Ebenfalls eine Route, beide Ausweise.
    assert.equal((await fetch(base + '/api/v1/sets/40567-1',
      { method: 'DELETE' })).status, 200, 'Löschen mit Sitzung');
    assert.equal((await fetch(base + '/api/v1/sets/40568-1',
      { method: 'DELETE', headers: { authorization: `Bearer ${TOKEN}`, 'x-no-session': '1' } })).status,
      200, 'Löschen mit Token');
    assert.equal((await get('/api/v1/sets/40567-1')).status, 404);
    assert.equal((await get('/api/v1/sets/40568-1')).status, 404);
    // Aufräumverhalten identisch: keine verwaisten Erfassungen
    for (const sn of ['40567-1', '40568-1']) {
      const left = await db.get(
        'SELECT COUNT(*)::int AS n FROM set_acquisitions WHERE user_id=$1 AND set_number=$2',
        [USER.id, sn]);
      assert.equal(left.n, 0, `verwaiste Erfassungen bei ${sn}`);
    }
  });

  await t.test('Bearer-Token (Android-Auth) liefert dasselbe wie die Session', async () => {
    const viaSession = await get('/api/v1/sets');
    const viaToken = await get('/api/v1/sets',
      { authorization: `Bearer ${TOKEN}`, 'x-no-session': '1' });
    assert.equal(viaToken.status, 200,
      `Bearer-Auth fehlgeschlagen: ${JSON.stringify(viaToken.body)}`);
    assert.deepEqual(core(viaToken.body), core(viaSession.body));
  });

  await t.test('ohne Auth: beide Absicherungen lehnen ab', async () => {
    // Hier stand `/api/sets/` gegen `/api/v1/sets` — „beide Familien". Seit
    // dem Zusammenlegen der API-Oberflaechen gibt es nur noch EINEN
    // Adressraum; die alte Adresse antwortet gar nicht mehr, und der Test
    // haette einen 404 fuer eine bestandene Abweisung gehalten.
    // Ausführlich: docs/begruendungen/test/api-parity.test.js.md#mittoken
    const mitToken = await get('/api/v1/sets', { 'x-no-session': '1' });
    const nurSitzung = await get('/api/v1/settings/raw', { 'x-no-session': '1' });
    assert.equal(mitToken.status, 401, 'requireToken laesst ohne Ausweis durch');
    assert.equal(nurSitzung.status, 401, 'requireLogin laesst ohne Sitzung durch');
  });

  srv.close();
  await db.pool.end();
});
