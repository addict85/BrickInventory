/**
 * Der BrickLink-Export der Teileliste — was er weglässt und was er sagt. Am
 * echten Bündel in jsdom: Bauliste erstellen, „BrickLink XML“ klicken, die
 * ausgelieferte Datei und die Meldungen lesen.
 * Ausführlich: docs/begruendungen/test/teileliste-bl-export.test.js.md#kopf
 *
 * Gegenproben (08.11.2026 gemessen, je einzeln, danach zurückgenommen):
 *   E  die Farbkette in plRenderTable wieder auf `?? p.color_id ?? ''` →
 *      rot: beide Fälle (COLOR 999 in der Datei, keine Meldung)
 *   F  statt `exportierbar` wieder `expanded` ins XML gegeben → rot: dieselbe
 *      Prüfung (Posten ohne COLOR in der Datei)
 *   G  die Erfolgsmeldung wieder als deutscher Text eingetippt → rot: „die
 *      Meldungen sind übersetzt“ (englische Oberfläche)
 *   H  der Export baut das XML wieder mit `<?xml …?>` davor → rot: „keine
 *      Rebrickable-Farbnummer …“ (Datei beginnt nicht mit <INVENTORY>)
 *   I  die Meldung pl.bl_no_color entfernt → rot: beide Fälle
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, reiter, warte } = require('./helpers/oberflaeche');

const ROT = {
  part_number: '3001',
  part_name: 'Brick 2 x 4',
  color_id: 4,
  color_name: 'Red',
  color_hex: 'C91A09',
  quantity: 6,
};
// Rebrickable-Farbe 999 kennt die Zuordnung nicht: Eine geratene Farbe bestellte das falsche Teil.
const UNBEKANNT = {
  part_number: '3002',
  part_name: 'Brick 2 x 3',
  color_id: 999,
  color_name: 'Mystery',
  color_hex: null,
  quantity: 2,
};

async function exportiere(sprache) {
  const o = await oeffneOberflaeche(
    {
      '/v1/sets/10294-1/parts-list': { success: true, parts: [ROT, UNBEKANNT] },
      '/v1/sets/10294-1/minifigs-list': { success: true, figs: [] },
      '/v1/sets/info/10294-1': { success: true, name: 'Titanic', im_katalog: true },
      '/v1/parts/bl-color-map': { success: true, map: { 4: 5 } },
    },
    { sprache },
  );
  const dateien = [];
  o.w.URL.createObjectURL = blob => {
    dateien.push(blob);
    return `blob:test/${dateien.length}`;
  };
  o.w.URL.revokeObjectURL = () => {};
  o.w.open = () => ({});
  try {
    return await bedienen(o, dateien);
  } catch (e) {
    o.w.close();
    throw e;
  }
}

async function bedienen(o, dateien) {
  await reiter(o.w, 'partslist');
  o.d.getElementById('pl-setnr').value = '10294';
  o.d.querySelector('[data-click="plAddSet"]').click();
  await warte(() => o.d.querySelector('#pl-sets .pl-chip-name')?.textContent.trim(), 3000);
  o.d.getElementById('btn-pl-gen').click();
  assert.ok(await warte(() => o.d.querySelector('.pl-have-input'), 3000), 'Liste erstellt');
  o.d.getElementById('btn-pl-bl').click();
  assert.ok(
    await warte(() => dateien.length === 1 && o.d.querySelectorAll('#toasts .toast').length >= 2, 3000),
    'Kein Export',
  );
  const xml = await dateien[0].text();
  const meldungen = [...o.d.querySelectorAll('#toasts .toast')].map(t => ({ art: t.className, text: t.textContent }));
  return { ...o, xml, meldungen };
}

test('keine Rebrickable-Farbnummer wandert als BrickLink-Farbe hinaus — Posten ohne werden genannt', async () => {
  const { w, xml, meldungen } = await exportiere('de');
  try {
    // Ohne XML-Deklaration: BrickLink lehnt eine Datei mit ihr ab (bricklink-wanted-xml.test.js prüft das Bauteil).
    assert.ok(xml.startsWith('<INVENTORY>'), xml.slice(0, 60));
    assert.match(xml, /<ITEMID>3001<\/ITEMID>\s*<COLOR>5<\/COLOR>/, 'Die BrickLink-Farbe aus der Zuordnung');
    assert.doesNotMatch(xml, /3002|<COLOR>999<\/COLOR>|<COLOR>4<\/COLOR>/, xml);
    assert.equal((xml.match(/<ITEM>/g) || []).length, 1);
    const fehler = meldungen.find(m => /error/.test(m.art));
    assert.match(
      fehler?.text ?? '',
      /1 Posten ohne bekannte BrickLink-Farbe.*3002 \(Mystery\)/,
      JSON.stringify(meldungen),
    );
  } finally {
    w.close();
  }
});

test('die Meldungen sind übersetzt, nicht eingetippt', async () => {
  const { w, meldungen } = await exportiere('en');
  try {
    const texte = meldungen.map(m => m.text).join(' | ');
    assert.match(texte, /1 missing part types? exported/);
    assert.match(texte, /1 items? without a known BrickLink color/);
    assert.doesNotMatch(texte, /fehlende|Posten/);
  } finally {
    w.close();
  }
});
