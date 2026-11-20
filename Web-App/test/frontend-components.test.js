/**
 * Wiederkehrende Ansichtsteile stehen an EINER Stelle.
 *
 * Gegenproben (08.11.2026 gemessen): in detailRow `class="dv"` →
 * `class="wert"` bzw. in loadDisplay die Skelettzeilen gestrichen → rot:
 * „der Baustein erzeugt das Markup, das die Stylesheets erwarten“.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const JS = path.join(__dirname, '..', 'public', 'js');
const COMPONENT = 'components.js';
const { buildTestbuendel } = require('./helpers/bundle');
process.env.TEST_BUENDEL = buildTestbuendel(
  'bausteine',
  "import { detailRow, loadDisplay } from './components.js';\nwindow.__build = { detailRow, loadDisplay };\n",
);
const { openUi } = require('./helpers/ui');

/** Alle Frontend-Module ausser dem Bündel und dem Baustein selbst. */
function module_() {
  const alle = fs.readdirSync(JS).filter(f => f.endsWith('.js'));
  const gefiltert = alle.filter(f => f !== 'app.bundle.js' && f !== COMPONENT);
  // Selbstbeweis: Findet die Schleife nichts, wäre jede Prüfung unten
  // stillschweigend grün.
  assert.ok(gefiltert.length >= 10, `nur ${gefiltert.length} Frontend-Module gefunden — Pfad falsch?`);
  return gefiltert;
}

test('die Detailzeile wird nirgends mehr von Hand gebaut', () => {
  const treffer = [];
  for (const f of module_()) {
    const src = fs.readFileSync(path.join(JS, f), 'utf8');
    src.split('\n').forEach((z, i) => {
      if (z.includes('class="dr"')) treffer.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(
    treffer,
    [],
    'Diese Stellen bauen die Detailzeile selbst:\n  ' +
      treffer.join('\n  ') +
      `\nSie gehört in ${COMPONENT} — detailRow(label, wert, optionen).`,
  );
});

test('die Ladeanzeige wird nirgends mehr von Hand gebaut', () => {
  const treffer = [];
  for (const f of module_()) {
    const src = fs.readFileSync(path.join(JS, f), 'utf8');
    src.split('\n').forEach((z, i) => {
      if (z.includes('class="loading"')) treffer.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(
    treffer,
    [],
    'Diese Stellen bauen die Ladeanzeige selbst:\n  ' +
      treffer.join('\n  ') +
      `\nSie gehört in ${COMPONENT} — loadDisplay(text, optionen).`,
  );
});

test('der Baustein erzeugt das Markup, das die Stylesheets erwarten', async () => {
  // Nicht der Wortlaut der Funktion, sondern ihr Ergebnis, am Bündel in jsdom.
  const { w, d } = await openUi();
  try {
    const host = d.createElement('div');
    host.innerHTML = String(w.__build.detailRow('Jahr', '2021')) + String(w.__build.loadDisplay(''));
    assert.equal(host.querySelector('.dr > .dl')?.textContent.trim(), 'Jahr');
    assert.equal(host.querySelector('.dr > .dv')?.textContent.trim(), '2021');
    assert.ok(host.querySelector('.lade-geruest[role="status"] .skelett-zeile'), host.innerHTML);
    // Und die Stylesheets kennen jede Klasse, die herauskommt.
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
    for (const regel of ['.dr', '.dl', '.dv', '.lade-geruest', '.skelett-zeile'])
      assert.ok(new RegExp('\\' + regel + '[\\s,{:]').test(css), `styles.css kennt ${regel} nicht`);
  } finally {
    w.close();
  }
});
