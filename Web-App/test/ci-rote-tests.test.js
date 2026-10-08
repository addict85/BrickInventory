/**
 * Eine Annotation fuer einen roten Test traegt die BEGRUENDUNG, nicht nur den
 * Namen.
 *
 * ── Woher dieser Test kommt ─────────────────────────────────────────────────
 *
 * Ein Lauf auf main war rot, genau ein Test. Ueber die API abrufbar war:
 *
 *     [failure] Roter Test
 *     Sitzung: gelesen wird immer, geschrieben nur alle paar Minuten (3178ms)
 *
 * Der Name, sonst nichts. DASS er rot war, stand fest; WARUM nicht — und die
 * Suche ging eine halbe Stunde ins Leere. Die Begruendung lag die ganze Zeit im
 * Joblog (der Schritt schreibt sie mit `grep -A 12` dorthin), nur ist das
 * Joblog von aussen nicht zu holen: GitHub liefert es ueber einen anderen Host,
 * und der Proxy lehnt die Weiterleitung mit 403 ab.
 *
 * Das ist dieselbe Fehlerart, gegen die der Workflow schon zwei Absaetze
 * enthaelt („Klartext im Protokoll reicht NICHT") — sie war nur eine Zeile zu
 * hoch behoben.
 *
 * ── Warum das geprueft werden MUSS ──────────────────────────────────────────
 *
 * Der Schritt laeuft unter `if: failure()`. Er wird also genau dann zum ersten
 * Mal ausprobiert, wenn schon etwas anderes kaputt ist — und dann ist keine
 * Zeit, ihn zu reparieren. Ein Diagnosewerkzeug ohne eigenen Test ist der am
 * wenigsten gepruefte Teil eines Workflows.
 *
 * ── Gegenproben (durchgefuehrt) ─────────────────────────────────────────────
 *
 *   a) Fall „die Begruendung steht drin" ist genau der, der VORHER rot gewesen
 *      waere: Die alte Fassung machte aus der `not ok`-Zeile eine Annotation
 *      und nahm die Zeilen darunter nicht mit.
 *   b) Elf rote Tests -> neun ausfuehrliche Annotationen plus EINE
 *      Sammelmeldung, zusammen genau die zehn, die GitHub je Stufe und Schritt
 *      zeigt. Mit einem elften waere die Sammelmeldung die unsichtbare.
 *   c) Die Ueberschrift des spec-Reporters (`✖ failing tests:`) darf keine
 *      Annotation werden — sie ist kein Testname.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const AWK = path.join(ROOT, '..', '.github', 'rote-tests.awk');

/** Das Auslesewerkzeug auf ein Protokoll anwenden. */
function annotationen(protokoll) {
  const datei = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bi-rot-')), 'test.log');
  fs.writeFileSync(datei, protokoll);
  try {
    return execFileSync('awk', ['-f', AWK, datei], { encoding: 'utf8' })
      .split('\n').filter(Boolean);
  } finally {
    fs.rmSync(path.dirname(datei), { recursive: true, force: true });
  }
}

