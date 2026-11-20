/**
 * Zwei Drosseln mit demselben Takt halten den Abstand auch untereinander —
 * so, wie zwei Prozesse es über die Tabelle api_cadence tun.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  in waitForSlot() den Aufruf von waitOnTick entfernt → rot: „zwei
 *      Drosseln teilen sich den Takt“
 *   B  im UPDATE von waitOnTick GREATEST(api_cadence.next_at, …) durch
 *      clock_timestamp() ersetzt → rot: derselbe Test
 *   (30.10.2026 mit der Prüfung „nicht vor k Takten“ erneut gemessen: A und B rot)
 *
 * Getrennte Instanzen stehen hier für getrennte Prozesse: Sie teilen nichts
 * ausser der Datenbank, genau wie ein Web-Worker und der Hintergrundprozess.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();

test('gemeinsamer Takt über die Datenbank', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  t.after(() => db.pool.end().catch(() => {}));

  const { RateLimiter } = _req('src/fremdquellen/rateLimiter.js');
  const API = `test-${process.pid}`;
  const GAP = 250;
  await db.run('DELETE FROM api_cadence WHERE api = $1', [API]);

  await t.test('zwei Drosseln teilen sich den Takt', async () => {
    // Die eigene Drossel lässt sofort durch (Fenster 0) — jeder Abstand, der
    // sich zeigt, kommt aus dem gemeinsamen Takt.
    const apiTakt = require('./helpers/sources').testContext('fremdquellen').apiTakt;
    const a = new RateLimiter(1, 0, { api: API, gapMs: GAP, apiTakt, disruptedUntil: 0 });
    const b = new RateLimiter(1, 0, { api: API, gapMs: GAP, apiTakt, disruptedUntil: 0 });
    const times = [];
    const start = Date.now();
    await Promise.all([a, b, a, b, a, b].map(d => d.waitForSlot().then(() => times.push(Date.now() - start))));
    times.sort((x, y) => x - y);
    // Der k-te Durchlass kommt nicht vor k Takten. Spätes Aufwachen unter Last
    // ist erlaubt; Abstände zwischen Aufwachzeiten wären es nicht, weil ein
    // verspäteter Teilnehmer den Abstand zum nächsten pünktlichen verkürzt.
    const zufrueh = times.filter((z, k) => z < k * GAP - 40);
    assert.deepEqual(zufrueh, [], `Durchlässe nach Start: ${times.join(', ')} ms`);
  });

  await db.run('DELETE FROM api_cadence WHERE api = $1', [API]);
});
