/**
 * Der öffentliche Einrichtungsstand ist gebremst und wird kurz gemerkt:
 * Er kostet je Aufruf rund zehn Abfragen (Entschlüsselung, Kontenzählung).
 *
 * Gegenproben (am 08.11.2026 gemessen):
 *   A  Zwischenspeicher aus einrichtungStand() entfernt
 *      → rot: „innerhalb des Fensters rechnet nur der erste Aufruf“
 *   B  beide Antworten unter demselben Schlüssel gemerkt (verwalter ignoriert)
 *      → rot: „Verwalter- und öffentliche Antwort sind getrennt“
 *   C  ipThrottle aus routes/api_v1/einrichtung.ts entfernt
 *      → rot: „die Adresse wird gebremst“
 *   D  beiGlobalerAenderung(...) entfernt
 *      → rot: „ein geschriebener Wert gilt sofort“
 *   E  der Zweig `if (erledigt) return …` entfernt
 *      → rot: „nach Abschluss wird kein Schlüssel gelesen“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testDaten();

after(() => db.pool.end().catch(() => {}));

test('Einrichtungsstand: gemerkt, getrennt nach Verwalter, gebremst', { concurrency: 1 }, async t => {
  if (!(await datenOderSkip(t, _req, { migrieren: false }))) return;

  const schluessel = ['einrichtung_erledigt', 'rebrickable_api_key'];
  const vorher = await db.all('SELECT key, value FROM global_settings WHERE key = ANY($1)', [schluessel]);
  await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [schluessel]);
  const zaehlerWeg = () => db.run("DELETE FROM rate_limit_attempts WHERE key LIKE 'einrichtung-stand|%'");
  await zaehlerWeg();
  t.after(async () => {
    await zaehlerWeg();
    await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [schluessel]);
    for (const z of vorher) {
      await db.run(
        `INSERT INTO global_settings (key, value) VALUES ($1, $2)
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [z.key, z.value],
      );
    }
  });

  const einstellungen = _req('src/einstellungen/settings.js');
  const stand = _req('src/konto/einrichtungStand.js');
  // Am Pool statt am Repository: Importe sind gebunden, ein ersetzter Export käme nie an.
  const gelesen = [];
  // In den Pools der App (Laufzeit- und Systemrolle), nicht im Zugang der Testdaten.
  const zugang = require('./helpers/sources').testZugang();
  const pools = [...new Set([zugang.pool, zugang.systemPool])];
  const echt = pools.map(p => p.query);
  for (const [i, p] of pools.entries())
    p.query = (sql, params) => {
      if (/FROM global_settings/i.test(String(sql))) gelesen.push(params?.[0]);
      return echt[i].call(p, sql, params);
    };
  t.after(() => {
    for (const [i, p] of pools.entries()) p.query = echt[i];
  });

  await t.test('innerhalb des Fensters rechnet nur der erste Aufruf', async () => {
    stand.einrichtungStandVergessen();
    gelesen.length = 0;
    await stand.einrichtungStand();
    const erster = gelesen.length;
    assert.ok(erster >= 5, `der Zähler sieht nichts (${erster}) — die Gegenprobe bewiese nichts`);
    await Promise.all([stand.einrichtungStand(), stand.einrichtungStand()]);
    assert.equal(gelesen.length, erster, 'weitere Aufrufe im Fenster dürfen nichts lesen');
  });

  await t.test('ein geschriebener Wert gilt sofort', async () => {
    stand.einrichtungStandVergessen();
    assert.equal((await stand.einrichtungStand()).konfiguriert, false);
    await einstellungen.setGlobalSetting('rebrickable_api_key', 'probe');
    assert.equal((await stand.einrichtungStand()).konfiguriert, true);
  });

  await t.test('Verwalter- und öffentliche Antwort sind getrennt', async () => {
    stand.einrichtungStandVergessen();
    const verwalter = await stand.einrichtungStand({ verwalter: true });
    const offen = await stand.einrichtungStand({ verwalter: false });
    assert.equal(offen.basis_url, null, 'die öffentliche Antwort darf die Basis-URL nicht tragen');
    assert.notEqual(verwalter, offen);
    const k = _req('src/infra/konfig.js').konfig();
    assert.equal(verwalter.basis_url, k.appBaseUrl);
  });

  await t.test('nach Abschluss wird kein Schlüssel gelesen', async () => {
    await einstellungen.setGlobalSetting('einrichtung_erledigt', '1');
    stand.einrichtungStandVergessen();
    gelesen.length = 0;
    const d = await stand.einrichtungStand();
    assert.equal(d.erledigt, true);
    assert.deepEqual(d.schritte, []);
    assert.deepEqual(
      gelesen.filter(k => k !== 'einrichtung_erledigt'),
      [],
      'es wurde mehr gelesen als der Abschluss',
    );
    await db.run("DELETE FROM global_settings WHERE key = 'einrichtung_erledigt'");
    stand.einrichtungStandVergessen();
  });

  await t.test('die Adresse wird gebremst', async () => {
    const srv = testServer(_req, { sitzung: {}, routen: { '/api/v1': 'routes/api_v1/einrichtung.js' }, t });
    let letzter = 0;
    for (let i = 0; i < 125 && letzter !== 429; i++) {
      letzter = (await fetch(srv.base + '/api/v1/einrichtung/stand')).status;
    }
    assert.equal(letzter, 429, 'auch nach 125 Aufrufen antwortet die offene Seite noch');
  });
});
