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
function probebaum() {
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

function ratsche(kind, schranken, wurzel) {
  const env = { ...process.env };
  if (wurzel) env.LINT_WURZEL = wurzel;
  if (schranken) {
    const datei = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lint-')), 's.json');
    fs.writeFileSync(datei, JSON.stringify(schranken));
    env.LINT_LIMITS = datei;
  }
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lint-ratchet.js'), kind], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (wurzel) fs.rmSync(wurzel, { recursive: true, force: true });
  return { code: r.status, aus: r.stdout + r.stderr };
}

for (const kind of ['lint', 'format']) {
  test(`${kind}: the existing code keeps the limit, and it is tight`, () => {
    const r = ratsche(kind);
    assert.equal(r.code, 0, r.aus);
    const ist = Number(/\] (\d+) /.exec(r.aus)?.[1]);
    assert.ok(ist >= 0 && ist <= LIMITS[kind], r.aus);
    // Leeway for cleanups in parallel branches; more means: tighten the limit.
    assert.ok(LIMITS[kind] - ist <= 50, `Schranke ${LIMITS[kind]}, gezählt ${ist}: nachziehen`);
  });

  test(`${kind}: counts the findings of a sample tree`, () => {
    const r = ratsche(kind, { lint: 1, format: 1 }, probebaum());
    assert.equal(r.code, 0, r.aus);
    assert.match(r.aus, new RegExp(`^\\[${kind}\\] 1 .*\\(Schranke 1\\)`, 'm'));
  });

  test(`${kind}: a limit that is too low is red`, () => {
    const r = ratsche(kind, { lint: 0, format: 0 }, probebaum());
    assert.equal(r.code, 1, r.aus);
    assert.match(r.aus, /erlaubt sind 0/);
  });
}

test('typecheck:tests: red above the limit, the existing code keeps it', () => {
  // The existing code has 0 messages: once green with the real limit, once red with -1,
  // so that it is visible that the script compares at all.
  const lauf = (/** @type {number | null} */ limit) => {
    const env = { ...process.env };
    if (limit !== null) {
      const datei = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tt-')), 's.json');
      fs.writeFileSync(datei, JSON.stringify({ testTypes: limit }));
      env.LINT_LIMITS = datei;
    }
    return spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check-test-types.js')], {
      cwd: ROOT,
      env,
      encoding: 'utf8',
      timeout: 300_000,
    });
  };
  const echt = lauf(null);
  assert.equal(echt.status, 0, echt.stdout + echt.stderr);
  assert.match(echt.stdout, new RegExp(`\\] 0 Meldungen \\(Schranke ${LIMITS.testTypes}\\)`));
  const toTight = lauf(-1);
  assert.equal(toTight.status, 1, toTight.stdout + toTight.stderr);
  assert.match(toTight.stderr, /0 Meldungen, erlaubt sind -1/);
});
