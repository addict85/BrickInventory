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
const { openUi, switchTab, waitFor } = require('./helpers/ui');

const EVIL = '03:00"><img id="eingeschleust" src="x">';

test('the schedule inserts server values escaped', async () => {
  const o = await openUi({
    '/v2/admin/job-status': { success: true, job: { running: false } },
    '/v2/admin/job-queue': {
      success: true,
      jobs: [],
      summary: [],
      job_process: { running: true },
      image_demand: 0,
      pauses: [],
    },
    '/v2/admin/jobs': {
      success: true,
      jobs: { priceJob: { status: 'idle', progress: 0, total: 0 }, imgDl: { status: 'idle', progress: 0, total: 0 } },
      schedules: { priceJob: { type: 'daily', time: EVIL }, imgDl: { type: 'interval', minutes: 15 } },
      db: { csvCache: {}, blMapping: {} },
    },
  });
  try {
    await switchTab(o.w, 'monitor');
    assert.ok(
      await waitFor(() => o.d.querySelectorAll('#monitor-content .mon-plan').length === 2),
      'Hintergrundarbeiten',
    );
    assert.equal(o.d.getElementById('eingeschleust'), null, 'background jobs: a value became markup');
    assert.ok(o.d.querySelector('#monitor-content .mon-plan').textContent.includes(EVIL));
    await switchTab(o.w, 'settings');
    assert.ok(
      await waitFor(() => o.d.querySelectorAll('#settings-schedules .job-sched-input').length === 2),
      'settings',
    );
    assert.equal(o.d.getElementById('eingeschleust'), null, 'settings: a value became markup');
    assert.equal(o.d.querySelector('.mon-minutes').value, '15');
    assert.equal(o.d.querySelector('.mon-time').value, EVIL, 'the value did not arrive unchanged in the field');
    assert.equal(o.d.querySelector('.mon-time').dataset.arg, 'priceJob');
  } finally {
    o.w.close();
  }
});
