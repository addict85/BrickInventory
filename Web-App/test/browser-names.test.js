/**
 * Type check of the UI: no unknown name, no message.
 *
 * Counter-checks (measured on 05.11.2026; A–C since then in the CI step
 * “type check UI”, no longer in npm test):
 *   A  the type annotation {Feld} removed from G() in dom.js → red: main run
 *      with 357 messages
 *   B  the import of apiRaw removed in fortschritt.js → red, TS2304
 *      “Cannot find name 'apiRaw'” with both locations
 *   C  in logviewer.js the type annotation on getElementById("period") removed →
 *      red in the run of the classic scripts
 *   E  the step `npm run typecheck:frontend` removed from web-ci.yml → red
 *   D  "strict": true in tsconfig.frontend.json set to false → red: “strict is
 *      switched on”; "noImplicitThis": false added → likewise red
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { check, RUNS } = require('../scripts/check-frontend-types');

test('UI: the CI checks both configurations as a step of its own', () => {
  // The tsc run is done by CI (npm run typecheck:frontend, both RUNS); run here
  // twice it cost every test run about 19 s (review report arch17-web-b, N7).
  const fs = require('node:fs');
  const path = require('node:path');
  const ci = fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', 'web-ci.yml'), 'utf8');
  assert.match(ci, /^\s+run: npm run typecheck:frontend\s*$/m);
  assert.equal(require('../package.json').scripts['typecheck:frontend'], 'node scripts/check-frontend-types.js');
  assert.deepEqual(RUNS, ['tsconfig.frontend.json', 'tsconfig.frontend-scripts.json']);
  assert.equal(typeof check, 'function');
});

test('UI: strict is switched on, no part of it switched off', () => {
  // Without the switches the run above would stay green but check less. What is asked
  // is tsc itself (--showConfig), so that inherited settings count too.
  const { spawnSync } = require('node:child_process');
  const path = require('node:path');
  const ROOT = path.join(__dirname, '..');
  // The tool lives in the project; -p takes the configuration name relative to cwd.
  for (const config of RUNS) {
    const r = spawnSync(
      process.execPath,
      [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', config, '--showConfig'],
      { cwd: ROOT, encoding: 'utf8' },
    );
    const o = JSON.parse(r.stdout).compilerOptions;
    assert.equal(o.strict, true, `${config}: strict`);
    for (const part of [
      'strictNullChecks',
      'noImplicitAny',
      'noImplicitThis',
      'strictFunctionTypes',
      'strictBindCallApply',
      'strictPropertyInitialization',
      'useUnknownInCatchVariables',
      'alwaysStrict',
    ])
      assert.notEqual(o[part], false, `${config}: ${part} switched off`);
  }
});
