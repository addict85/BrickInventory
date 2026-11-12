/**
 * npm run lint und npm run format:pruefen: Biome über den Bestand, rot erst,
 * wenn die Zahl der Funde über die Schranke in scripts/lint-schranken.json
 * steigt. Geprüft am echten Skript, einmal mit der echten Schranke und einmal
 * mit einer, die der Bestand nicht einhält.
 *
 * Gegenproben (05.11.2026, je einzeln):
 *   A  `if (ist > schranke)` → `if (false)` → „eine zu niedrige Schranke ist rot“ rot
 *   B  nur `lint/style` gezählt statt aller Regeln → „lint: … zählt die Funde eines
 *      Probebaums“ rot (seit der Bestand 0 Funde hat, zählt ein Probebaum mit Funden;
 *      12.11.2026 wiederholt)
 *   C  check-test-typen.js: `if (meldungen.length > schranke)` → `if (false)`
 *      → „typecheck:tests …“ rot
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCHRANKEN = require('../scripts/lint-schranken.json');

/** Ein Baum mit einem Lint-Fund (`==`) und einer unformatierten Datei: Am Bestand ohne Funde
 *  liesse sich nicht sehen, ob das Skript überhaupt zählt. */
function probebaum() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-baum-'));
  fs.copyFileSync(path.join(ROOT, 'biome.json'), path.join(d, 'biome.json'));
  fs.mkdirSync(path.join(d, 'src'));
  fs.writeFileSync(
    path.join(d, 'src', 'probe.ts'),
    'export function f(a: number) {\n  if (a == 1)   return 1;\n  return 2;\n}\n',
  );
  return d;
}

function ratsche(art, schranken, wurzel) {
  const env = { ...process.env };
  if (wurzel) env.LINT_WURZEL = wurzel;
  if (schranken) {
    const datei = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lint-')), 's.json');
    fs.writeFileSync(datei, JSON.stringify(schranken));
    env.LINT_SCHRANKEN = datei;
  }
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lint-ratsche.js'), art], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (wurzel) fs.rmSync(wurzel, { recursive: true, force: true });
  return { code: r.status, aus: r.stdout + r.stderr };
}

for (const art of ['lint', 'format']) {
  test(`${art}: der Bestand hält die Schranke, und sie ist knapp`, () => {
    const r = ratsche(art);
    assert.equal(r.code, 0, r.aus);
    const ist = Number(/\] (\d+) /.exec(r.aus)?.[1]);
    assert.ok(ist >= 0 && ist <= SCHRANKEN[art], r.aus);
    // Spielraum für Aufräumen in parallelen Zweigen; mehr heisst: die Schranke nachziehen.
    assert.ok(SCHRANKEN[art] - ist <= 50, `Schranke ${SCHRANKEN[art]}, gezählt ${ist}: nachziehen`);
  });

  test(`${art}: zählt die Funde eines Probebaums`, () => {
    const r = ratsche(art, { lint: 1, format: 1 }, probebaum());
    assert.equal(r.code, 0, r.aus);
    assert.match(r.aus, new RegExp(`^\\[${art}\\] 1 .*\\(Schranke 1\\)`, 'm'));
  });

  test(`${art}: eine zu niedrige Schranke ist rot`, () => {
    const r = ratsche(art, { lint: 0, format: 0 }, probebaum());
    assert.equal(r.code, 1, r.aus);
    assert.match(r.aus, /erlaubt sind 0/);
  });
}

test('typecheck:tests: rot über der Schranke, der Bestand hält sie', () => {
  // Ein Lauf genügt: Mit Schranke 10 ist er rot und nennt die Zahl, die die echte Schranke halten muss.
  const datei = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tt-')), 's.json');
  fs.writeFileSync(datei, JSON.stringify({ testtypen: 10 }));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check-test-typen.js')], {
    cwd: ROOT,
    env: { ...process.env, LINT_SCHRANKEN: datei },
    encoding: 'utf8',
    timeout: 300_000,
  });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const ist = Number(/(\d+) Meldungen, erlaubt sind 10/.exec(r.stderr)?.[1]);
  assert.ok(ist > 10 && ist <= SCHRANKEN.testtypen, `${ist} Meldungen, Schranke ${SCHRANKEN.testtypen}`);
});
