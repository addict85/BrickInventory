/**
 * Wiederkehrende Ansichtsteile stehen an EINER Stelle.
 *
 * Gegenproben (08.11.2026 gemessen): in detailZeile `class="dv"` →
 * `class="wert"` bzw. in ladeAnzeige die Skelettzeilen gestrichen → rot:
 * „der Baustein erzeugt das Markup, das die Stylesheets erwarten“.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const JS = path.join(__dirname, '..', 'public', 'js');
const BAUSTEIN = 'bausteine.js';
const { baueTestbuendel } = require('./helpers/buendel');
process.env.TEST_BUENDEL = baueTestbuendel(
  'bausteine',
  "import { detailZeile, ladeAnzeige } from './bausteine.js';\nwindow.__bau = { detailZeile, ladeAnzeige };\n",
);
const { oeffneOberflaeche } = require('./helpers/oberflaeche');

/** Alle Frontend-Module ausser dem Bündel und dem Baustein selbst. */
function module_() {
  const alle = fs.readdirSync(JS).filter(f => f.endsWith('.js'));
  const gefiltert = alle.filter(f => f !== 'app.bundle.js' && f !== BAUSTEIN);
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
      `\nSie gehört in ${BAUSTEIN} — detailZeile(label, wert, optionen).`,
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
      `\nSie gehört in ${BAUSTEIN} — ladeAnzeige(text, optionen).`,
  );
});

test('der Baustein erzeugt das Markup, das die Stylesheets erwarten', async () => {
  // Nicht der Wortlaut der Funktion, sondern ihr Ergebnis, am Bündel in jsdom.
  const { w, d } = await oeffneOberflaeche();
  try {
    const wirt = d.createElement('div');
    wirt.innerHTML = String(w.__bau.detailZeile('Jahr', '2021')) + String(w.__bau.ladeAnzeige(''));
    assert.equal(wirt.querySelector('.dr > .dl')?.textContent.trim(), 'Jahr');
    assert.equal(wirt.querySelector('.dr > .dv')?.textContent.trim(), '2021');
    assert.ok(wirt.querySelector('.lade-geruest[role="status"] .skelett-zeile'), wirt.innerHTML);
    // Und die Stylesheets kennen jede Klasse, die herauskommt.
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
    for (const regel of ['.dr', '.dl', '.dv', '.lade-geruest', '.skelett-zeile'])
      assert.ok(new RegExp('\\' + regel + '[\\s,{:]').test(css), `styles.css kennt ${regel} nicht`);
  } finally {
    w.close();
  }
});
