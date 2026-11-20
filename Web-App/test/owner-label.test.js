/**
 * Das Besitzer-Etikett steht nur, wo ein ANDERES Konto des Haushalts mit
 * drinsteckt; die eigene Sammlung trägt keins. Und die Kopfzahl heisst
 * „Anleitungen“, nicht „Anleit.“. Geprüft am echten Bündel in jsdom.
 *
 * Gegenproben (am 28.10. gemessen):
 *   A  in ownerBadges() die Ausnahme für eigene Einträge entfernt → rot:
 *      „eigene Sets ohne Etikett“
 *   B  ownerBadges() gibt immer '' zurück → rot: „das Set des Kindes trägt seinen Namen“
 *   C  (13.11.2026) ownerBadges() wieder mit o.username statt accountDisplay() → rot:
 *      „das Set des Kindes trägt seinen Namen“ („anna“ statt „anna (ich)“)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, warte } = require('./helpers/ui');

const SET = (nr, name, owners) => ({ set_number: nr, name, quantity: 1, conditions: ['N'], instructions: [], owners });
const ANNA = { id: 1, username: 'anna' },
  EMILY = { id: 3, username: 'emily' };

async function galerie() {
  const o = await openUi({
    '/v1/sets/household-members': {
      success: true,
      members: [
        { ...ANNA, is_self: true, tiefe: 0 },
        { ...EMILY, is_self: false, tiefe: 1 },
      ],
    },
    '/v1/sets': {
      success: true,
      total: 3,
      themes: [],
      sets: [
        SET('10294-1', 'Titanic', [ANNA]),
        SET('42143-1', 'Ferrari', [EMILY]),
        SET('75192-1', 'Falke', [ANNA, EMILY]),
      ],
    },
  });
  await warte(() => o.d.querySelectorAll('#gallery .sc').length === 3);
  return o;
}
const labels = (d, nr) =>
  [...d.querySelector(`#gallery .sc[data-arg="${nr}"]`).querySelectorAll('.besitzer-badge')].map(e => e.textContent);

test('own sets without a label', async () => {
  const { w, d } = await galerie();
  try {
    assert.deepEqual(labels(d, '10294-1'), []);
  } finally {
    w.close();
  }
});

test("the child's set carries its name, a shared one both", async () => {
  const { w, d } = await galerie();
  try {
    assert.deepEqual(labels(d, '42143-1'), ['emily']);
    assert.deepEqual(labels(d, '75192-1'), ['anna (ich)', 'emily']);
  } finally {
    w.close();
  }
});

test('the metric is called instructions', async () => {
  const { w, d } = await openUi({});
  try {
    const l = d.getElementById('bstat-instr').parentElement.querySelector('.bstat-l');
    assert.equal(l.textContent, 'Anleitungen');
  } finally {
    w.close();
  }
});
