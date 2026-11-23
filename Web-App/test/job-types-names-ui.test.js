/**
 * Background jobs → “jobs per kind”: every job kind the server registers
 * (DECLARED_KINDS) appears under its translated name, never as an internal key.
 * A new kind without an entry in KIND_NAMES turns red here.
 *
 * Counter-checks (measured 16.11.2026, each alone, bundle rebuilt):
 *   A  in job-names.js the entry catalog_followup deleted from KIND_NAMES → red: “catalog_followup”
 *      stands as a key in the table (de and en)
 *   B  in en.js monitor.kind.catalog_catch_up deleted → red: i18n.test.js (key sets); green here
 *      because tRaw falls back to the German text — that test catches the gap.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, switchTab } = require('./helpers/ui');
const { buildAndRequire } = require('./helpers/sources');

const { DECLARED_KINDS } = buildAndRequire()('startup/wiring.js');
const KINDS = Object.keys(DECLARED_KINDS).sort();

for (const language of ['de', 'en']) {
  test(`every registered job kind has a name (${language})`, async () => {
    assert.ok(KINDS.length > 15 && KINDS.includes('catalog_followup'), `only ${KINDS.length} kinds`);
    const { w, d, waitFor, settle } = await openUi(
      {
        '/v2/admin/job-status': { success: true, job: { running: false } },
        '/v2/admin/jobs': { success: true, jobs: {}, schedules: {}, db: { csvCache: {}, blMapping: {} } },
        '/v2/admin/job-queue': {
          success: true,
          jobs: [],
          summary: KINDS.map(kind => ({ type: kind, status: 'pending', count: 1 })),
          job_process: { running: true },
          image_demand: 0,
          pauses: [],
        },
      },
      { language },
    );
    try {
      await switchTab(w, 'monitor');
      await settle();
      assert.ok(await waitFor(() => d.querySelectorAll('.mon-kinds tbody tr').length === KINDS.length), 'Table');
      const names = [...d.querySelectorAll('.mon-kinds tbody tr')].map(z => z.cells[0].textContent.trim());
      const raw = names.filter(n => /^[a-z_.]+$/.test(n));
      assert.deepEqual(raw, [], `without names: ${raw.join(', ')}`);
      assert.equal(new Set(names).size, KINDS.length, `duplicate names: ${names.join(' | ')}`);
    } finally {
      w.close();
    }
  });
}
