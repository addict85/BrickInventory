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
const { warte } = require('./helpers/time');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const { BUNDLE_FILE, placeBundleSafe } = require('./helpers/bundle');
placeBundleSafe();
const BUNDLE = fs.readFileSync(BUNDLE_FILE, 'utf8');

async function fenster() {
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
function takt() {
  return warte(0);
}
const taste = (w, key, shiftKey = false) =>
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key, shiftKey, bubbles: true }));

test('every dialog has exactly one close button for Escape', async () => {
  const w = await fenster();
  try {
    const ovl = [...w.document.querySelectorAll('.ovl')];
    assert.ok(ovl.length >= 12, `nur ${ovl.length} Dialoge gefunden — Markup umgebaut?`);
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
  const w = await fenster();
  try {
    const d = w.document,
      modal = d.getElementById('set-modal'),
      trigger = d.getElementById('btn-add');
    trigger.focus();
    modal.classList.add('open');
    await takt();
    assert.ok(modal.contains(d.activeElement), 'Der Fokus springt nicht in den Dialog');

    taste(w, 'Escape');
    await takt();
    assert.equal(modal.classList.contains('open'), false, 'Escape schliesst den Dialog nicht');
    assert.equal(d.activeElement, trigger, 'Fokus kehrt nicht zurück');
  } finally {
    w.close();
  }
});

test('Escape only closes the topmost — the question above the detail', async () => {
  const w = await fenster();
  try {
    const d = w.document,
      set = d.getElementById('set-modal'),
      frage = d.getElementById('confirm-modal');
    set.classList.add('open');
    frage.style.display = 'flex';
    d.getElementById('cd-cancel').onclick = () => {
      frage.style.display = 'none';
    };
    await takt();
    assert.equal(d.activeElement, d.getElementById('cd-cancel'), 'Erstfokus der Rückfrage ist „Abbrechen"');

    taste(w, 'Escape');
    await takt();
    assert.equal(frage.style.display, 'none', 'Die Rückfrage bleibt offen');
    assert.ok(set.classList.contains('open'), 'Der Detail-Dialog darunter wurde mitgeschlossen');
  } finally {
    w.close();
  }
});

test('Tab stays in the dialog', async () => {
  const w = await fenster();
  try {
    const d = w.document,
      frage = d.getElementById('confirm-modal');
    frage.style.display = 'flex';
    await takt();
    const ab = d.getElementById('cd-cancel'),
      ja = d.getElementById('cd-confirm');
    ja.focus();
    taste(w, 'Tab');
    assert.equal(d.activeElement, ab, 'Tab verlässt den Dialog nach dem letzten Knopf');
    taste(w, 'Tab', true);
    assert.equal(d.activeElement, ja, 'Umschalt+Tab verlässt den Dialog vor dem ersten Knopf');
    d.getElementById('btn-add').focus();
    taste(w, 'Tab');
    assert.ok(frage.contains(d.activeElement), 'Tab von ausserhalb holt den Fokus nicht zurück');
  } finally {
    w.close();
  }
});

test('Escape in an input field first only leaves the field', async () => {
  const w = await fenster();
  try {
    const d = w.document,
      modal = d.getElementById('wanted-xml-modal');
    modal.classList.add('open');
    await takt();
    // As in the preview: the correction field sits in a table cell.
    d.getElementById('wanted-xml-table').innerHTML =
      '<table><tbody><tr><td><input id="cell"></td></tr></tbody></table>';
    const field = d.getElementById('cell');
    field.focus();
    taste(w, 'Escape');
    await takt();
    assert.ok(modal.classList.contains('open'), 'Escape im Feld schliesst den Dialog — die Korrekturen wären weg');
    assert.notEqual(d.activeElement, field, 'Der Fokus bleibt im Feld');
    taste(w, 'Escape');
    await takt();
    assert.equal(modal.classList.contains('open'), false, 'Das zweite Escape schliesst nicht');
  } finally {
    w.close();
  }
});

test('Escape closes on the first press, even if the focus is in a field', async () => {
  // Add dialog: data-erstfokus sits on the set number. Previously it needed
  // two Escapes — the first only left the field (finding of the UI review).
  const w = await fenster();
  try {
    const d = w.document,
      modal = d.getElementById('add-set-modal');
    modal.classList.add('open');
    await takt();
    assert.equal(d.activeElement?.id, 'add-num', 'Der Erstfokus liegt nicht auf der Set-Nummer');
    taste(w, 'Escape');
    await takt();
    assert.equal(modal.classList.contains('open'), false, 'Das erste Escape schliesst nicht');
  } finally {
    w.close();
  }
});
