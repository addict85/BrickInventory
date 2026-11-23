/**
 * npm run lint and npm run format:check: Biome over the existing code, red only
 * when the number of findings rises above the limit in scripts/lint-limits.json.
 * Checked on the real script, once with the real limit and once
 * with one that the existing code does not keep.
 *
 * Counter-checks (05.11.2026, each on its own):
 *   A  `if (ist > limit)` → `if (false)` → “a limit that is too low is red” red
 *   B  only `lint/style` counted instead of all rules → “lint: … counts the findings of a
 *      sample tree” red (since the existing code has 0 findings, a sample tree with findings counts;
 *      repeated 12.11.2026)
 *   C  check-test-types.js: `if (meldungen.length > limit)` → `if (false)`
 *      → “typecheck:tests …” red (repeated 14.11.2026 with limit 0 and probe -1)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const LIMITS = require('../scripts/lint-limits.json');

/** A tree with one lint finding (`==`) and one unformatted file: on the existing code without findings
 *  one could not see whether the script counts at all. */
function probeTree() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-baum-'));
  fs.copyFileSync(path.join(ROOT, 'biome.json'), path.join(d, 'biome.json'));
  fs.cpSync(path.join(ROOT, 'biome'), path.join(d, 'biome'), { recursive: true });
  fs.mkdirSync(path.join(d, 'src'));
  fs.writeFileSync(
    path.join(d, 'src', 'probe.ts'),
    'export function f(a: number) {\n  if (a == 1)   return 1;\n  return 2;\n}\n',
  );
  return d;
}

function ratchetFn(kind, limits, root) {
  const env = { ...process.env };
  if (root) env.LINT_ROOT = root;
  if (limits) {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lint-')), 's.json');
    fs.writeFileSync(file, JSON.stringify(limits));
    env.LINT_LIMITS = file;
  }
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lint-ratchet.js'), kind], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (root) fs.rmSync(root, { recursive: true, force: true });
  return { code: r.status, out: r.stdout + r.stderr };
}

for (const kind of ['lint', 'format']) {
  test(`${kind}: the existing code keeps the limit, and it is tight`, () => {
    const r = ratchetFn(kind);
    assert.equal(r.code, 0, r.out);
    const actual = Number(/\] (\d+) /.exec(r.out)?.[1]);
    assert.ok(actual >= 0 && actual <= LIMITS[kind], r.out);
    // Leeway for cleanups in parallel branches; more means: tighten the limit.
    assert.ok(LIMITS[kind] - actual <= 50, `Limit ${LIMITS[kind]}, counted ${actual}: tighten it`);
  });

  test(`${kind}: counts the findings of a sample tree`, () => {
    const r = ratchetFn(kind, { lint: 1, format: 1 }, probeTree());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, new RegExp(`^\\[${kind}\\] 1 .*\\(Schranke 1\\)`, 'm'));
  });

  test(`${kind}: a limit that is too low is red`, () => {
    const r = ratchetFn(kind, { lint: 0, format: 0 }, probeTree());
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /erlaubt sind 0/);
  });
}

test('typecheck:tests: red above the limit, the existing code keeps it', () => {
  // The existing code has 0 messages: once green with the real limit, once red with -1,
  // so that it is visible that the script compares at all.
  const run = (/** @type {number | null} */ limit) => {
    const env = { ...process.env };
    if (limit !== null) {
      const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tt-')), 's.json');
      fs.writeFileSync(file, JSON.stringify({ testTypes: limit }));
      env.LINT_LIMITS = file;
    }
    return spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check-test-types.js')], {
      cwd: ROOT,
      env,
      encoding: 'utf8',
      timeout: 300_000,
    });
  };
  const original = run(null);
  assert.equal(original.status, 0, original.stdout + original.stderr);
  assert.match(original.stdout, new RegExp(`\\] 0 Meldungen \\(Schranke ${LIMITS.testTypes}\\)`));
  const toTight = run(-1);
  assert.equal(toTight.status, 1, toTight.stdout + toTight.stderr);
  assert.match(toTight.stderr, /0 Meldungen, erlaubt sind -1/);
});
