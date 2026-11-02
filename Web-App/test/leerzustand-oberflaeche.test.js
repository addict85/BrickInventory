/**
 * Eine leere Sammlung zeigt „Set hinzufügen“ genau einmal: in der
 * Erfassen-Leiste, nicht noch einmal im Leerzustand darunter. Der Hinweis
 * nennt den Knopf. Am echten Bündel in jsdom.
 *
 * Gegenprobe (02.11.2026 gemessen): Knopf im Leerzustand zurück → rot:
 * „Set hinzufügen genau einmal“ (2).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, warte } = require('./helpers/oberflaeche');

test('Set hinzufügen genau einmal', async () => {
  const { w, d } = await oeffneOberflaeche();
  try {
    await warte(() => !!d.querySelector('#gallery .empty.leer'));
    const knoepfe = [...d.querySelectorAll('#tab-gallery [data-click="oeffneErfassen"][data-arg="set"]')];
    assert.equal(knoepfe.length, 1);
    assert.match(d.querySelector('#gallery .empty.leer').textContent, /Noch keine Sets.*Set hinzufügen/s);
  } finally { w.close(); }
});
