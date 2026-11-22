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
function annotationList(protokoll) {
  const datei = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bi-rot-')), 'test.log');
  fs.writeFileSync(datei, protokoll);
  try {
    return execFileSync('awk', ['-f', AWK, datei], { encoding: 'utf8' }).split('\n').filter(Boolean);
  } finally {
    fs.rmSync(path.dirname(datei), { recursive: true, force: true });
  }
}

test('annotations for red tests', async t => {
  assert.ok(
    fs.existsSync(AWK),
    `${AWK} fehlt — dann hat der Workflow nichts zum Auslesen und dieser Test ` + `prueft nichts.`,
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
    assert.equal(a.length, 1, `erwartet eine Annotation, bekommen ${a.length}:\n${a.join('\n')}`);
    const m = a[0];
    assert.match(m, /^::error title=Roter Test::/);
    assert.match(m, /Sitzung: gelesen wird immer/, 'der Name fehlt');
    assert.match(
      m,
      /2 Schreibvorgaenge bei 20 Anfragen/,
      'die BEGRUENDUNG fehlt — genau das war der Befund, aus dem dieser Test entstand.',
    );
    assert.match(m, /expected: 1/, 'die Erwartung fehlt');
    assert.match(m, /actual: 2/, 'der Istwert fehlt');
    assert.match(m, /session-touch-db\.test\.js:78/, 'die Fundstelle fehlt');
    // The stack trace stays out: long, and the location is already there.
    assert.doesNotMatch(m, /TestContext/, 'der Stapelabzug gehoert nicht in die Annotation');
    // An annotation is ONE line; line breaks are in it as %0A.
    assert.ok(!m.includes('\n'), 'die Annotation geht ueber mehrere Zeilen und wird abgeschnitten');
    assert.ok(m.includes('%0A'), 'es gibt keine kodierten Umbrueche — alles klebt zusammen');
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
      `GitHub zeigt je Stufe und Schritt hoechstens zehn Annotationen; es sind ${a.length}. ` +
        `Mit mehr waere die Sammelmeldung die unsichtbare.`,
    );
    const einzeln = a.filter(z => z.startsWith('::error title=Roter Test::'));
    assert.equal(einzeln.length, 9);
    assert.match(
      a[9],
      /^::error title=Weitere rote Tests::2 weitere/,
      `die Sammelmeldung fehlt oder zaehlt falsch: ${a[9]}`,
    );
    // And they must not all say the same.
    assert.match(einzeln[0], /Begruendung 1/);
    assert.match(einzeln[8], /Begruendung 9/);
  });

  await t.test('the heading of the spec reporter is skipped', () => {
    const a = annotationList('✖ failing tests:\n\n✖ Test A (1.2ms)\n  error: etwas\n  stack: x\n');
    assert.equal(a.length, 1, `erwartet eine Annotation, bekommen ${a.length}:\n${a.join('\n')}`);
    assert.match(a[0], /Test A/);
    assert.doesNotMatch(a[0], /failing tests/, '„failing tests:" ist die Ueberschrift der Liste, kein Testname.');
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
    assert.match(a[0], /nur 95 %25 erreicht/, `das Prozentzeichen ist nicht maskiert: ${a[0]}`);
  });
});
