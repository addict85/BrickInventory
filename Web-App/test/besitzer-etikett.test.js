/**
 * Das Besitzer-Etikett steht nur, wo ein ANDERES Konto des Haushalts mit
 * drinsteckt; die eigene Sammlung trägt keins. Und die Kopfzahl heisst
 * „Anleitungen“, nicht „Anleit.“. Geprüft am echten Bündel in jsdom.
 *
 * Gegenproben (am 28.10. gemessen):
 *   A  in ownerBadges() die Ausnahme für eigene Einträge entfernt → rot:
 *      „eigene Sets ohne Etikett“
 *   B  ownerBadges() gibt immer '' zurück → rot: „das Set des Kindes trägt seinen Namen“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, warte } = require('./helpers/oberflaeche');

const SET = (nr, name, owners) => ({ set_number: nr, name, quantity: 1, conditions: ['N'], instructions: [], owners });
const ANNA = { id: 1, username: 'anna' }, EMILY = { id: 3, username: 'emily' };

async function galerie() {
  const o = await oeffneOberflaeche({
    '/v1/sets/household-members': { success: true, members: [{ ...ANNA, is_self: true, tiefe: 0 }, { ...EMILY, is_self: false, tiefe: 1 }] },
    '/v1/sets': { success: true, total: 3, themes: [], sets: [
      SET('10294-1', 'Titanic', [ANNA]), SET('42143-1', 'Ferrari', [EMILY]), SET('75192-1', 'Falke', [ANNA, EMILY])] },
  });
  await warte(() => o.d.querySelectorAll('#gallery .sc').length === 3);
  return o;
}
const etiketten = (d, nr) => [...d.querySelector(`#gallery .sc[data-arg="${nr}"]`).querySelectorAll('.besitzer-badge')].map(e => e.textContent);

test('eigene Sets ohne Etikett', async () => {
  const { w, d } = await galerie();
  try { assert.deepEqual(etiketten(d, '10294-1'), []); } finally { w.close(); }
});

test('das Set des Kindes trägt seinen Namen, ein geteiltes beide', async () => {
  const { w, d } = await galerie();
  try {
    assert.deepEqual(etiketten(d, '42143-1'), ['emily']);
    assert.deepEqual(etiketten(d, '75192-1'), ['anna', 'emily']);
  } finally { w.close(); }
});

test('die Kennzahl heisst Anleitungen', async () => {
  const { w, d } = await oeffneOberflaeche({});
  try {
    const l = d.getElementById('bstat-instr').parentElement.querySelector('.bstat-l');
    assert.equal(l.textContent, 'Anleitungen');
  } finally { w.close(); }
});
