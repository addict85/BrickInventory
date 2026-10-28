/**
 * Kein unbekannter Name im Browser-Code.
 *
 * Ein Tippfehler in einem Variablennamen fällt im Browser erst auf, wenn die
 * Zeile läuft — in Finanzen brach so die Wertentwicklung mit „chartData is
 * not defined" ab. tsc prüft die Dateien in public/js/ mit checkJs und meldet
 * nur diese eine Fehlerart (TS2304/TS2552); Typen spielen keine Rolle.
 *
 * Gegenproben (am 25.10. gemessen):
 *   A  finalChartData in 04-finance.js wieder chartData → rot, mit Fundstelle
 *   B  `let _activeAbort` in 02-gallery.js entfernt     → rot, jede Fundstelle genannt
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
/** Globale Namen eingebundener Bibliotheken (public/vendor/). */
// __ERLAUBTE_STILE__ ist keine Bibliothek: scripts/build-frontend.js setzt ihn beim Bündeln ein.
const BIBLIOTHEKEN = ['QRCode', '__ERLAUBTE_STILE__'];

/** Die Browser-Quellen — ohne app.bundle.js, das aus ihnen gebaut wird. */
function quellen() {
  const js = path.join(ROOT, 'public', 'js');
  return [...fs.readdirSync(js).filter(f => /^\d\d-.*\.js$/.test(f)).map(f => path.join(js, f)),
          path.join(ROOT, 'public', 'i18n.js')];
}

test('public/js: jeder verwendete Name ist deklariert oder importiert', () => {
  assert.ok(quellen().length > 20, 'Browser-Quellen nicht gefunden');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-namen-'));
  try {
    const decl = path.join(dir, 'bibliotheken.d.ts');
    fs.writeFileSync(decl, BIBLIOTHEKEN.map(n => `declare const ${n}: any;`).join('\n'));
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        allowJs: true, checkJs: true, noEmit: true, target: 'es2022', module: 'es2022',
        moduleResolution: 'bundler', lib: ['es2022', 'dom', 'dom.iterable'], skipLibCheck: true, types: [],
      },
      files: [...quellen(), decl],
    }));
    const tsc = path.join(ROOT, 'node_modules', '.bin', 'tsc');
    const r = spawnSync(tsc, ['-p', path.join(dir, 'tsconfig.json')], { encoding: 'utf8' });
    assert.ok(r.status !== null, `tsc lief nicht: ${r.error?.message}`);
    const unbekannt = (r.stdout + r.stderr).split('\n').filter(z => /error TS(2304|2552):/.test(z));
    assert.ok(/error TS\d+/.test(r.stdout + r.stderr) || r.status === 0,
      `tsc lieferte weder Fehler noch Erfolg:\n${(r.stdout + r.stderr).slice(0, 800)}`);
    assert.deepEqual(unbekannt, [], `Unbekannte Namen — im Browser ein ReferenceError:\n${unbekannt.join('\n')}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('public/js: die Typprüfung (checkJs) meldet weniger, nie mehr', () => {
  // Die Oberfläche hat keinen eigenen Übersetzer; diese Prüfung ist ihre
  // Typprüfung. GEMESSEN am 28.10.2026: 492 Meldungen, nach dem Typ für G()
  // und den window-Feldern (test/helpers/fenster.d.ts) 184.
  // Gegenprobe: `@returns {HTMLInputElement}` an G() entfernt → rot (459).
  const SCHRANKE = 184;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-typen-'));
  try {
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        allowJs: true, checkJs: true, noEmit: true, target: 'es2022', module: 'es2022',
        moduleResolution: 'bundler', lib: ['es2022', 'dom', 'dom.iterable'], skipLibCheck: true, types: [],
        strict: false,   // erst die Felder, dann die impliziten any — eine Stufe nach der anderen
      },
      files: [...quellen(), path.join(__dirname, 'helpers', 'fenster.d.ts')],
    }));
    const r = spawnSync(path.join(ROOT, 'node_modules', '.bin', 'tsc'), ['-p', path.join(dir, 'tsconfig.json')], { encoding: 'utf8' });
    const meldungen = (r.stdout + r.stderr).split('\n').filter(z => /error TS\d+:/.test(z));
    assert.ok(r.status !== null, `tsc lief nicht: ${r.error?.message}`);
    assert.ok(meldungen.length <= SCHRANKE,
      `${meldungen.length} Meldungen, erlaubt sind ${SCHRANKE}. Neue zuerst:\n${meldungen.slice(0, 15).join('\n')}`);
    if (meldungen.length < SCHRANKE) console.log(`  ℹ checkJs: ${meldungen.length} (Schranke ${SCHRANKE}) — Schranke nachziehen`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
