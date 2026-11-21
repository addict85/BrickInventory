/**
 * The same names and spellings as the Android app: „Bauliste“ / „Build
 * list“ instead of „Teileliste“, quantities as „×N“, condition „Neuware“ instead of „Neu“.
 * On the real bundle in jsdom, in both languages.
 *
 * Counter-checks (measured 02.11.2026, each on its own):
 *   A  nav.partslist (de) again „Teileliste“ → red: “de: Bauliste …”
 *   B  partsCard again `${…}×` → red: “parts tile shows ×N”
 *   C  common.condition_new (de) again „Neu“ → red: “de: Bauliste …”
 *   D  gallery.add.number (de) again „Set-Nummer *“ → red: “de: set number without
 *      hyphen” (08.11.2026)
 *   E  data-i18n-attr="placeholder" removed in the storage location field → red: “en: placeholder
 *      of the storage location field” (it would remain „Neuer Lagerort“)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, reiter, warte } = require('./helpers/ui');

for (const [sprache, bauliste, neu] of [
  ['de', 'Bauliste', 'Neuware'],
  ['en', 'Build list', 'New'],
]) {
  test(`${sprache}: ${bauliste} in bar and heading, condition “${neu}”`, async () => {
    const { w, d } = await openUi({}, { sprache });
    try {
      assert.equal(d.querySelector('.ntab[data-tab="partslist"] .tab-label').textContent.trim(), bauliste);
      assert.equal(d.querySelector('#tab-partslist .ptitle').textContent.trim(), bauliste);
      assert.equal(d.querySelector('#add-condition option[value="N"]').textContent.trim(), neu);
    } finally {
      w.close();
    }
  });
}

test('parts tile shows ×N', async () => {
  const { w, d } = await openUi({
    '/v1/parts': {
      success: true,
      total: 1,
      parts: [{ part_number: '3001', part_name: 'Brick 2 x 4', color_id: 5, color_name: 'Red', total_quantity: 12 }],
    },
  });
  try {
    await reiter(w, 'parts');
    await warte(() => !!d.querySelector('.part-card .part-qty'));
    assert.equal(d.querySelector('.part-card .part-qty').textContent.trim(), '×12');
  } finally {
    w.close();
  }
});

test('de: set number without hyphen, as in the Android app', async () => {
  const { w, d } = await openUi({});
  try {
    const texte = [
      d.body.textContent,
      ...[...d.querySelectorAll('[placeholder], [aria-label]')].map(
        e => `${e.getAttribute('placeholder') ?? ''} ${e.getAttribute('aria-label') ?? ''}`,
      ),
    ].join('\n');
    assert.match(texte, /Setnummer/, 'die Oberfläche nennt die Setnummer gar nicht');
    assert.doesNotMatch(texte, /Set-Nummer/);
    assert.equal(d.querySelector('label[for="add-num"]').textContent.trim(), 'Setnummer *');
  } finally {
    w.close();
  }
});

test('en: placeholder of the storage location field', async () => {
  const { w, d } = await openUi({}, { sprache: 'en' });
  try {
    await warte(() => d.documentElement.lang === 'en');
    assert.equal(d.getElementById('storage-new').getAttribute('placeholder'), 'New storage location');
  } finally {
    w.close();
  }
});
