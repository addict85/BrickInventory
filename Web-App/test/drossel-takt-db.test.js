/**
 * Zwei Drosseln mit demselben Takt halten den Abstand auch untereinander —
 * so, wie zwei Prozesse es über die Tabelle api_takt tun.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  in waitForSlot() den Aufruf von warteAufTakt entfernt → rot: „zwei
 *      Drosseln teilen sich den Takt“
 *   B  im UPDATE von warteAufTakt GREATEST(api_takt.naechster, …) durch
 *      clock_timestamp() ersetzt → rot: derselbe Test
 *
 * Getrennte Instanzen stehen hier für getrennte Prozesse: Sie teilen nichts
 * ausser der Datenbank, genau wie ein Web-Worker und der Hintergrundprozess.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

test('gemeinsamer Takt über die Datenbank', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }
  t.after(() => db.pool.end().catch(() => {}));

  const { RateLimiter } = _req('utils/rateLimiter.js');
  const API = `test-${process.pid}`;
  const ABSTAND = 250;
  await db.run('DELETE FROM api_takt WHERE api = $1', [API]);

  await t.test('zwei Drosseln teilen sich den Takt', async () => {
    // Die eigene Drossel lässt sofort durch (Fenster 0) — jeder Abstand, der
    // sich zeigt, kommt aus dem gemeinsamen Takt.
    const a = new RateLimiter(1, 0, { api: API, abstandMs: ABSTAND });
    const b = new RateLimiter(1, 0, { api: API, abstandMs: ABSTAND });
    const zeiten = [];
    await Promise.all([a, b, a, b, a, b].map(d => d.waitForSlot().then(() => zeiten.push(Date.now()))));
    zeiten.sort((x, y) => x - y);
    const abstaende = zeiten.slice(1).map((z, i) => z - zeiten[i]);
    // Etwas Spiel für Timer-Ungenauigkeit; ohne Takt lägen die Abstände bei 0.
    assert.ok(abstaende.every(d => d >= ABSTAND - 40),
      `Abstände zu klein: ${abstaende.join(', ')} ms`);
  });

  await db.run('DELETE FROM api_takt WHERE api = $1', [API]);
});
