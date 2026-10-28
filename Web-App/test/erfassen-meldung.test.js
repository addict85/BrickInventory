/**
 * Nach dem Erfassen sagt die Meldung, was wirklich geschehen ist: Fehlen die
 * Katalogdaten (kein Netz zu Rebrickable/Brickset), heisst es „gespeichert —
 * Name und Bild kommen nach“ statt „hinzugefügt!“. Am echten Bündel in jsdom.
 *
 * Gegenprobe (am 28.10.2026 gemessen): in 02-gallery.js katalog_offen nicht
 * ausgewertet → rot: „ohne Katalogdaten“ (es kam „Set 99071-1 hinzugefügt!“).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, takt, warte } = require('./helpers/oberflaeche');

async function erfasse(antwort) {
  const o = await oeffneOberflaeche({ '/v1/sets/add-stream': antwort });
  const { d, w } = o;
  d.querySelector('[data-click="oeffneErfassen"][data-arg="set"]').click();
  await takt(20);
  const feld = d.getElementById('add-num');
  feld.value = antwort.set_number;
  feld.dispatchEvent(new w.Event('input', { bubbles: true }));
  d.getElementById('btn-add').click();
  await warte(() => d.querySelector('#toasts .toast'), 3000);
  return o;
}

test('ohne Katalogdaten: gespeichert, Rest kommt nach', async () => {
  const { w, d } = await erfasse({ success: true, action: 'added', set_number: '99071-1', name: 'Set 99071-1', katalog_offen: true });
  try {
    const t = d.querySelector('#toasts .toast');
    assert.match(t.textContent, /99071-1 gespeichert — Name und Bild kommen nach/);
    assert.ok(t.classList.contains('info'), 'als Erfolg gemeldet');
  } finally { w.close(); }
});

test('mit Katalogdaten: hinzugefügt', async () => {
  const { w, d } = await erfasse({ success: true, action: 'added', set_number: '10294-1', name: 'Titanic', katalog_offen: false });
  try {
    assert.match(d.querySelector('#toasts .toast').textContent, /10294-1 hinzugefügt!/);
  } finally { w.close(); }
});
