/**
 * After adding, the message says what really happened: if the
 * catalog data is missing (no network to Rebrickable/Brickset), it says “saved —
 * name and image follow” instead of “added!”. On the real bundle in jsdom.
 *
 * Counter-check (measured on 28.10.2026): katalog_offen not evaluated in sammlung.js
 * → red: “without catalog data” (it said “Set 99071-1 hinzugefügt!”).
 *
 * Counter-check (measured 08.11.2026): the key gallery.set_aktualisiert removed from
 * both language files → red: “updated” and “English: updated”
 * (the raw key appears); gallery.set_hinzugefuegt removed only in en.js
 * → red: “English: added”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, takt, warte } = require('./helpers/ui');

async function record(response, language = 'de') {
  const o = await openUi({ '/v2/sets/add-stream': response }, { language });
  const { d, w } = o;
  d.querySelector('[data-click="openCapture"][data-arg="set"]').click();
  await takt(20);
  const field = d.getElementById('add-num');
  field.value = response.set_number;
  field.dispatchEvent(new w.Event('input', { bubbles: true }));
  d.getElementById('btn-add').click();
  await warte(() => d.querySelector('#toasts .toast'), 3000);
  return o;
}

test('without catalog data: saved, the rest follows', async () => {
  const { w, d } = await record({
    success: true,
    action: 'added',
    set_number: '99071-1',
    name: 'Set 99071-1',
    catalog_pending: true,
  });
  try {
    const t = d.querySelector('#toasts .toast');
    assert.match(t.textContent, /99071-1 gespeichert — Name und Bild kommen nach/);
    assert.ok(t.classList.contains('info'), 'reported as success');
  } finally {
    w.close();
  }
});

test('with catalog data: added', async () => {
  const { w, d } = await record({
    success: true,
    action: 'added',
    set_number: '10294-1',
    name: 'Titanic',
    catalog_pending: false,
  });
  try {
    assert.match(d.querySelector('#toasts .toast').textContent, /10294-1 hinzugefügt!/);
  } finally {
    w.close();
  }
});

test('updated', async () => {
  const { w, d } = await record({
    success: true,
    action: 'updated',
    set_number: '10294-1',
    name: 'Titanic',
    catalog_pending: false,
  });
  try {
    assert.equal(d.querySelector('#toasts .toast .toast-text').textContent, 'Set 10294-1 aktualisiert!');
  } finally {
    w.close();
  }
});

test('English: added', async () => {
  const { w, d } = await record(
    { success: true, action: 'added', set_number: '10294-1', name: 'Titanic', catalog_pending: false },
    'en',
  );
  try {
    assert.equal(d.querySelector('#toasts .toast .toast-text').textContent, 'Set 10294-1 added!');
  } finally {
    w.close();
  }
});

test('English: updated', async () => {
  const { w, d } = await record(
    { success: true, action: 'updated', set_number: '10294-1', name: 'Titanic', catalog_pending: false },
    'en',
  );
  try {
    assert.equal(d.querySelector('#toasts .toast .toast-text').textContent, 'Set 10294-1 updated!');
  } finally {
    w.close();
  }
});
