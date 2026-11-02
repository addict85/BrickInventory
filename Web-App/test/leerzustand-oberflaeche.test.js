/**
 * Eine leere Sammlung zeigt „Set hinzufügen“ genau einmal sichtbar: im
 * Leerzustand, wie bei Teilen und Minifiguren; der Knopf der Erfassen-Leiste
 * tritt dann zurück (styles.css). Am echten Bündel in jsdom, mit styles.css.
 *
 * Gegenproben (02.11.2026 gemessen):
 *   A  Knopf im Leerzustand entfernt → rot: „Set hinzufügen genau einmal“
 *      (sichtbar nur in der Leiste)
 *   B  Regel .tab:has(.empty.leer …) in styles.css entfernt → rot: „Set
 *      hinzufügen genau einmal“ (2) und „Teile und Minifiguren ebenso“ (2)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { oeffneOberflaeche, reiter, warte } = require('./helpers/oberflaeche');

const STIL = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
const mitStil = (w) => w.document.addEventListener('DOMContentLoaded', () => {
  const s = w.document.createElement('style'); s.textContent = STIL; w.document.head.append(s); });
const sichtbar = (w, sel) => [...w.document.querySelectorAll(sel)].filter(e => {
  for (let x = e; x && x.nodeType === 1; x = x.parentElement) if (w.getComputedStyle(x).display === 'none') return false;
  return true; });

test('Set hinzufügen genau einmal', async () => {
  const { w, d } = await oeffneOberflaeche({}, { vorher: mitStil });
  try {
    await warte(() => !!d.querySelector('#gallery .empty.leer'));
    const knoepfe = sichtbar(w, '#tab-gallery [data-click="oeffneErfassen"][data-arg="set"]');
    assert.equal(knoepfe.length, 1);
    assert.ok(knoepfe[0].closest('.empty.leer'), 'der sichtbare Knopf steht nicht im Leerzustand');
    assert.match(d.querySelector('#gallery .empty.leer').textContent, /Noch keine Sets.*Set hinzufügen/s);
  } finally { w.close(); }
});

test('Teile und Minifiguren ebenso', async () => {
  const { w } = await oeffneOberflaeche({}, { vorher: mitStil });
  try {
    for (const [tab, art] of [['parts', 'part'], ['minifigs', 'fig']]) {
      await reiter(w, tab);
      await warte(() => !!w.document.querySelector(`#tab-${tab} .empty.leer`));
      assert.equal(sichtbar(w, `#tab-${tab} [data-click="oeffneErfassen"][data-arg="${art}"]`).length, 1, tab);
    }
  } finally { w.close(); }
});
