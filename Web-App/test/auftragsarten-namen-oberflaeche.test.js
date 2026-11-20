/**
 * Hintergrundarbeiten → „Aufträge je Art“: Jede Auftragsart, die der Server anmeldet
 * (DECLARED_KINDS), erscheint unter ihrem übersetzten Namen, nie als interner Schlüssel.
 * Eine neue Art ohne Eintrag in KIND_NAMES wird hier rot.
 *
 * Gegenproben (16.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  in monitor.js den Eintrag katalog_nachzug aus KIND_NAMES gestrichen → rot: „katalog_nachzug“
 *      steht als Schlüssel in der Tabelle (de und en)
 *   B  in en.js monitor.art.katalog_nachzug gestrichen → rot: i18n.test.js (Schlüsselmengen); hier grün,
 *      weil tRaw auf den deutschen Text zurückfällt — die Lücke fängt jener Test.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, reiter } = require('./helpers/oberflaeche');
const { buildAndRequire } = require('./helpers/sources');

const { DECLARED_KINDS } = buildAndRequire()('startup/verdrahtung.js');
const ARTEN = Object.keys(DECLARED_KINDS).sort();

for (const sprache of ['de', 'en']) {
  test(`jede angemeldete Auftragsart hat einen Namen (${sprache})`, async () => {
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
      assert.ok(await warte(() => d.querySelectorAll('.mon-arten tbody tr').length === ARTEN.length), 'Tabelle');
      const namen = [...d.querySelectorAll('.mon-arten tbody tr')].map(z => z.cells[0].textContent.trim());
      const roh = namen.filter(n => /^[a-z_.]+$/.test(n));
      assert.deepEqual(roh, [], `ohne Namen: ${roh.join(', ')}`);
      assert.equal(new Set(namen).size, ARTEN.length, `doppelte Namen: ${namen.join(' | ')}`);
    } finally {
      w.close();
    }
  });
}
