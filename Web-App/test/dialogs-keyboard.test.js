/**
 * Dialogs can be operated by keyboard: Escape closes the
 * topmost one, focus jumps inside, Tab stays inside, and on closing
 * focus returns (public/js/dialogs.js).
 *
 * Checked on the real bundle and the real markup in jsdom.
 *
 * Counter-checks (25.10., measured):
 *   A  data-dialog-close removed from the ✕ of the set dialog → red: guard and Escape
 *   B  Tab branch removed in tasteGedrueckt()      → red: “Tab leaves the dialog"
 *   C  focus return removed                        → red: “focus does not return"
 *   D  exception for input fields removed          → red: “Escape in the field closes"
 *   E  (28.10.) the exception again for every field instead of only for table cells
 *      → red: “the first Escape does not close"
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const jsdom = require(path.join(ROOT, 'node_modules', 'jsdom'));
const { sleep } = require('./helpers/time');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const { BUNDLE_FILE, placeBundleSafe } = require('./helpers/bundle');
placeBundleSafe();
const BUNDLE = fs.readFileSync(BUNDLE_FILE, 'utf8');

async function win() {
  const dom = new jsdom.JSDOM(HTML, { runScripts: 'outside-only', url: 'http://localhost/' });
  const w = dom.window;
  w.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => ({ success: true }),
  });
  w.eval(BUNDLE);
  // The bundle attaches to DOMContentLoaded at readyState 'loading'.
  if (w.document.readyState === 'loading') await new Promise(r => w.document.addEventListener('DOMContentLoaded', r));
  return w;
}

/** Let MutationObserver catch up. */
function tick() {
  return sleep(0);
}
const taste = (w, key, shiftKey = false) =>
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key, shiftKey, bubbles: true }));

test('every dialog has exactly one close button for Escape', async () => {
  const w = await win();
  try {
    const ovl = [...w.document.querySelectorAll('.ovl')];
    assert.ok(ovl.length >= 12, `only ${ovl.length} dialogs found — markup rebuilt?`);
    const error = [];
    for (const el of ovl) {
      if (el.getAttribute('role') !== 'dialog') error.push(`#${el.id}: role="dialog" fehlt`);
      const n = el.querySelectorAll('[data-dialog-close]').length;
      if (n !== 1) error.push(`#${el.id}: ${n}× data-dialog-close`);
    }
    assert.deepEqual(error, []);
  } finally {
    w.close();
  }
});

test('Escape closes, and the focus returns', async () => {
  const w = await win();
  try {
    const d = w.document,
      modal = d.getElementById('set-modal'),
      trigger = d.getElementById('btn-add');
    trigger.focus();
    modal.classList.add('open');
    await tick();
    assert.ok(modal.contains(d.activeElement), 'The focus does not jump into the dialog');

    taste(w, 'Escape');
    await tick();
    assert.equal(modal.classList.contains('open'), false, 'Escape does not close the dialog');
    assert.equal(d.activeElement, trigger, 'Focus does not return');
  } finally {
    w.close();
  }
});

test('Escape only closes the topmost — the question above the detail', async () => {
  const w = await win();
  try {
    const d = w.document,
      set = d.getElementById('set-modal'),
      question = d.getElementById('confirm-modal');
    set.classList.add('open');
    question.style.display = 'flex';
    d.getElementById('cd-cancel').onclick = () => {
      question.style.display = 'none';
    };
    await tick();
    assert.equal(d.activeElement, d.getElementById('cd-cancel'), 'Initial focus of the confirmation is „Abbrechen“');

    taste(w, 'Escape');
    await tick();
    assert.equal(question.style.display, 'none', 'The confirmation stays open');
    assert.ok(set.classList.contains('open'), 'The detail dialog below was closed along with it');
  } finally {
    w.close();
  }
});

test('Tab stays in the dialog', async () => {
  const w = await win();
  try {
    const d = w.document,
      question = d.getElementById('confirm-modal');
    question.style.display = 'flex';
    await tick();
    const ab = d.getElementById('cd-cancel'),
      yes = d.getElementById('cd-confirm');
    yes.focus();
    taste(w, 'Tab');
    assert.equal(d.activeElement, ab, 'Tab leaves the dialog after the last button');
    taste(w, 'Tab', true);
    assert.equal(d.activeElement, yes, 'Shift+Tab leaves the dialog before the first button');
    d.getElementById('btn-add').focus();
    taste(w, 'Tab');
    assert.ok(question.contains(d.activeElement), 'Tab from outside does not bring the focus back');
  } finally {
    w.close();
  }
});

test('Escape in an input field first only leaves the field', async () => {
  const w = await win();
  try {
    const d = w.document,
      modal = d.getElementById('wanted-xml-modal');
    modal.classList.add('open');
    await tick();
    // As in the preview: the correction field sits in a table cell.
    d.getElementById('wanted-xml-table').innerHTML =
      '<table><tbody><tr><td><input id="cell"></td></tr></tbody></table>';
    const field = d.getElementById('cell');
    field.focus();
    taste(w, 'Escape');
    await tick();
    assert.ok(
      modal.classList.contains('open'),
      'Escape in the field closes the dialog — the corrections would be gone',
    );
    assert.notEqual(d.activeElement, field, 'The focus stays in the field');
    taste(w, 'Escape');
    await tick();
    assert.equal(modal.classList.contains('open'), false, 'The second Escape does not close');
  } finally {
    w.close();
  }
});

test('Escape closes on the first press, even if the focus is in a field', async () => {
  // Add dialog: data-erstfokus sits on the set number. Previously it needed
  // two Escapes — the first only left the field (finding of the UI review).
  const w = await win();
  try {
    const d = w.document,
      modal = d.getElementById('add-set-modal');
    modal.classList.add('open');
    await tick();
    assert.equal(d.activeElement?.id, 'add-num', 'The initial focus is not on the set number');
    taste(w, 'Escape');
    await tick();
    assert.equal(modal.classList.contains('open'), false, 'The first Escape does not close');
  } finally {
    w.close();
  }
});
