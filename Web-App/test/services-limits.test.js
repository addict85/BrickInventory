/**
 * Ein Bereich gibt nur seine Dienste heraus, nicht seinen Kontext (Zugang,
 * Transaktion, Repositories, Fächer): Die Probe test/fixtures/services-limits.ts
 * greift darauf mit @ts-expect-error zu, und tsc muss jeden Zugriff ablehnen.
 *
 * Gegenproben (14.11.2026 gemessen, je einzeln):
 *   A  in createInventory (src/inventory/area.ts) wieder `...k,` vor die Dienste →
 *      rot: vier unbenutzte @ts-expect-error (d.inventory.db, .transaktion,
 *      .papierkorb, .manuelleMengen)
 *   B  in createAccount `protokoll: k.protokoll,` ergänzt → rot: d.account.protokoll
 *   C  `locationService` aus createInventory entfernt → rot: tsc meldet die Nutzer und die Probe
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

test('die Dienste eines Bereichs zeigen kein Innenleben', () => {
  const r = spawnSync(
    process.execPath,
    [
      path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
      '-p',
      path.join(ROOT, 'test', 'fixtures', 'tsconfig.services-limits.json'),
    ],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  const meldungen = `${r.stdout}${r.stderr}`.split('\n').filter(z => /error TS\d+/.test(z));
  assert.deepEqual(meldungen, [], 'Ein Bereich gibt Innenleben heraus, oder ein Dienst fehlt');
  assert.equal(r.status, 0);
});
