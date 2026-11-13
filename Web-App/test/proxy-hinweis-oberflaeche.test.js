/**
 * Die Hintergrundarbeiten zeigen dem Verwalter den Proxy-Hinweis aus
 * GET /api/v1/admin/jobs (proxy-hinweis-verwalter-db.test.js), in seiner Sprache
 * und mit der Adresse; ohne Hinweis steht nichts da.
 *
 * Gegenprobe (13.11.2026 gemessen):
 *   A  in monitor.js die Zeile mit `d.proxy_hinweis` gestrichen → rot: „der
 *      Hinweis steht unter Hintergrundarbeiten“ (Zeitüberschreitung)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, reiter, warte } = require('./helpers/oberflaeche');

const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const jobs = proxy_hinweis => ({
  '/v1/admin/job-status': { success: true, job: { running: false } },
  '/v1/admin/jobs': {
    success: true,
    jobs: { csvImport: { status: 'done', label: 'CSV' } },
    schedules: {},
    db: { csvCache: {}, blMapping: {} },
    proxy_hinweis,
  },
  '/v1/admin/auftraege': {
    success: true,
    zusammenfassung: [],
    job_prozess: { laeuft: true },
    pausen: [],
    bildbedarf: 0,
    auftraege: [],
  },
});

test('der Hinweis steht unter Hintergrundarbeiten', async () => {
  const { w, d } = await oeffneOberflaeche(
    jobs({ art: 'eine_adresse', vars: { ip: '172.28.73.20', minuten: 61, anzahl: 301 } }),
  );
  try {
    await reiter(w, 'monitor');
    await warte(() => d.getElementById('mon-proxy-hinweis'));
    const t = text(d.getElementById('mon-proxy-hinweis'));
    assert.match(t, /Seit 61 Minuten kommen alle 301 Anfragen mit derselben Client-Adresse 172\.28\.73\.20/);
    assert.match(t, /VORGELAGERTER_PROXY/);
  } finally {
    w.close();
  }
});

test('ohne Hinweis steht nichts da', async () => {
  const { w, d } = await oeffneOberflaeche(jobs(null));
  try {
    await reiter(w, 'monitor');
    await warte(() => d.querySelector('#monitor-content table'));
    assert.equal(d.getElementById('mon-proxy-hinweis'), null);
  } finally {
    w.close();
  }
});
