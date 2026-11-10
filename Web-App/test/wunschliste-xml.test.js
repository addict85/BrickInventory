'use strict';
/**
 * Der Zeitplan im Monitor setzt die Werte des Servers maskiert ein — wie
 * data-arg in derselben Zeile. Echtes Bündel in jsdom, Verwalterkonto.
 * Die Maskierung der BrickLink-Wunschliste selbst läuft am Modul in
 * bricklink-wanted-xml.test.js.
 *
 * Gegenprobe (10.11.2026 gemessen, Bündel neu gebaut): in 01-monitor.js
 * schedInput `value="${sc.time}"` per ungeprueft() eingesetzt → rot (ein
 * fremdes <img> steht in der Tabelle, der Wert ist abgeschnitten).
 */
const test = require('node:test');
const assert = require('node:assert');
const { oeffneOberflaeche, reiter, warte } = require('./helpers/oberflaeche');

const BOESE = '03:00"><img id="eingeschleust" src="x">';

test('der Zeitplan im Monitor setzt Serverwerte maskiert ein', async () => {
  const o = await oeffneOberflaeche({
    '/v1/admin/job-status': { success: true, job: { running: false } },
    '/v1/admin/auftraege': { success: true, auftraege: [], zusammenfassung: [], job_prozess: { laeuft: true }, bildbedarf: 0, pausen: [] },
    '/v1/admin/jobs': { success: true,
      jobs: { priceJob: { status: 'idle', progress: 0, total: 0 }, imgDl: { status: 'idle', progress: 0, total: 0 } },
      schedules: { priceJob: { type: 'daily', time: BOESE }, imgDl: { type: 'interval', minutes: 15 } },
      db: { csvCache: {}, blMapping: {} } },
  });
  try {
    await reiter(o.w, 'monitor');
    assert.ok(await warte(() => o.d.querySelectorAll('.job-sched-input').length === 2), 'keine Zeitplanfelder');
    assert.equal(o.d.getElementById('eingeschleust'), null, 'ein Wert des Servers wurde zu Markup');
    assert.equal(o.d.querySelector('.mon-minuten').value, '15');
    assert.equal(o.d.querySelector('.mon-zeit').value, BOESE, 'der Wert kam nicht unverändert ins Feld');
    assert.equal(o.d.querySelector('.mon-zeit').dataset.arg, 'priceJob');
  } finally { o.w.close(); }
});
