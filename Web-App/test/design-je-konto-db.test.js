/**
 * Design je Konto: Der Verwalter setzt die Vorgabe, jedes Konto darf sie
 * überschreiben — über den echten Router und die echte Datenbank.
 *
 *   - GET /api/v1/settings/theme liefert ohne Anmeldung die Vorgabe, mit
 *     Sitzung ODER Token (App) das Design des Kontos; `theme` bleibt der
 *     wirksame Wert, dazu `vorgabe` und `eigenes`.
 *   - POST /settings/user/theme setzt das eigene Design; leer löscht es, dann
 *     folgt das Konto wieder der Vorgabe (auch einem späteren Wechsel).
 *   - Ein unbekanntes Design wird abgewiesen.
 *   - /settings/raw und GET /api/v1/settings (App) nennen das wirksame Design.
 *   - Die ausgelieferte index.html trägt das Design des Kontos, ohne Konto
 *     die Vorgabe — auch für „noppe“ (vorher kannte sie nur classic/brick).
 *
 * Gegenproben (am 29.10.2026 gemessen):
 *   A  in designFuer `eigenes` immer null → rot: „Konto mit eigenem Design“
 *      (noppe statt werkbank) und „index.html“
 *   B  GET /theme wieder ohne resolveUserId → rot: „App mit Token“
 *   C  setzeEigenesDesign schreibt ungeprüft, auch '' → rot: „leer heisst
 *      Vorgabe“ (/settings/raw: app_theme ''), „unbekanntes Design abgewiesen“
 *   D  in indexHtml wieder ALLOWED = ['classic', 'brick'] → rot: „index.html“
 *      (classic statt noppe)
 *   E  (30.10.) GET /api/v1/settings wieder mit getGlobalSetting('app_theme')
 *      → rot: „App mit Token“ (noppe statt werkbank)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const _req = require('./helpers/sources').buildAndRequire();
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');

test('Design je Konto', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }

  const namen = [`design_a_${process.pid}`, `design_b_${process.pid}`];
  await db.run('DELETE FROM users WHERE username = ANY($1)', [namen]);
  const ids = [];
  for (const n of namen) ids.push((await db.get(`INSERT INTO users (username, password_hash, is_active) VALUES ($1, 'x', 1) RETURNING id`, [n])).id);
  const vorher = (await db.get(`SELECT value FROM global_settings WHERE key = 'app_theme'`))?.value ?? null;
  const { setGlobalSetting } = _req('src/konto/settings.js');
  await setGlobalSetting('app_theme', 'noppe');
  _req('src/konto/indexHtml.js').invalidateTheme();
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [ids]).catch(() => {});
    if (vorher === null) await db.run(`DELETE FROM global_settings WHERE key = 'app_theme'`);
    else await setGlobalSetting('app_theme', vorher);
    await db.pool.end().catch(() => {});
  });

  const sitzung = {};
  const { base } = testServer(_req, { sitzung, routen: { '/api/v1': 'routes/api_v1/index.js' }, t });
  const hole = async (pfad, o = {}) => (await fetch(base + '/api/v1/settings' + pfad, o)).json();
  const setze = (theme) => hole('/user/theme', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme }) });
  const als = (uid) => { if (uid) sitzung.userId = uid; else delete sitzung.userId; };

  await t.test('ohne Anmeldung: die Vorgabe', async () => {
    als(null);
    assert.deepEqual(await hole('/theme'), { success: true, theme: 'noppe', vorgabe: 'noppe', eigenes: null });
  });

  await t.test('Konto mit eigenem Design, das andere folgt der Vorgabe', async () => {
    als(ids[0]);
    const r = await setze('werkbank');
    assert.equal(r.success, true, JSON.stringify(r));
    assert.deepEqual(await hole('/theme'), { success: true, theme: 'werkbank', vorgabe: 'noppe', eigenes: 'werkbank' });
    assert.equal((await hole('/raw')).settings.app_theme, 'werkbank', '/settings/raw nennt nicht das Design des Kontos');
    als(ids[1]);
    assert.equal((await hole('/theme')).theme, 'noppe');
    assert.equal((await hole('/raw')).settings.app_theme, 'noppe');
  });

  await t.test('App mit Token: dasselbe Design wie im Browser', async () => {
    als(null);
    const token = await _req('src/konto/auth.js').createToken(ids[0], 'Prüfung', true);
    const mitToken = { headers: { Authorization: `Bearer ${token}` } };
    assert.equal((await hole('/theme', mitToken)).theme, 'werkbank');
    assert.equal((await hole('', mitToken)).settings?.app_theme, 'werkbank', 'GET /api/v1/settings nennt die Vorgabe');
  });

  await t.test('unbekanntes Design abgewiesen', async () => {
    als(ids[0]);
    const r = await setze('<b>');
    assert.equal(r.success, false);
    assert.equal((await hole('/theme')).theme, 'werkbank');
  });

  await t.test('index.html: Design des Kontos, ohne Konto die Vorgabe', async () => {
    const { renderIndexHtml } = _req('src/konto/indexHtml.js');
    const designVon = (html) => /<html[^>]*\sdata-theme="([^"]+)"/.exec(html)?.[1];
    assert.equal(designVon(await renderIndexHtml(ids[0])), 'werkbank');
    assert.equal(designVon(await renderIndexHtml(ids[1])), 'noppe');
    assert.equal(designVon(await renderIndexHtml()), 'noppe');
  });

  await t.test('leer heisst Vorgabe — auch nach einem Wechsel des Verwalters', async () => {
    als(ids[0]);
    assert.equal((await setze('')).success, true);
    await setGlobalSetting('app_theme', 'brick');
    assert.deepEqual(await hole('/theme'), { success: true, theme: 'brick', vorgabe: 'brick', eigenes: null });
    assert.equal((await hole('/raw')).settings.app_theme, 'brick');
  });
});
