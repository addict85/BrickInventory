/**
 * The background jobs show the admin the proxy hint from
 * GET /api/v2/admin/jobs (proxy-hint-admin-db.test.js), in his language
 * and with the address; without a hint nothing stands there.
 *
 * Counter-check (measured 13.11.2026):
 *   A  the line with `d.proxy_hinweis` deleted in monitor.js → red: “the
 *      hint is under background jobs” (timeout)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, reiter, warte } = require('./helpers/ui');

const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const jobs = proxy_hint => ({
  '/v2/admin/job-status': { success: true, job: { running: false } },
  '/v2/admin/jobs': {
    success: true,
    jobs: { csvImport: { status: 'done', label: 'CSV' } },
    schedules: {},
    db: { csvCache: {}, blMapping: {} },
    proxy_hint,
  },
  '/v2/admin/job-queue': {
    success: true,
    summary: [],
    job_process: { running: true },
    pauses: [],
    image_demand: 0,
    jobs: [],
  },
});

test('the hint is under background jobs', async () => {
  const { w, d } = await openUi(
    jobs({ kind: 'single_address', vars: { ip: '172.28.73.20', minutes: 61, count: 301 } }),
  );
  try {
    await reiter(w, 'monitor');
    await warte(() => d.getElementById('mon-proxy-hint'));
    const t = text(d.getElementById('mon-proxy-hint'));
    assert.match(t, /Seit 61 Minuten kommen alle 301 Anfragen mit derselben Client-Adresse 172\.28\.73\.20/);
    assert.match(t, /VORGELAGERTER_PROXY/);
  } finally {
    w.close();
  }
});

test('without a hint nothing is shown', async () => {
  const { w, d } = await openUi(jobs(null));
  try {
    await reiter(w, 'monitor');
    await warte(() => d.querySelector('#monitor-content table'));
    assert.equal(d.getElementById('mon-proxy-hint'), null);
  } finally {
    w.close();
  }
});
