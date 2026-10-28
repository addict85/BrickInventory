/**
 * Der Dialog „Set hinzufügen“ prüft die Set-Nummer vor dem Absenden und
 * meldet einen Fehler direkt am Feld — „abc“ wurde vorher als Set „abc-1“
 * angelegt, mit Erfolgsmeldung. Geprüft am echten Bündel in jsdom: Was das
 * Feld abweist, erreicht den Server nicht. Angenommen werden muss jede
 * Nummer, die der gemeinsame Korpus (shared/setnummer-korpus.json) als
 * Setnummer erwartet, dazu Buchstaben-Präfixe echter Nummern.
 *
 * Gegenproben (am 28.10. gemessen):
 *   A  in doAddSet() (02-gallery.js) die Prüfung entfernt → rot: „abc wird abgewiesen“
 *      und „falsche Formen werden abgewiesen“
 *   B  istSetnummer() ohne Buchstaben-Präfix (/^\d…/) → rot: „gültige Nummern gehen durch“ (llca30-1)
 *   C  feldFehler() ohne aria-invalid → rot: „abc wird abgewiesen“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { oeffneOberflaeche, takt } = require('./helpers/oberflaeche');

const KORPUS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'shared', 'setnummer-korpus.json'), 'utf8')).faelle;

async function versuche(o, nummer) {
  const { d, w, aufrufe } = o;
  d.querySelector('[data-click="oeffneErfassen"][data-arg="set"]').click();
  await takt(20);
  const feld = d.getElementById('add-num');
  feld.value = nummer;
  feld.dispatchEvent(new w.Event('input', { bubbles: true }));
  const vorher = aufrufe.length;
  d.getElementById('btn-add').click();
  await takt(30);
  const gesendet = aufrufe.slice(vorher).some(a => a.url.includes('/sets/add-stream'));
  const fehler = d.getElementById('add-num-fehler');
  return { gesendet, feld, fehler: fehler && !fehler.hidden ? fehler.textContent : '' };
}

test('abc wird abgewiesen, mit Meldung am Feld', async () => {
  const o = await oeffneOberflaeche({});
  try {
    const r = await versuche(o, 'abc');
    assert.equal(r.gesendet, false, '„abc“ ging an den Server');
    assert.match(r.fehler, /„abc“ ist keine Set-Nummer/);
    assert.equal(r.feld.getAttribute('aria-invalid'), 'true');
    assert.equal(r.feld.getAttribute('aria-describedby'), 'add-num-fehler');
    assert.equal(o.d.activeElement, r.feld, 'Der Fokus steht nicht im Feld');
    // Tippen räumt die Meldung weg.
    r.feld.value = '1';
    r.feld.dispatchEvent(new o.w.Event('input', { bubbles: true }));
    assert.equal(o.d.getElementById('add-num-fehler').hidden, true);
    // Leer: dieselbe Stelle, eigener Text.
    const leer = await versuche(o, '   ');
    assert.equal(leer.gesendet, false);
    assert.match(leer.fehler, /Set-Nummer eingeben/);
  } finally { o.w.close(); }
});

test('falsche Formen werden abgewiesen', async () => {
  const o = await oeffneOberflaeche({});
  try {
    for (const n of ['abc', 'fig-000123', '10294-', '10294-1-2', '-1', '10 294', '<b>1</b>']) {
      const r = await versuche(o, n);
      assert.equal(r.gesendet, false, `„${n}“ ging an den Server`);
    }
  } finally { o.w.close(); }
});

test('gültige Nummern gehen durch', async () => {
  const o = await oeffneOberflaeche({});
  try {
    const korpus = KORPUS.map(f => f.erwartet).filter(Boolean);
    assert.ok(korpus.length >= 10, 'Korpus nicht gelesen');
    for (const n of [...korpus, '10294', '10294-1', ' 42143-1 ', 'llca30-1', 'comcon001', '6284070-1', '71000-12']) {
      const r = await versuche(o, n);
      assert.equal(r.gesendet, true, `„${n}“ wurde abgewiesen: ${r.fehler}`);
      assert.equal(r.fehler, '');
    }
  } finally { o.w.close(); }
});
