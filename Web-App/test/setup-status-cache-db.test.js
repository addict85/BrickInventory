/**
 * The public setup state is throttled and remembered briefly:
 * it costs around ten queries per call (decryption, account count).
 *
 * Counter-checks (measured on 08.11.2026):
 *   A  cache removed from setupStatus()
 *      → red: “within the window only the first call computes”
 *   B  both responses remembered under the same key (verwalter ignored)
 *      → red: “administrator and public response are separate”
 *   C  ipThrottle removed from routes/api_v1/setup.ts
 *      → red: “the address is throttled”
 *   D  onGlobalChange(...) removed (14.11.2026: k.einstellungen.onGlobalChange in the compartment)
 *      → red: “a written value applies immediately”
 *   E  the branch `if (erledigt) return …` removed
 *      → red: “after completion no key is read”
 *   F  (15.11.2026) in processEvent() verbinde() without s.listen(…) → red: “a value from
 *      another process …” (no LISTEN); with listen, but foreign ones discarded like the own echo
 *      → red: the same check („blieb beim alten Wert“)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { bis } = require('./helpers/time');
const db = testData();

after(() => db.pool.end().catch(() => {}));

test('setup state: remembered, separated by administrator, throttled', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { migrieren: false }))) return;

  const schluessel = ['einrichtung_erledigt', 'rebrickable_api_key'];
  const vorher = await db.all('SELECT key, value FROM global_settings WHERE key = ANY($1)', [schluessel]);
  await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [schluessel]);
  const counterRoute = () => db.run("DELETE FROM rate_limit_attempts WHERE key LIKE 'einrichtung-stand|%'");
  await counterRoute();
  t.after(async () => {
    await counterRoute();
    await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [schluessel]);
    for (const z of vorher) {
      await db.run(
        `INSERT INTO global_settings (key, value) VALUES ($1, $2)
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [z.key, z.value],
      );
    }
  });

  const einstellungen = _req('src/settings/settings.js');
  const stand = _req('src/profile/setupStatus.js');
  // On the pool instead of on the repository: imports are bound, a replaced export would never arrive.
  const gelesen = [];
  // In the pools of the app (runtime, system and web system role), not in the access of the test data.
  const zugang = require('./helpers/sources').testAccess();
  const pools = [...new Set([zugang.pool, zugang.systemPool, zugang.systemWebPool])];
  const echt = pools.map(p => p.query);
  for (const [i, p] of pools.entries())
    p.query = (sql, params) => {
      if (/FROM global_settings/i.test(String(sql))) gelesen.push(params?.[0]);
      return echt[i].call(p, sql, params);
    };
  t.after(() => {
    for (const [i, p] of pools.entries()) p.query = echt[i];
  });

  await t.test('within the window only the first call computes', async () => {
    stand.forgetSetupStatus();
    gelesen.length = 0;
    await stand.setupStatus();
    const erster = gelesen.length;
    assert.ok(erster >= 5, `der Zähler sieht nichts (${erster}) — die Gegenprobe bewiese nichts`);
    await Promise.all([stand.setupStatus(), stand.setupStatus()]);
    assert.equal(gelesen.length, erster, 'weitere Aufrufe im Fenster dürfen nichts lesen');
  });

  await t.test('a written value applies immediately', async () => {
    stand.forgetSetupStatus();
    assert.equal((await stand.setupStatus()).konfiguriert, false);
    await einstellungen.setGlobalSetting('rebrickable_api_key', 'probe');
    assert.equal((await stand.setupStatus()).konfiguriert, true);
  });

  await t.test('a value from another process clears the state here (NOTIFY)', async () => {
    await db.run("DELETE FROM global_settings WHERE key = 'rebrickable_api_key'");
    const weg = require('./helpers/sources').testServices().settings.listenForGlobalChanges();
    t.after(async () => {
      weg();
      await zugang.notification.close();
    });
    assert.ok(await bis(() => zugang.notification.listensTo('globale_einstellung')), 'kein LISTEN');
    stand.forgetSetupStatus();
    assert.equal((await stand.setupStatus()).konfiguriert, false);
    // A second set of services with its own compartments writes like another process.
    const anderer = _req('startup/wiring.js').buildServices(zugang);
    await anderer.settings.setGlobalValue('rebrickable_api_key', 'probe2');
    assert.ok(
      await bis(async () => (await stand.setupStatus()).konfiguriert, 3000),
      'der Stand hier blieb beim alten Wert, bis seine Frist ablief',
    );
  });

  await t.test('administrator and public response are separate', async () => {
    stand.forgetSetupStatus();
    const verwalter = await stand.setupStatus({ isAdmin: true });
    const offen = await stand.setupStatus({ isAdmin: false });
    assert.equal(offen.basis_url, null, 'die öffentliche Antwort darf die Basis-URL nicht tragen');
    assert.notEqual(verwalter, offen);
    const k = _req('src/infra/config.js').konfig();
    assert.equal(verwalter.basis_url, k.appBaseUrl);
  });

  await t.test('after completion no key is read', async () => {
    await einstellungen.setGlobalSetting('einrichtung_erledigt', '1');
    stand.forgetSetupStatus();
    gelesen.length = 0;
    const d = await stand.setupStatus();
    assert.equal(d.erledigt, true);
    assert.deepEqual(d.schritte, []);
    assert.deepEqual(
      gelesen.filter(k => k !== 'einrichtung_erledigt'),
      [],
      'es wurde mehr gelesen als der Abschluss',
    );
    await db.run("DELETE FROM global_settings WHERE key = 'einrichtung_erledigt'");
    stand.forgetSetupStatus();
  });

  await t.test('the address is throttled', async () => {
    const srv = testServer(_req, { sitzung: {}, t });
    let letzter = 0;
    for (let i = 0; i < 125 && letzter !== 429; i++) {
      letzter = (await fetch(srv.base + '/api/v1/einrichtung/stand')).status;
    }
    assert.equal(letzter, 429, 'auch nach 125 Aufrufen antwortet die offene Seite noch');
  });
});
