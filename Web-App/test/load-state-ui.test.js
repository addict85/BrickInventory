/**
 * Bei langsamem Netz zeigt die Oberfläche sofort, dass etwas kommt: Das
 * Set-Detail öffnet gleich mit Platzhalter, die Merkliste zeigt
 * Platzhalterzeilen – vorher blieb beides bis zur Antwort leer bzw. zu.
 *
 * Gegenproben (02.11.2026 gemessen, je einzeln):
 *   A  in openModal() das sofortige Öffnen entfernt → rot: „Set-Detail …“
 *      (Dialog vor der Antwort zu)
 *   B  in ladeMerkliste() die Platzhalterzeilen entfernt → rot: „Merkliste …“
 *   C  Lauf-Prüfung in openModal() entfernt → rot: „Set-Detail: geschlossen
 *      bleibt geschlossen“ (Dialog ging nach der Antwort wieder auf)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, reiter, takt, warte } = require('./helpers/ui');

const SET = {
  success: true,
  set: { set_number: '10294-1', name: 'Titanic', quantity: 1, instructions: [], owners: [] },
};
const spaeter =
  (antwort, ms = 400) =>
  () =>
    new Promise(r => setTimeout(() => r(antwort), ms));

async function detail(o) {
  const k = o.d.createElement('button');
  k.dataset.click = 'openModal';
  k.dataset.arg = '10294-1';
  o.d.body.append(k);
  k.click();
  await takt(30);
}

test('set detail opens immediately with a placeholder', async () => {
  const o = await openUi({
    '/v1/sets/10294-1': spaeter(SET),
    '/v1/sets/10294-1/acquisitions': { success: true, acquisitions: [] },
  });
  try {
    await detail(o);
    assert.equal(o.d.getElementById('set-modal').classList.contains('open'), true, 'Dialog vor der Antwort zu');
    assert.ok(o.d.querySelector('#m-det .skelett-liste[aria-busy="true"]'), 'kein Platzhalter');
    assert.equal(o.d.getElementById('m-tit').textContent, '10294-1');
    await warte(() => o.d.getElementById('m-tit').textContent === 'Titanic');
    assert.equal(o.d.querySelector('#m-det .skelett-liste'), null, 'Platzhalter blieb stehen');
  } finally {
    o.w.close();
  }
});

test('set detail: closed stays closed', async () => {
  const o = await openUi({
    '/v1/sets/10294-1': spaeter(SET),
    '/v1/sets/10294-1/acquisitions': { success: true, acquisitions: [] },
  });
  try {
    await detail(o);
    o.d.getElementById('set-modal').classList.remove('open');
    assert.ok(await o.ruhig(), 'die Antwort kam nicht');
    assert.equal(o.d.getElementById('set-modal').classList.contains('open'), false);
  } finally {
    o.w.close();
  }
});

test('wishlist shows placeholder rows until the list is there', async () => {
  const liste = {
    success: true,
    merkposten: [{ set_number: '10276-1', condition: 'N', name: 'Kolosseum', added_at: '2026-10-01T00:00:00Z' }],
  };
  const o = await openUi({ '/v1/wanted': spaeter(liste) });
  try {
    await reiter(o.w, 'wanted');
    assert.ok(o.d.querySelector('#mk-list .skelett-liste[aria-busy="true"]'), 'keine Platzhalter');
    await warte(() => o.d.querySelector('#mk-list .mk-zeile'));
    assert.equal(o.d.querySelector('#mk-list .skelett-liste'), null);
  } finally {
    o.w.close();
  }
});
