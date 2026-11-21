/**
 * The schedule inserts the server's values escaped: as text under
 * „Hintergrundarbeiten“, as a field in the settings. Real bundle in
 * jsdom, admin account.
 * Escaping of the BrickLink wish list itself is tested on the module in
 * bricklink-wanted-xml.test.js.
 *
 * Counter-check (measured 10.11.2026, bundle rebuilt): in monitor.js
 * schedInput `value="${sc.time}"` inserted via ungeprueft() → red (a
 * foreign <img> is in the table, the value is cut off).
 * Measured 12.11.2026 (fields now in the settings): the same in
 * schedInput → red „Einstellungen“; in schedText `${wann}` via ungeprueft()
 * → red „Hintergrundarbeiten“.
 */
const test = require('node:test');
const assert = require('node:assert');
const { openUi, reiter, warte } = require('./helpers/ui');

const BOESE = '03:00"><img id="eingeschleust" src="x">';

test('the schedule inserts server values escaped', async () => {
  const o = await openUi({
    '/v1/admin/job-status': { success: true, job: { running: false } },
    '/v1/admin/auftraege': {
      success: true,
      auftraege: [],
      zusammenfassung: [],
      job_prozess: { laeuft: true },
      bildbedarf: 0,
      pausen: [],
    },
    '/v1/admin/jobs': {
      success: true,
      jobs: { priceJob: { status: 'idle', progress: 0, total: 0 }, imgDl: { status: 'idle', progress: 0, total: 0 } },
      schedules: { priceJob: { type: 'daily', time: BOESE }, imgDl: { type: 'interval', minutes: 15 } },
      db: { csvCache: {}, blMapping: {} },
    },
  });
  try {
    await reiter(o.w, 'monitor');
    assert.ok(
      await warte(() => o.d.querySelectorAll('#monitor-content .mon-plan').length === 2),
      'Hintergrundarbeiten',
    );
    assert.equal(o.d.getElementById('eingeschleust'), null, 'Hintergrundarbeiten: ein Wert wurde zu Markup');
    assert.ok(o.d.querySelector('#monitor-content .mon-plan').textContent.includes(BOESE));
    await reiter(o.w, 'settings');
    assert.ok(
      await warte(() => o.d.querySelectorAll('#einst-zeitplaene .job-sched-input').length === 2),
      'Einstellungen',
    );
    assert.equal(o.d.getElementById('eingeschleust'), null, 'Einstellungen: ein Wert wurde zu Markup');
    assert.equal(o.d.querySelector('.mon-minuten').value, '15');
    assert.equal(o.d.querySelector('.mon-zeit').value, BOESE, 'der Wert kam nicht unverändert ins Feld');
    assert.equal(o.d.querySelector('.mon-zeit').dataset.arg, 'priceJob');
  } finally {
    o.w.close();
  }
});
