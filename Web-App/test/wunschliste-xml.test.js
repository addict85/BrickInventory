/**
 * Der Zeitplan setzt die Werte des Servers maskiert ein: als Text unter
 * „Hintergrundarbeiten“, als Feld in den Einstellungen. Echtes Bündel in
 * jsdom, Verwalterkonto.
 * Die Maskierung der BrickLink-Wunschliste selbst läuft am Modul in
 * bricklink-wanted-xml.test.js.
 *
 * Gegenprobe (10.11.2026 gemessen, Bündel neu gebaut): in monitor.js
 * schedInput `value="${sc.time}"` per ungeprueft() eingesetzt → rot (ein
 * fremdes <img> steht in der Tabelle, der Wert ist abgeschnitten).
 * 12.11.2026 gemessen (Felder jetzt in den Einstellungen): dasselbe in
 * schedInput → rot „Einstellungen“; in schedText `${wann}` per ungeprueft()
 * → rot „Hintergrundarbeiten“.
 */
const test = require('node:test');
const assert = require('node:assert');
const { oeffneOberflaeche, reiter, warte } = require('./helpers/oberflaeche');

const BOESE = '03:00"><img id="eingeschleust" src="x">';

test('der Zeitplan setzt Serverwerte maskiert ein', async () => {
  const o = await oeffneOberflaeche({
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
