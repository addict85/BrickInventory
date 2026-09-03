/**
 * API-Paritätstest: Die Session-Routen der Webapp (/api/...) und die
 * Token-Routen der Android-App (/api/v1/...) müssen für dieselben Daten
 * dieselben Informationen liefern.
 *
 * Aufbau: Der ECHTE Stack läuft — beide Router-Familien, die gemeinsamen
 * Handler (utils/handlers) und das echte db-Modul gegen die Test-DB. Es wird
 * NICHTS gestubbt; die Authentifizierung erfolgt über eine injizierte
 * Session (die echten requireLogin/requireToken-Middlewares akzeptieren sie
 * beide). Zusätzlich wird der Bearer-Token-Pfad (so authentifiziert Android
 * wirklich) einmal end-to-end gegen den Session-Pfad verglichen.
 *
 * Vergleich: Von beiden Antworten werden nur die bekannten Envelope-Felder
 * (success, count, page, page_size) entfernt — der Rest muss deep-equal sein.
 * So fällt JEDE inhaltliche Abweichung zwischen Webapp- und Android-API auf,
 * auch bei künftigen Feldern.
 *
 * Voraussetzung wie test/catalog-api.test.js: Test-DB (Inhalt wird geleert!)
 * via TEST_DATABASE_URL, Default postgres://tester:test@localhost/cattest.
 * Ohne erreichbare DB: skip. Ausführen: npm test  /  npm run test:api
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DB_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.DATABASE_URL = DB_URL;
process.env.WEB_WORKERS = '1';

// Nach dist/ bauen statt in-place — siehe helpers/sources.js.
const _req = require('./helpers/sources').buildAndRequire();

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

  // Kein RETURNING: der SQLite-Kompat-Layer (toPostgres) hängt an INSERTs
  // "ON CONFLICT DO NOTHING" an, was hinter RETURNING ungültig wäre.
  await db.run(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') ON CONFLICT DO NOTHING`, [USER.username]);
  USER.id = (await db.get(`SELECT id FROM users WHERE username = $1`, [USER.username])).id;

  // Bearer-Token wie ihn die Android-App nutzt — als HASH abgelegt.
  //
  // Der Kommentar hier versprach früher, validateToken() migriere einen
  // Klartext-Token beim ersten Treffer selbst. Diesen Rückfallpfad gibt es
  // nicht mehr (er hätte einen erratenen Token dauerhaft gültig gemacht), und
  // seither seedete dieser Test einen Token, mit dem man sich nicht anmelden
  // kann. Aufgefallen ist es nie, weil der ganze Test ohne Postgres
  // übersprungen wird.
  await db.run(`INSERT INTO api_tokens (token, user_id, label) VALUES ($1, $2, 'parity') ON CONFLICT DO NOTHING`,
    [_req('utils/auth.js').hashToken(TOKEN), USER.id]);

  // Sets: eines mit gemischten Erfassungen (Zustand-Aggregat!), eines ohne
  await db.run(
    `INSERT INTO sets (user_id, set_number, name, year, theme, pieces, minifigs, quantity, image_url, purchase_price, condition)
     VALUES ($1,'75192-1','Millennium Falcon',2017,'Star Wars',7541,8,2,'https://img/75192.jpg',649.99,'N'),
            ($1,'6346-1','Shuttle Launching Crew',1992,'Town',154,3,1,NULL,25.00,'N') ON CONFLICT DO NOTHING`, [USER.id]);
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
  await db.run(
    `INSERT INTO parts (user_id, set_number, part_number, part_name, color_id, color_name, color_hex, category_name, quantity, source)
     VALUES ($1,'75192-1','3001','Brick 2 x 4',4,'Red','C91A09','Bricks',10,'set'),
            ($1,NULL,'3020','Plate 2 x 4',0,'Black','05131D','Plates',5,'manual') ON CONFLICT DO NOTHING`, [USER.id]);
  await db.run(
    `INSERT INTO minifigs (user_id, set_number, fig_number, fig_name, quantity, source)
     VALUES ($1,'75192-1','sw0850','Han Solo',1,'set'),
            ($1,NULL,'sw0001','Luke Skywalker',2,'manual') ON CONFLICT DO NOTHING`, [USER.id]);

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
  await db.run(
    `INSERT INTO sets (user_id, set_number, name, year, quantity, purchase_price, condition)
     VALUES ($1,'40567-1','Forest Hideout A',2022,1,35.00,'N'),
            ($1,'40568-1','Forest Hideout B',2022,1,35.00,'N') ON CONFLICT DO NOTHING`, [USER.id]);
  await db.run(
    `INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition)
     VALUES ($1,'40567-1',1,35.00,'N'), ($1,'40568-1',1,35.00,'N') ON CONFLICT DO NOTHING`, [USER.id]);

  // ── Einstellungen: die Vorlage muss BEIDE Wege abdecken ────────────────────
  //
  // Vorher stand price_cache_ttl hier als BENUTZER-Einstellung. Damit lasen
  // beide APIs dieselbe Tabelle, und der globale Weg wurde nie berührt — die
  // v1-Route las ausschliesslich user_settings und lieferte sonst ihre fest
  // verdrahtete 24. Gemessen: global 48 → Webapp 48, App 24. Der Test war
  // grün, weil seine Vorlage die einzige Zeile schrieb, die den Fehler
  // verdeckt.
  //
  // Jetzt trägt die Vorlage beide Fälle:
  //   price_cache_ttl  NUR global   → ein globaler Wert muss die App erreichen
  //   currency         beides       → der Wert des Nutzers muss gewinnen
  //
  // DO UPDATE statt DO NOTHING ist hier Bedingung: initSchema() legt
  // price_cache_ttl bereits global mit '24' an — ausgerechnet dem Wert, den
  // die v1-Route fest verdrahtet hatte. Mit DO NOTHING bliebe die 24 stehen,
  // beide APIs lieferten 24, und der Vergleich wäre wieder grün, ohne den
  // globalen Weg berührt zu haben. Kein Wert der Vorlage darf mit einer
  // Vorgabe übereinstimmen, sonst prüft die Zusicherung nur die Vorgabe.
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

// ── Paar-Definitionen: Webapp-Pfad ↔ Android-Pfad ────────────────────────────
// Verbliebene ECHTE Paare: zwei Adressen für dieselben Daten. Die Finanz-Paare
// standen bis Etappe 5 hier — sie sind zusammengelegt und werden weiter unten
// unter „eine Route, beide Ausweise" geprüft.
// Nach Etappe 6 gibt es KEIN Lese-Paar mehr: Was doppelt existierte, ist
// zusammengelegt und wird weiter unten unter „eine Route, beide Ausweise"
// geprüft. Die Liste bleibt stehen, weil ein künftiges Paar hier wieder
// auftauchen soll, statt still ungeprüft zu bleiben.
const PAIRS = [];

test('API-Parität Webapp ↔ Android', async (t) => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    // REQUIRE_DB=1 (CI): Ein Überspringen ist hier KEIN akzeptabler Ausgang.
    // Vorher war die Suite in jeder Umgebung ohne Datenbank grün — also
    // ausgerechnet dort, wo niemand hinschaut. Wer die Datenbank erwartet,
    // bekommt jetzt einen Fehlschlag statt eines stillen Skips.
    if (process.env.REQUIRE_DB === '1') {
      throw new Error(`REQUIRE_DB=1, aber die Test-Datenbank ist nicht erreichbar: ${DB_URL}`);
    }
    // REQUIRE_DB=1 (in CI gesetzt) verbietet das Überspringen.
    //
    // Ohne diese Sperre war die Suite in jeder Umgebung ohne Postgres GRÜN —
    // inklusive CI, falls der Service-Container mal nicht hochkommt. Genau
    // die Tests, die am meisten absichern, hätten dann stillschweigend nichts
    // geprüft. Lieber ein lauter Fehlschlag.
    if (process.env.REQUIRE_DB === '1') {
      throw new Error(`REQUIRE_DB=1, aber die Test-Datenbank ist nicht erreichbar.`);
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
  app.use('/api/sets',     _req('routes/sets.js'));
  app.use('/api/parts',    _req('routes/parts.js'));
  app.use('/api/finance',  _req('routes/finance.js'));
  app.use('/api/settings', _req('routes/settings.js'));
  app.use('/api/minifigs', _req('routes/minifigs.js'));
  // _req() statt require(ROOT/...): Die kompilierten Dateien liegen seit
  // hardened-59 unter dist/, nicht mehr neben den .ts-Quellen. Diese eine
  // Zeile lud noch aus dem Quellordner und warf MODULE_NOT_FOUND — bemerkt
  // hat es niemand, weil der ganze Test ohne Postgres übersprungen wird.
  app.use('/api/v1',       _req('routes/api_v1/index.js'));

  const srv = app.listen(0);
  const base = `http://localhost:${srv.address().port}`;
  const get = async (p, headers = {}) => {
    const r = await fetch(base + p, { headers });
    return { status: r.status, body: await r.json().catch(() => null) };
  };

  for (const [name, webPath, v1Path] of PAIRS) {
    await t.test(`Parität: ${name}`, async () => {
      const [web, v1] = await Promise.all([get(webPath), get(v1Path)]);
      assert.equal(web.status, 200, `${webPath} -> ${web.status}: ${JSON.stringify(web.body)}`);
      assert.equal(v1.status, 200, `${v1Path} -> ${v1.status}: ${JSON.stringify(v1.body)}`);
      assert.deepEqual(core(v1.body), core(web.body),
        `Inhalt weicht ab zwischen ${webPath} und ${v1Path}`);
    });
  }

  // ── Zusammengelegte Routen: EINE Adresse, BEIDE Ausweise (Nachtrag 70) ────
  //
  // Die Erfassungs-Routen standen bis hierher doppelt — je einmal für Sitzung
  // und Token — und wurden oben paarweise gegeneinander geprüft. Genau diese
  // Doppelung war die Fehlerquelle: Sechs der letzten Meldungen kamen daher,
  // zuletzt zwei verschiedene Marktpreise für denselben Vorgang.
  //
  // Jetzt gibt es nur noch eine Adresse. Die Frage „verhalten sich beide
  // Clients gleich?" wird dadurch nicht hinfällig, sondern schärfer: Dieselbe
  // Route muss mit BEIDEN Ausweisen erreichbar sein und dasselbe liefern.
  // Genau das prüft dieser Block — und er würde rot, wenn jemand die Route
  // versehentlich an eine der beiden Auth-Arten bindet.
  for (const [name, pfad] of [
    ['Set-Erfassungen',     '/api/v1/sets/75192-1/acquisitions'],
    ['Teil-Erfassungen',    '/api/v1/parts/3020/0/acquisitions'],
    ['Minifig-Erfassungen', '/api/v1/minifigs/sw0001/acquisitions'],
    // Nachtrag 72: Minifiguren-Liste und manuelle Minifiguren sind ebenfalls
    // zusammengelegt — vorher standen sie oben als PAAR, jetzt gehören sie
    // hierher, wo „eine Route, beide Ausweise" geprüft wird.
    ['Minifiguren-Liste',   '/api/v1/minifigs'],
    ['Manuelle Minifiguren', '/api/v1/minifigs/manual'],
    // Nachtrag 74: dieselbe Umstellung für die Sets.
    ['Sets-Liste', '/api/v1/sets'],
    ['Set-Detail', '/api/v1/sets/75192-1'],
    // Nachtrag 73: dieselbe Umstellung für die Teile.
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
    // GET /api/settings ist NICHT zusammengelegt worden, und das mit Absicht:
    // Es trägt die globalen Schlüssel und die Admin-Felder, die kuratierte
    // Sicht der App weder braucht noch bekommen soll. Zwei verschiedene
    // Antworten, nicht zwei Fassungen derselben — geprüft wird deshalb, dass
    // die GEMEINSAMEN Werte übereinstimmen.
    const web = (await get('/api/settings/')).body;
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
    // ── Was hier vorher stand, und warum es weg ist ─────────────────────────
    //
    // Diese Prüfung hiess „Bewertung liefert rate_limit" und begründete sich
    // mit: „Die Webapp zeigt daraus den API-Verbrauch an." Das stimmte nicht.
    // Nachgemessen über beide Clients in dieser Ablage: Den API-Verbrauch
    // zeigen Einstellungsseite und Android aus `rate_limits` (PLURAL) von
    // /v1/admin/cache-stats — den Singular aus der Bewertung las niemand.
    // Auch die zweite Behauptung im Quelltext („wie in /api/finance/valuation,
    // Parität") war falsch: Dort gab es das Feld gar nicht.
    //
    // Gekostet hat es drei Datenbankabfragen JE AUFRUF (gemessen), bei jedem
    // Öffnen des Finanzreiters und nach jedem Erfassen. Das Feld ist raus;
    // scripts/check-antwortfelder.js hält es künftig draussen.
    //
    // Die eigentliche Aussage dieser Prüfung — Sitzung und Token bekommen
    // DASSELBE — bleibt, jetzt an der ganzen Antwortform statt an einem Feld.
    // Sie ist damit sogar breiter als vorher.
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
    // liefert überhaupt Punkte, und zwar je Zustand getrennt (seit
    // hardened-89 gibt es kein Feld `history` mehr — die frühere Fassung las
    // genau das und lief ins Leere).
    const b = (await get('/api/v1/sets/75192-1/price-history')).body;
    const pts = h => (h || []).filter(x => !x.is_purchase_price);
    assert.equal(b.success, true);
    assert.ok(pts(b.history_new).length + pts(b.history_used).length >= 2,
      'kein Verlauf geliefert');
    assert.ok(b.chart && Array.isArray(b.chart.values), 'chart fehlt');
  });

  await t.test('Preisverlauf Teil und Minifigur: gleiche Form wie beim Set', async () => {
    // Alle drei Arten teilen sich utils/priceHistory.ts. Geprüft wird deshalb,
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
    // Nachtrag 74: Es gibt nur noch EINE Schreibroute. Geprüft wird deshalb,
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
    // Zusammengelegt (Nachtrag 70): Es gibt nur noch EINE Schreibroute. Geprüft
    // wird deshalb, dass sie über BEIDE Ausweise dieselbe Wirkung hat — mit
    // Sitzung am einen Set, mit Token am anderen, danach müssen beide Sets
    // denselben Stand zeigen. Das ist die Aussage, die nach dem Umbau zählt:
    // nicht „zwei Routen sind sich einig", sondern „eine Route behandelt beide
    // Clients gleich".
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
    // Ebenfalls eine Route, beide Ausweise (Nachtrag 74).
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

  await t.test('ohne Auth: beide Familien lehnen ab', async () => {
    const web = await get('/api/sets/', { 'x-no-session': '1' });
    const v1 = await get('/api/v1/sets', { 'x-no-session': '1' });
    assert.equal(web.status, 401);
    assert.equal(v1.status, 401);
  });

  srv.close();
  await db.pool.end();
});
