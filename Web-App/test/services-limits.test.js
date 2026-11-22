/**
 * An area only hands out its services, not its context (access,
 * transaction, repositories, compartments): the probe test/fixtures/services-limits.ts
 * accesses them with @ts-expect-error, and tsc must reject every access.
 *
 * Counter-checks (measured 14.11.2026, each on its own):
 *   A  in createInventory (src/inventory/area.ts) again `...k,` before the services →
 *      red: four unused @ts-expect-error (d.inventory.db, .transact,
 *      .papierkorb, .manualQuantities)
 *   B  `protokoll: k.protokoll,` added in createAccount → red: d.account.protokoll
 *   C  `locationService` removed from createInventory → red: tsc reports the users and the probe
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

test('the services of a scope show no internals', () => {
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
