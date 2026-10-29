/**
 * Jede GET-Route der App gegen ihr Kotlin-Modell — gelesen aus dem
 * App-Quelltext (scripts/kotlin-vertrag.js), nicht abgeschrieben.
 *
 * Geprüft wird strenger als die App: null in einem nicht-nullbaren Feld
 * zählt, auch wenn coerceInputValues es zur Laufzeit auf den Standardwert
 * setzt. Genau dort verbog sich der Vertrag bisher still.
 *
 * Der Bestand ist so angelegt, dass die Listen nicht leer sind: ein Set mit
 * Teilen und Figur, ein manuelles Teil, eine manuelle Figur, Merkliste,
 * Lagerort, Gutschein, Preisalarm, Preise im Cache.
 *
 * Gefunden beim ersten Lauf: used_count (/sets), quantity und total_quantity
 * (/minifigs), unique_parts und total_quantity (/parts/categories) kamen als
 * Zeichenkette — COUNT und SUM liefern bigint, pg gibt das als Text heraus.
 * Die App las sie nur dank isLenient.
 *
 * Gegenproben (am 27.10. gemessen):
 *   A  in utils/handlers/sets.ts das ::int an used_count entfernt → rot:
 *      „passt zum Kotlin-Modell" nennt $.sets[0].used_count
 *   B  in SetItem (SetModels.kt) ein Pflichtfeld `gibtEsNicht: String`
 *      ergänzt → rot: „fehlt (SetItem, Pflichtfeld)"
 *   C  MIN_GEPRUEFT auf 58 gesetzt → rot: „so viele Routen geprüft"
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, '..', 'Android-App', 'app', 'src', 'main', 'java', 'ch', 'brickinventoryapp');
const _req = require('./helpers/sources').buildAndRequire();
const { routerEinhaengungen } = require('./helpers/sources');
const { haeltSet, haeltTeil, haeltFigur } = require('./helpers/bestand');
const { kotlinModelle, apiRouten, pruefe } = require(path.join(ROOT, 'scripts', 'kotlin-vertrag.js'));
const db = _req('db/database.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));

const NAME = `kvertrag_${process.pid}`;
const SET = '99074-1', TEIL = '3001kv', FARBE = 5, FIGUR = 'kv0001';

/** Routen, die hier nicht laufen können — mit Grund. */
const AUSGELASSEN = new Map([
  ['/api/v1/sets/info/{setNumber}',       'fragt Rebrickable/Brickset im Netz'],
  ['/api/v1/sets/barcode/{barcode}',      'fragt die Barcode-Dienste im Netz'],
  ['/api/v1/wanted/{setNumber}/preise',   'fragt BrickLink im Netz'],
  ['/api/v1/startup-status',              'steht direkt in server.ts, nicht in einem Router'],
  ['/api/v1/sets/partslist-pdf/status/{jobId}', 'braucht einen laufenden PDF-Auftrag'],
  ['/api/v1/admin/logs',                  'liest app_logs; der Inhalt hängt an fremden Läufen'],
]);
/** Listen, die hier leer bleiben dürfen — mit Grund. */
const LEER_ERLAUBT = new Map([
  ['/api/v1/admin/brickset-queue .entries', 'füllt nur ein gescheiterter Brickset-Abruf'],
]);
/** Zusätzliche Abfrageparameter, ohne die eine Route nur Leeres liefert. */
const ZUSATZ = new Map([
  ['/api/v1/alerts/pending', 'since=2000-01-01T00:00:00Z'],
]);
/** Mindestens so viele Routen werden wirklich geprüft — damit die Zahl nicht still sinkt. */
const MIN_GEPRUEFT = 57;

