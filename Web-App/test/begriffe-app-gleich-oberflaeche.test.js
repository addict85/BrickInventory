/**
 * Dieselben Namen und Schreibweisen wie die Android-App: „Bauliste“ / „Build
 * list“ statt „Teileliste“, Mengen als „×N“, Zustand „Neuware“ statt „Neu“.
 * Am echten Bündel in jsdom, in beiden Sprachen.
 *
 * Gegenproben (02.11.2026 gemessen, je einzeln):
 *   A  nav.partslist (de) wieder „Teileliste“ → rot: „de: Bauliste …“
 *   B  partsCard wieder `${…}×` → rot: „Teilekachel zeigt ×N“
 *   C  common.condition_new (de) wieder „Neu“ → rot: „de: Bauliste …“
 *   D  gallery.add.number (de) wieder „Set-Nummer *“ → rot: „de: Setnummer ohne
 *      Bindestrich“ (08.11.2026)
 *   E  im Lagerort-Feld data-i18n-attr="placeholder" entfernt → rot: „en: Platzhalter
 *      des Lagerort-Felds“ (es bliebe „Neuer Lagerort“)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, reiter, warte } = require('./helpers/oberflaeche');

for (const [sprache, bauliste, neu] of [['de', 'Bauliste', 'Neuware'], ['en', 'Build list', 'New']]) {
  test(`${sprache}: ${bauliste} in Leiste und Überschrift, Zustand „${neu}“`, async () => {
    const { w, d } = await oeffneOberflaeche({}, { sprache });
    try {
      assert.equal(d.querySelector('.ntab[data-tab="partslist"] .tab-label').textContent.trim(), bauliste);
      assert.equal(d.querySelector('#tab-partslist .ptitle').textContent.trim(), bauliste);
      assert.equal(d.querySelector('#add-condition option[value="N"]').textContent.trim(), neu);
    } finally { w.close(); }
  });
}

test('Teilekachel zeigt ×N', async () => {
  const { w, d } = await oeffneOberflaeche({
    '/v1/parts': { success: true, total: 1, parts: [{ part_number: '3001', part_name: 'Brick 2 x 4', color_id: 5, color_name: 'Red', total_quantity: 12 }] },
  });
  try {
    await reiter(w, 'parts');
    await warte(() => !!d.querySelector('.part-card .part-qty'));
    assert.equal(d.querySelector('.part-card .part-qty').textContent.trim(), '×12');
  } finally { w.close(); }
});

test('de: Setnummer ohne Bindestrich, wie in der Android-App', async () => {
  const { w, d } = await oeffneOberflaeche({});
  try {
    const texte = [d.body.textContent, ...[...d.querySelectorAll('[placeholder], [aria-label]')]
      .map(e => `${e.getAttribute('placeholder') ?? ''} ${e.getAttribute('aria-label') ?? ''}`)].join('\n');
    assert.match(texte, /Setnummer/, 'die Oberfläche nennt die Setnummer gar nicht');
    assert.doesNotMatch(texte, /Set-Nummer/);
    assert.equal(d.querySelector('label[for="add-num"]').textContent.trim(), 'Setnummer *');
  } finally { w.close(); }
});

test('en: Platzhalter des Lagerort-Felds', async () => {
  const { w, d } = await oeffneOberflaeche({}, { sprache: 'en' });
  try {
    await warte(() => d.documentElement.lang === 'en');
    assert.equal(d.getElementById('storage-new').getAttribute('placeholder'), 'New storage location');
  } finally { w.close(); }
});
