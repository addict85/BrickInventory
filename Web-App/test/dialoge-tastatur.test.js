/**
 * Dialoge lassen sich mit der Tastatur bedienen: Escape schliesst den
 * obersten, der Fokus springt hinein, Tab bleibt darin, und beim Schliessen
 * kehrt der Fokus zurück (public/js/01-dialoge.js).
 *
 * Geprüft am echten Bündel und am echten Markup in jsdom.
 *
 * Gegenproben (25.10., gemessen):
 *   A  data-dialog-zu am ✕ des Set-Dialogs entfernt → rot: Wächter und Escape
 *   B  Tab-Zweig in tasteGedrueckt() entfernt       → rot: „Tab verlässt den Dialog"
 *   C  Fokus-Rückgabe entfernt                      → rot: „Fokus kehrt nicht zurück"
 *   D  Ausnahme für Eingabefelder entfernt          → rot: „Escape im Feld schliesst"
 *   E  (28.10.) die Ausnahme wieder für jedes Feld statt nur für Tabellenzellen
 *      → rot: „Das erste Escape schliesst nicht"
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const jsdom = require(path.join(ROOT, 'node_modules', 'jsdom'));
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const BUNDLE = fs.readFileSync(path.join(ROOT, 'public', 'js', 'app.bundle.js'), 'utf8');

async function fenster() {
  const dom = new jsdom.JSDOM(HTML, { runScripts: 'outside-only', url: 'http://localhost/' });
  const w = dom.window;
  w.fetch = async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' },
                           json: async () => ({ success: true }) });
  w.eval(BUNDLE);
  // Das Bündel hängt sich bei readyState 'loading' an DOMContentLoaded.
  if (w.document.readyState === 'loading')
    await new Promise(r => w.document.addEventListener('DOMContentLoaded', r));
  return w;
}

const takt = () => new Promise(r => setTimeout(r, 0));   // MutationObserver nachlaufen lassen
const taste = (w, key, shiftKey = false) =>
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key, shiftKey, bubbles: true }));

test('jeder Dialog hat genau einen Schliessen-Knopf für Escape', async () => {
  const w = await fenster();
  try {
    const ovl = [...w.document.querySelectorAll('.ovl')];
    assert.ok(ovl.length >= 12, `nur ${ovl.length} Dialoge gefunden — Markup umgebaut?`);
    const fehler = [];
    for (const el of ovl) {
      if (el.getAttribute('role') !== 'dialog') fehler.push(`#${el.id}: role="dialog" fehlt`);
      const n = el.querySelectorAll('[data-dialog-zu]').length;
      if (n !== 1) fehler.push(`#${el.id}: ${n}× data-dialog-zu`);
    }
    assert.deepEqual(fehler, []);
  } finally { w.close(); }
});

test('Escape schliesst, und der Fokus kehrt zurück', async () => {
  const w = await fenster();
  try {
    const d = w.document, modal = d.getElementById('set-modal'), ausloeser = d.getElementById('btn-add');
    ausloeser.focus();
    modal.classList.add('open');
    await takt();
    assert.ok(modal.contains(d.activeElement), 'Der Fokus springt nicht in den Dialog');

    taste(w, 'Escape');
    await takt();
    assert.equal(modal.classList.contains('open'), false, 'Escape schliesst den Dialog nicht');
    assert.equal(d.activeElement, ausloeser, 'Fokus kehrt nicht zurück');
  } finally { w.close(); }
});

test('Escape schliesst nur den obersten — die Rückfrage über dem Detail', async () => {
  const w = await fenster();
  try {
    const d = w.document, set = d.getElementById('set-modal'), frage = d.getElementById('confirm-modal');
    set.classList.add('open');
    frage.style.display = 'flex';
    d.getElementById('cd-cancel').onclick = () => { frage.style.display = 'none'; };
    await takt();
    assert.equal(d.activeElement, d.getElementById('cd-cancel'), 'Erstfokus der Rückfrage ist „Abbrechen"');

    taste(w, 'Escape');
    await takt();
    assert.equal(frage.style.display, 'none', 'Die Rückfrage bleibt offen');
    assert.ok(set.classList.contains('open'), 'Der Detail-Dialog darunter wurde mitgeschlossen');
  } finally { w.close(); }
});

test('Tab bleibt im Dialog', async () => {
  const w = await fenster();
  try {
    const d = w.document, frage = d.getElementById('confirm-modal');
    frage.style.display = 'flex';
    await takt();
    const ab = d.getElementById('cd-cancel'), ja = d.getElementById('cd-confirm');
    ja.focus();
    taste(w, 'Tab');
    assert.equal(d.activeElement, ab, 'Tab verlässt den Dialog nach dem letzten Knopf');
    taste(w, 'Tab', true);
    assert.equal(d.activeElement, ja, 'Umschalt+Tab verlässt den Dialog vor dem ersten Knopf');
    d.getElementById('btn-add').focus();
    taste(w, 'Tab');
    assert.ok(frage.contains(d.activeElement), 'Tab von ausserhalb holt den Fokus nicht zurück');
  } finally { w.close(); }
});

test('Escape in einem Eingabefeld verlässt zuerst nur das Feld', async () => {
  const w = await fenster();
  try {
    const d = w.document, modal = d.getElementById('wanted-xml-modal');
    modal.classList.add('open');
    await takt();
    // Wie in der Vorschau: das Korrekturfeld steht in einer Tabellenzelle.
    d.getElementById('wanted-xml-tabelle').innerHTML = '<table><tbody><tr><td><input id="zelle"></td></tr></tbody></table>';
    const feld = d.getElementById('zelle');
    feld.focus();
    taste(w, 'Escape');
    await takt();
    assert.ok(modal.classList.contains('open'), 'Escape im Feld schliesst den Dialog — die Korrekturen wären weg');
    assert.notEqual(d.activeElement, feld, 'Der Fokus bleibt im Feld');
    taste(w, 'Escape');
    await takt();
    assert.equal(modal.classList.contains('open'), false, 'Das zweite Escape schliesst nicht');
  } finally { w.close(); }
});

test('Escape schliesst beim ersten Druck, auch wenn der Fokus in einem Feld steht', async () => {
  // Erfassen-Dialog: data-erstfokus sitzt auf der Set-Nummer. Vorher brauchte
  // es zwei Escape — das erste verliess nur das Feld (Befund der UI-Prüfung).
  const w = await fenster();
  try {
    const d = w.document, modal = d.getElementById('add-set-modal');
    modal.classList.add('open');
    await takt();
    assert.equal(d.activeElement?.id, 'add-num', 'Der Erstfokus liegt nicht auf der Set-Nummer');
    taste(w, 'Escape');
    await takt();
    assert.equal(modal.classList.contains('open'), false, 'Das erste Escape schliesst nicht');
  } finally { w.close(); }
});