test('die Antworten passen zu den Kotlin-Modellen', { concurrency: 1, timeout: 120_000 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); } finally { client.release(); }

  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, email, password_hash, is_admin, is_active, email_verified)
                             VALUES ($1, $2, 'x', 1, 1, 1) RETURNING id`, [NAME, `${NAME}@example.org`])).id;
  await db.run('DELETE FROM users WHERE username = $1', [`${NAME}_sub`]);
  const sub = (await db.get(`INSERT INTO users (username, password_hash, is_active, email_verified)
                             VALUES ($1, 'x', 1, 1) RETURNING id`, [`${NAME}_sub`])).id;
  // Ein Elternkonto und ein getrenntes Konto, damit `parents` und
  // `former_links` der Haushaltsantwort nicht leer ankommen.
  const nebenkonto = async (zusatz) => {
    await db.run('DELETE FROM users WHERE username = $1', [`${NAME}_${zusatz}`]);
    return (await db.get(`INSERT INTO users (username, password_hash, is_active, email_verified)
                          VALUES ($1, 'x', 1, 1) RETURNING id`, [`${NAME}_${zusatz}`])).id;
  };
  const oben = await nebenkonto('oben'), getrennt = await nebenkonto('getrennt');
  // Globale Kataloge: nur entfernen, was dieser Test selbst angelegt hat.
  const aufraeumen = [];
  const katalog = async (sql, werte, weg, wegWerte) => {
    if ((await db.run(sql + ' ON CONFLICT DO NOTHING', werte)).changes) aufraeumen.push([weg, wegWerte]);
  };
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[uid, sub, oben, getrennt]]).catch(() => {});
    for (const tab of ['set_parts_catalog', 'set_minifigs_catalog', 'price_cache', 'price_history', 'set_catalog'])
      await db.run(`DELETE FROM ${tab} WHERE set_number = $1`, [SET]).catch(() => {});
    for (const tab of ['part_price_cache', 'part_price_history', 'part_catalog', 'part_color_catalog'])
      await db.run(`DELETE FROM ${tab} WHERE part_number = $1`, [TEIL]).catch(() => {});
    for (const tab of ['minifig_price_cache', 'minifig_price_history', 'minifigs_catalog'])
      await db.run(`DELETE FROM ${tab} WHERE fig_number = $1`, [FIGUR]).catch(() => {});
    for (const [sql, werte] of aufraeumen) await db.run(sql, werte).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  // ── Bestand ────────────────────────────────────────────────────────────
  await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'currency', 'EUR')
                ON CONFLICT (user_id, key) DO UPDATE SET value = 'EUR'`, [uid]).catch(() => {});
  await db.run(`INSERT INTO set_catalog (set_number, name, year, theme, pieces, minifigs)
                VALUES ($1, 'Vertragsprobe', 2024, 'Test', 100, 1) ON CONFLICT (set_number) DO NOTHING`, [SET]);
  await db.run(`INSERT INTO set_teile (set_number, part_number, color_id, quantity)
                VALUES ($1, $2, $3, 4) ON CONFLICT DO NOTHING`, [SET, TEIL, FARBE]);
  await db.run(`INSERT INTO part_catalog (part_number, part_name) VALUES ($1, 'Stein 2x2') ON CONFLICT DO NOTHING`, [TEIL]);
  await db.run(`INSERT INTO part_color_catalog (part_number, color_id, color_name)
                VALUES ($1, $2, 'Rot') ON CONFLICT DO NOTHING`, [TEIL, FARBE]);
  await db.run(`INSERT INTO set_minifigs_catalog (set_number, fig_number, fig_name, quantity)
                VALUES ($1, $2, 'Probefigur', 1) ON CONFLICT DO NOTHING`, [SET, FIGUR]);
  await db.run(`INSERT INTO minifigs_catalog (fig_number, fig_name) VALUES ($1, 'Probefigur') ON CONFLICT DO NOTHING`, [FIGUR]);
  for (const zustand of ['N', 'U']) {
    await db.run(`INSERT INTO price_cache (set_number, condition, currency_code, min_price, avg_price, max_price, qty_avg_price, total_quantity)
                  VALUES ($1, $2, 'EUR', 40, 50, 60, 52, 7)`, [SET, zustand]);
    await db.run(`INSERT INTO price_history (set_number, condition, currency_code, avg_price, recorded_at)
                  VALUES ($1, $2, 'EUR', 48, NOW() - INTERVAL '2 days')`, [SET, zustand]);
  }
  await katalog(`INSERT INTO rb_themes (id, name) VALUES (999074, 'Vertragsthema')`, [],
                'DELETE FROM rb_themes WHERE id = 999074', []);
  await katalog(`INSERT INTO rb_sets (set_num, name, year, theme_id, num_parts) VALUES ($1, 'Vertragsprobe', 2024, 999074, 100)`,
                [SET], 'DELETE FROM rb_sets WHERE set_num = $1', [SET]);
  await katalog(`INSERT INTO rb_colors (id, name, rgb, is_trans) VALUES ($1, 'Rot', 'C91A09', 'f')`, [FARBE],
                'DELETE FROM rb_colors WHERE id = $1', [FARBE]);
  await katalog(`INSERT INTO rb_inventories (id, set_num, version) VALUES (999074, $1, 1)`, [SET],
                'DELETE FROM rb_inventories WHERE id = 999074', []);
  await katalog(`INSERT INTO rb_inventory_parts (id, inventory_id, part_num, color_id, quantity, is_spare)
                 VALUES (999074, 999074, $1, $2, 4, 'f')`, [TEIL, FARBE],
                'DELETE FROM rb_inventory_parts WHERE id = 999074', []);
  await db.run(`INSERT INTO part_catalog (part_number, part_name, category_name) VALUES ($1, 'Stein 2x2', 'Steine')
                ON CONFLICT DO NOTHING`, [TEIL]);
  await db.run(`INSERT INTO part_color_catalog (part_number, color_id, color_name, color_hex) VALUES ($1, $2, 'Rot', 'C91A09')
                ON CONFLICT DO NOTHING`, [TEIL, FARBE]);
  for (const zustand of ['N', 'U']) {
    await db.run(`INSERT INTO part_price_cache (part_number, color_id, condition, currency_code, avg_price, qty_avg_price)
                  VALUES ($1, $2, $3, 'EUR', 0.2, 0.18)`, [TEIL, FARBE, zustand]);
    await db.run(`INSERT INTO part_price_history (part_number, color_id, condition, currency_code, avg_price, recorded_at)
                  VALUES ($1, $2, $3, 'EUR', 0.19, NOW() - INTERVAL '2 days')`, [TEIL, FARBE, zustand]);
    await db.run(`INSERT INTO minifig_price_cache (fig_number, condition, currency_code, avg_price, qty_avg_price)
                  VALUES ($1, $2, 'EUR', 4.5, 4.2)`, [FIGUR, zustand]);
    await db.run(`INSERT INTO minifig_price_history (fig_number, condition, currency_code, avg_price, recorded_at)
                  VALUES ($1, $2, 'EUR', 4.4, NOW() - INTERVAL '2 days')`, [FIGUR, zustand]);
  }
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [uid, sub]);
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [oben, uid]);
  await db.run('INSERT INTO household_former_links (main_user_id, sub_user_id, via_user_id) VALUES ($1, $2, $3)',
    [uid, getrennt, sub]);
  await _req('utils/auth.js').createToken(uid, 'Vertragsprobe');
  await haeltSet(db, uid, SET, 2, { preis: 49.9 });
  await haeltTeil(db, uid, TEIL, { setNumber: SET, colorId: FARBE, menge: 4 });
  await haeltTeil(db, uid, TEIL, { colorId: FARBE, menge: 3 });
  await haeltFigur(db, uid, FIGUR, { setNumber: SET, menge: 1 });
  await haeltFigur(db, uid, FIGUR, { menge: 1 });
  await db.run(`INSERT INTO wanted (user_id, set_number) VALUES ($1, $2)`, [uid, SET]);
  const ort = (await db.get(`INSERT INTO storage_locations (user_id, name) VALUES ($1, 'Regal A') RETURNING id`, [uid])).id;
  await db.run('UPDATE sets SET storage_id = $2 WHERE user_id = $1 AND set_number = $3', [uid, ort, SET]);
  await db.run(`INSERT INTO vouchers (user_id, number, amount, currency) VALUES ($1, 'G-123', 25, 'CHF')`, [uid]);
  await db.run(`INSERT INTO price_alerts (user_id, set_number, condition, richtung, schwelle, currency_code, ausgeloest, zuletzt_am, zuletzt_preis)
                VALUES ($1, $2, 'N', 'unter', 55, 'EUR', true, NOW(), 50)`, [uid, SET]);

  // ── Server wie in server.ts ────────────────────────────────────────────
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { userId: uid, username: NAME, isAdmin: true };
    req.apiUser = { user_id: uid, username: NAME, is_admin: 1 };
    next();
  });
  app.use('/api/v1', _req('routes/api_v1/index.js'));
  for (const r of routerEinhaengungen()) app.use(r.mount, _req(r.name.startsWith('api_v1') ? `routes/${r.name}.js` : `routes/${r.name}.js`));
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  const basis = `http://127.0.0.1:${srv.address().port}`;

  const modelle = kotlinModelle(APP);
  const routen = apiRouten(path.join(APP, 'data', 'api', 'BrickApiService.kt'));
  const werte = { setNumber: SET, partNumber: TEIL, colorId: String(FARBE), figNumber: FIGUR };

  const abweichungen = [], leer = [], status = [];
  let geprueft = 0;
  for (const r of routen) {
    if (!r.typ || !modelle.has(r.typ) || AUSGELASSEN.has(r.pfad)) continue;
    const pfad = r.pfad.replace(/\{(\w+)\}/g, (_, n) => encodeURIComponent(werte[n] ?? `<${n}>`));
    if (pfad.includes('%3C')) { status.push(`${r.pfad}: kein Wert für einen Platzhalter`); continue; }
    const anfrage = [...r.anfrage.filter(q => q.pflicht).map(q => `${q.name}=60`), ZUSATZ.get(r.pfad)]
      .filter(Boolean).join('&');
    const antwort = await fetch(basis + pfad + (anfrage ? '?' + anfrage : ''));
    const text = await antwort.text();
    let json; try { json = JSON.parse(text); } catch { status.push(`${r.pfad}: ${antwort.status} kein JSON`); continue; }
    if (antwort.status !== 200) { status.push(`${r.pfad}: ${antwort.status} ${text.slice(0, 120)}`); continue; }
    geprueft++;
    abweichungen.push(...pruefe(json, { art: 'klasse', name: r.typ, nullbar: false }, modelle, r.pfad));
    for (const [k, v] of Object.entries(json)) if (Array.isArray(v) && v.length === 0) leer.push(`${r.pfad} .${k}`);
  }

  await t.test('jede Route antwortet', () => assert.deepEqual(status, []));
  await t.test('so viele Routen geprüft', () =>
    assert.ok(geprueft >= MIN_GEPRUEFT, `nur ${geprueft} Routen geprüft, erwartet mindestens ${MIN_GEPRUEFT}`));
  await t.test('passt zum Kotlin-Modell', () => assert.deepEqual(abweichungen, []));
  await t.test('keine Liste ist unbemerkt leer', () =>
    assert.deepEqual(leer.filter(l => !LEER_ERLAUBT.has(l)), [], 'Eine leere Liste prüft kein einziges Feld'));
  t.diagnostic(`geprüft: ${geprueft}`);
});