test('Annotationen fuer rote Tests', async (t) => {
  assert.ok(fs.existsSync(AWK),
    `${AWK} fehlt — dann hat der Workflow nichts zum Auslesen und dieser Test ` +
    `prueft nichts.`);

  await t.test('die Begruendung steht in der Annotation, nicht nur der Name', () => {
    // Genau die Form, die `npm test` in der CI schreibt (ohne Terminal nimmt
    // Node 22 TAP) — nachgemessen an einem absichtlich roten Test.
    const log = [
      'TAP version 13',
      '# Subtest: Sitzung: gelesen wird immer',
      'not ok 7 - Sitzung: gelesen wird immer',
      '  ---',
      '  duration_ms: 3178.8',
      "  location: '/home/runner/work/x/Web-App/test/sitzung-beruehrung-db.test.js:78:1'",
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

    const a = annotationen(log);
    assert.equal(a.length, 1, `erwartet eine Annotation, bekommen ${a.length}:\n${a.join('\n')}`);
    const m = a[0];
    assert.match(m, /^::error title=Roter Test::/);
    assert.match(m, /Sitzung: gelesen wird immer/, 'der Name fehlt');
    assert.match(m, /2 Schreibvorgaenge bei 20 Anfragen/,
      'die BEGRUENDUNG fehlt — genau das war der Befund, aus dem dieser Test entstand.');
    assert.match(m, /expected: 1/, 'die Erwartung fehlt');
    assert.match(m, /actual: 2/, 'der Istwert fehlt');
    assert.match(m, /sitzung-beruehrung-db\.test\.js:78/, 'die Fundstelle fehlt');
    // Der Stapelabzug bleibt draussen: lang, und die Fundstelle steht schon da.
    assert.doesNotMatch(m, /TestContext/, 'der Stapelabzug gehoert nicht in die Annotation');
    // Eine Annotation ist EINE Zeile; Umbrueche stehen als %0A darin.
    assert.ok(!m.includes('\n'), 'die Annotation geht ueber mehrere Zeilen und wird abgeschnitten');
    assert.ok(m.includes('%0A'), 'es gibt keine kodierten Umbrueche — alles klebt zusammen');
  });

  await t.test('elf rote Tests ergeben neun plus eine Sammelmeldung', () => {
    const bloecke = [];
    for (let i = 1; i <= 11; i++) {
      bloecke.push(`not ok ${i} - Test ${i}`, '  ---', '  error: |-',
        `    Begruendung ${i}`, '  stack: |-', '    x', '  ...');
    }
    const a = annotationen('TAP version 13\n' + bloecke.join('\n') + '\n');
    assert.equal(a.length, 10,
      `GitHub zeigt je Stufe und Schritt hoechstens zehn Annotationen; es sind ${a.length}. ` +
      `Mit mehr waere die Sammelmeldung die unsichtbare.`);
    const einzeln = a.filter(z => z.startsWith('::error title=Roter Test::'));
    assert.equal(einzeln.length, 9);
    assert.match(a[9], /^::error title=Weitere rote Tests::2 weitere/,
      `die Sammelmeldung fehlt oder zaehlt falsch: ${a[9]}`);
    // Und sie duerfen nicht alle dasselbe sagen.
    assert.match(einzeln[0], /Begruendung 1/);
    assert.match(einzeln[8], /Begruendung 9/);
  });

  await t.test('die Ueberschrift des spec-Reporters wird uebersprungen', () => {
    const a = annotationen('✖ failing tests:\n\n✖ Test A (1.2ms)\n  error: etwas\n  stack: x\n');
    assert.equal(a.length, 1, `erwartet eine Annotation, bekommen ${a.length}:\n${a.join('\n')}`);
    assert.match(a[0], /Test A/);
    assert.doesNotMatch(a[0], /failing tests/,
      '„failing tests:" ist die Ueberschrift der Liste, kein Testname.');
  });

  await t.test('ein Lauf ohne roten Test ergibt keine Annotation', () => {
    // Der Rueckfall dafuer steht im Workflow (das Protokollende als Annotation)
    // — dieses Werkzeug darf dann schweigen, statt etwas zu erfinden.
    assert.deepEqual(annotationen('TAP version 13\nok 1 - alles gut\n1..1\n'), []);
  });

  await t.test('Prozentzeichen im Text zerstoeren die Annotation nicht', () => {
    // `%` ist das Fluchtzeichen der Annotationen. Ein Text wie „95 % der Zeilen"
    // wuerde sonst als Kodierung gelesen und den Rest verschlucken.
    const a = annotationen('not ok 1 - Deckung\n  error: |-\n    nur 95 % erreicht\n  stack: x\n');
    assert.equal(a.length, 1);
    assert.match(a[0], /nur 95 %25 erreicht/,
      `das Prozentzeichen ist nicht maskiert: ${a[0]}`);
  });
});
