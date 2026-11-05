/**
 * npm run lint und npm run format:pruefen: Biome über den Bestand, rot erst,
 * wenn die Zahl der Funde über die Schranke in scripts/lint-schranken.json
 * steigt. Geprüft am echten Skript, einmal mit der echten Schranke und einmal
 * mit einer, die der Bestand nicht einhält.
 *
 * Gegenproben (05.11.2026, je einzeln):
 *   A  `if (ist > schranke)` → `if (false)` → „eine zu niedrige Schranke ist rot“ rot
 *   B  nur `lint/style` gezählt statt aller Regeln → „lint: der Bestand hält die
 *      Schranke, und sie ist knapp“ rot (Zählung weit unter der Schranke)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCHRANKEN = require('../scripts/lint-schranken.json');

function ratsche(art, schranken) {
  const env = { ...process.env };
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
  return { code: r.status, aus: r.stdout + r.stderr };
}

for (const art of ['lint', 'format']) {
  test(`${art}: der Bestand hält die Schranke, und sie ist knapp`, () => {
    const r = ratsche(art);
    assert.equal(r.code, 0, r.aus);
    const ist = Number(/\] (\d+) /.exec(r.aus)?.[1]);
    assert.ok(ist > 20, `nur ${ist} Funde gezählt — zählt das Skript alle?`);
    // Spielraum für Aufräumen in parallelen Zweigen; mehr heisst: die Schranke nachziehen.
    assert.ok(SCHRANKEN[art] - ist <= 50, `Schranke ${SCHRANKEN[art]}, gezählt ${ist}: nachziehen`);
  });

  test(`${art}: eine zu niedrige Schranke ist rot`, () => {
    const r = ratsche(art, { lint: 10, format: 10 });
    assert.equal(r.code, 1, r.aus);
    assert.match(r.aus, /erlaubt sind 10/);
  });
}
