/**
 * Recurring view parts stand in ONE place.
 *
 * Counter-checks (measured 08.11.2026): in detailRow `class="dv"` →
 * `class="value"` or the skeleton rows deleted in loadDisplay → red:
 * “the building block creates the markup the stylesheets expect”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const JS = path.join(__dirname, '..', 'public', 'js');
const COMPONENT = 'components.js';
const { buildTestBundle } = require('./helpers/bundle');
process.env.TEST_BUENDEL = buildTestBundle(
  'bausteine',
  "import { detailRow, loadDisplay } from './components.js';\nwindow.__build = { detailRow, loadDisplay };\n",
);
const { openUi } = require('./helpers/ui');

/** All frontend modules except the bundle and the building block itself. */
function module_() {
  const alle = fs.readdirSync(JS).filter(f => f.endsWith('.js'));
  const filtered = alle.filter(f => f !== 'app.bundle.js' && f !== COMPONENT);
  // Self-proof: if the loop finds nothing, every check below would be
  // silently green.
  assert.ok(filtered.length >= 10, `only ${filtered.length} frontend modules found — wrong path?`);
  return filtered;
}

test('the detail row is no longer built by hand anywhere', () => {
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
    `These places build the detail row themselves:\n  ${treffer.join('\n  ')}\nIt belongs in ${COMPONENT} — detailRow(label, value, options).`,
  );
});

test('the loading indicator is no longer built by hand anywhere', () => {
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
    `These places build the loading display themselves:\n  ${treffer.join('\n  ')}\nIt belongs in ${COMPONENT} — loadDisplay(text, options).`,
  );
});

test('the building block creates the markup the stylesheets expect', async () => {
  // Not the wording of the function but its result, on the bundle in jsdom.
  const { w, d } = await openUi();
  try {
    const host = d.createElement('div');
    host.innerHTML = String(w.__build.detailRow('Jahr', '2021')) + String(w.__build.loadDisplay(''));
    assert.equal(host.querySelector('.dr > .dl')?.textContent.trim(), 'Jahr');
    assert.equal(host.querySelector('.dr > .dv')?.textContent.trim(), '2021');
    assert.ok(host.querySelector('.load-skeleton[role="status"] .skeleton-row'), host.innerHTML);
    // And the stylesheets know every class that comes out.
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
    for (const regel of ['.dr', '.dl', '.dv', '.load-skeleton', '.skeleton-row'])
      assert.ok(new RegExp('\\' + regel + '[\\s,{:]').test(css), `styles.css does not know ${regel}`);
  } finally {
    w.close();
  }
});
