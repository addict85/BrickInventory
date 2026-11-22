/**
 * The dialog „Set hinzufügen“ checks the set number before submitting and
 * reports an error directly at the field — „abc“ used to be created as set „abc-1“,
 * with a success message. Checked on the real bundle in jsdom: what the
 * field rejects does not reach the server. Every … must be accepted
 *
 * Counter-checks (measured on 28.10.):
 *   A  the check removed in doAddSet() (sammlung.js) → red: “abc is rejected”
 *      and “wrong forms are rejected”
 *   B  isSetnummer() without a letter prefix (/^\d…/) → red: “valid numbers pass” (llca30-1)
 *   C  feldFehler() without aria-invalid → red: “abc is rejected”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { openUi, takt } = require('./helpers/ui');

const CORPUS = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'shared', 'setnummer-korpus.json'), 'utf8'),
).faelle;

async function versuche(o, nummer) {
  const { d, w, aufrufe } = o;
  d.querySelector('[data-click="openCapture"][data-arg="set"]').click();
  await takt(20);
  const feld = d.getElementById('add-num');
  feld.value = nummer;
  feld.dispatchEvent(new w.Event('input', { bubbles: true }));
  const vorher = aufrufe.length;
  d.getElementById('btn-add').click();
  await takt(30);
  const gesendet = aufrufe.slice(vorher).some(a => a.url.includes('/sets/add-stream'));
  const fehler = d.getElementById('add-num-error');
  return { gesendet, feld, fehler: fehler && !fehler.hidden ? fehler.textContent : '' };
}

test('abc is rejected, with a message at the field', async () => {
  const o = await openUi({});
  try {
    const r = await versuche(o, 'abc');
    assert.equal(r.gesendet, false, '„abc“ ging an den Server');
    assert.match(r.fehler, /„abc“ ist keine Setnummer/);
    assert.equal(r.feld.getAttribute('aria-invalid'), 'true');
    assert.equal(r.feld.getAttribute('aria-describedby'), 'add-num-error');
    assert.equal(o.d.activeElement, r.feld, 'Der Fokus steht nicht im Feld');
    // Typing clears the message away.
    r.feld.value = '1';
    r.feld.dispatchEvent(new o.w.Event('input', { bubbles: true }));
    assert.equal(o.d.getElementById('add-num-error').hidden, true);
    // Empty: the same place, own text.
    const leer = await versuche(o, '   ');
    assert.equal(leer.gesendet, false);
    assert.match(leer.fehler, /Setnummer eingeben/);
  } finally {
    o.w.close();
  }
});

test('wrong forms are rejected', async () => {
  const o = await openUi({});
  try {
    for (const n of ['abc', 'fig-000123', '10294-', '10294-1-2', '-1', '10 294', '<b>1</b>']) {
      const r = await versuche(o, n);
      assert.equal(r.gesendet, false, `„${n}“ ging an den Server`);
    }
  } finally {
    o.w.close();
  }
});

test('valid numbers pass', async () => {
  const o = await openUi({});
  try {
    const korpus = CORPUS.map(f => f.erwartet).filter(Boolean);
    assert.ok(korpus.length >= 10, 'Korpus nicht gelesen');
    for (const n of [...korpus, '10294', '10294-1', ' 42143-1 ', 'llca30-1', 'comcon001', '6284070-1', '71000-12']) {
      const r = await versuche(o, n);
      assert.equal(r.gesendet, true, `„${n}“ wurde abgewiesen: ${r.fehler}`);
      assert.equal(r.fehler, '');
    }
  } finally {
    o.w.close();
  }
});
