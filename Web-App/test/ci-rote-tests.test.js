/**
 * An annotation for a red test carries the RATIONALE, not only the
 * name.
 *
 * ── Counter-checks (performed) ──────────────────────────────────────────────
 *
 *   a) the case “the rationale is in it" is exactly the one that would have been red
 *      BEFORE: the old version made an annotation from the `not ok` line
 *      and did not take the lines below along.
 *   b) eleven red tests -> nine detailed annotations plus ONE
 *      summary message, together exactly the ten that GitHub shows per level and step.
 *      With an eleventh the summary message would be the invisible one.
 *   c) the heading of the spec reporter (`✖ failing tests:`) must not become an
 *      annotation — it is not a test name.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const AWK = path.join(ROOT, '..', '.github', 'rote-tests.awk');

/** Apply the extraction tool to a log. */
function annotationList(logText) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bi-rot-')), 'test.log');
  fs.writeFileSync(file, logText);
  try {
    return execFileSync('awk', ['-f', AWK, file], { encoding: 'utf8' }).split('\n').filter(Boolean);
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
}

test('annotations for red tests', async t => {
  assert.ok(
    fs.existsSync(AWK),
    `${AWK} is missing — then the workflow has nothing to read and this test ` + `checks nothing.`,
  );

  await t.test('the reasoning is in the annotation, not only the name', () => {
    // Exactly the form `npm test` writes in CI (without a terminal Node 22
    // takes TAP) — re-measured on a deliberately red test.
    const log = [
      'TAP version 13',
      '# Subtest: Sitzung: gelesen wird immer',
      'not ok 7 - Sitzung: gelesen wird immer',
      '  ---',
      '  duration_ms: 3178.8',
      "  location: '/home/runner/work/x/Web-App/test/session-touch-db.test.js:78:1'",
      '  failureType: testCodeFailure',
      '  error: |-',
      '    2 Schreibvorgaenge bei 20 Anfragen — erwartet genau 1',
      "  code: 'ERR_ASSERTION'",
      '  expected: 1',
      '  actual: 2',
      '  stack: |-',
      '    TestContext.<anonymous> (irgendwo:1:1)',
      '  ...',
      '1..7',
    ].join('\n');

    const a = annotationList(log);
    assert.equal(a.length, 1, `expected one annotation, got ${a.length}:\n${a.join('\n')}`);
    const m = a[0];
    assert.match(m, /^::error title=Roter Test::/);
    assert.match(m, /Sitzung: gelesen wird immer/, 'the name is missing');
    assert.match(
      m,
      /2 Schreibvorgaenge bei 20 Anfragen/,
      'the REASON is missing — that was exactly the finding this test came from.',
    );
    assert.match(m, /expected: 1/, 'the expectation is missing');
    assert.match(m, /actual: 2/, 'the actual value is missing');
    assert.match(m, /session-touch-db\.test\.js:78/, 'the location is missing');
    // The stack trace stays out: long, and the location is already there.
    assert.doesNotMatch(m, /TestContext/, 'the stack trace does not belong in the annotation');
    // An annotation is ONE line; line breaks are in it as %0A.
    assert.ok(!m.includes('\n'), 'the annotation spans several lines and gets cut off');
    assert.ok(m.includes('%0A'), 'there are no encoded line breaks — everything sticks together');
  });

  await t.test('eleven red tests yield nine plus a summary message', () => {
    const blockList = [];
    for (let i = 1; i <= 11; i++) {
      blockList.push(
        `not ok ${i} - Test ${i}`,
        '  ---',
        '  error: |-',
        `    Begruendung ${i}`,
        '  stack: |-',
        '    x',
        '  ...',
      );
    }
    const a = annotationList('TAP version 13\n' + blockList.join('\n') + '\n');
    assert.equal(
      a.length,
      10,
      `GitHub shows at most ten annotations per job and step; there are ${a.length}. ` +
        `With more the summary message would be the invisible one.`,
    );
    const single = a.filter(z => z.startsWith('::error title=Roter Test::'));
    assert.equal(single.length, 9);
    assert.match(
      a[9],
      /^::error title=Weitere rote Tests::2 weitere/,
      `the summary message is missing or counts wrongly: ${a[9]}`,
    );
    // And they must not all say the same.
    assert.match(single[0], /Begruendung 1/);
    assert.match(single[8], /Begruendung 9/);
  });

  await t.test('the heading of the spec reporter is skipped', () => {
    const a = annotationList('✖ failing tests:\n\n✖ Test A (1.2ms)\n  error: etwas\n  stack: x\n');
    assert.equal(a.length, 1, `expected one annotation, got ${a.length}:\n${a.join('\n')}`);
    assert.match(a[0], /Test A/);
    assert.doesNotMatch(a[0], /failing tests/, '„failing tests:“ is the heading of the list, not a test name.');
  });

  await t.test('a run without a red test yields no annotation', () => {
    // The fallback for it is in the workflow (the end of the log as an annotation)
    // — this tool may then stay silent instead of inventing something.
    assert.deepEqual(annotationList('TAP version 13\nok 1 - alles gut\n1..1\n'), []);
  });

  await t.test('percent signs in the text do not destroy the annotation', () => {
    // `%` is the escape character of the annotations. A text like “95 % of the lines"
    // would otherwise be read as an encoding and swallow the rest.
    const a = annotationList('not ok 1 - Deckung\n  error: |-\n    nur 95 % erreicht\n  stack: x\n');
    assert.equal(a.length, 1);
    assert.match(a[0], /nur 95 %25 erreicht/, `the percent sign is not escaped: ${a[0]}`);
  });
});
