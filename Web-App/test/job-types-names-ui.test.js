/**
 * Background jobs → “jobs per kind”: every job kind the server registers
 * (DECLARED_KINDS) appears under its translated name, never as an internal key.
 * A new kind without an entry in KIND_NAMES turns red here.
 *
 * Counter-checks (measured 16.11.2026, each alone, bundle rebuilt):
 *   A  in monitor.js the entry katalog_nachzug deleted from KIND_NAMES → red: “katalog_nachzug”
 *      stands as a key in the table (de and en)
 *   B  in en.js monitor.kind.catalog_catch_up deleted → red: i18n.test.js (key sets); green here
 *      because tRaw falls back to the German text — that test catches the gap.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, reiter } = require('./helpers/ui');
const { buildAndRequire } = require('./helpers/sources');

const { DECLARED_KINDS } = buildAndRequire()('startup/wiring.js');
const ARTEN = Object.keys(DECLARED_KINDS).sort();

for (const sprache of ['de', 'en']) {
  test(`every registered job kind has a name (${sprache})`, async () => {
    assert.ok(ARTEN.length > 15 && ARTEN.includes('katalog_nachzug'), `nur ${ARTEN.length} Arten`);
    const { w, d, warte, ruhig } = await openUi(
      {
        '/v1/admin/job-status': { success: true, job: { running: false } },
        '/v1/admin/jobs': { success: true, jobs: {}, schedules: {}, db: { csvCache: {}, blMapping: {} } },
        '/v1/admin/auftraege': {
          success: true,
          auftraege: [],
          zusammenfassung: ARTEN.map(art => ({ type: art, status: 'offen', anzahl: 1 })),
          job_prozess: { laeuft: true },
          bildbedarf: 0,
          pausen: [],
        },
      },
      { sprache },
    );
    try {
      await reiter(w, 'monitor');
      await ruhig();
      assert.ok(await warte(() => d.querySelectorAll('.mon-kinds tbody tr').length === ARTEN.length), 'Tabelle');
      const namen = [...d.querySelectorAll('.mon-kinds tbody tr')].map(z => z.cells[0].textContent.trim());
      const roh = namen.filter(n => /^[a-z_.]+$/.test(n));
      assert.deepEqual(roh, [], `ohne Namen: ${roh.join(', ')}`);
      assert.equal(new Set(namen).size, ARTEN.length, `doppelte Namen: ${namen.join(' | ')}`);
    } finally {
      w.close();
    }
  });
}
