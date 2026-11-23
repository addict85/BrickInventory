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
const { openUi, tick } = require('./helpers/ui');

const CORPUS = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'shared', 'setnummer-korpus.json'), 'utf8'),
).faelle;

async function attempts(o, number) {
  const { d, w, calls } = o;
  d.querySelector('[data-click="openCapture"][data-arg="set"]').click();
  await tick(20);
  const field = d.getElementById('add-num');
  field.value = number;
  field.dispatchEvent(new w.Event('input', { bubbles: true }));
  const prior = calls.length;
  d.getElementById('btn-add').click();
  await tick(30);
  const sent = calls.slice(prior).some(a => a.url.includes('/sets/add-stream'));
  const error = d.getElementById('add-num-error');
  return { sent, field, error: error && !error.hidden ? error.textContent : '' };
}

test('abc is rejected, with a message at the field', async () => {
  const o = await openUi({});
  try {
    const r = await attempts(o, 'abc');
    assert.equal(r.sent, false, '„abc“ went to the server');
    assert.match(r.error, /„abc“ ist keine Setnummer/);
    assert.equal(r.field.getAttribute('aria-invalid'), 'true');
    assert.equal(r.field.getAttribute('aria-describedby'), 'add-num-error');
    assert.equal(o.d.activeElement, r.field, 'The focus is not in the field');
    // Typing clears the message away.
    r.field.value = '1';
    r.field.dispatchEvent(new o.w.Event('input', { bubbles: true }));
    assert.equal(o.d.getElementById('add-num-error').hidden, true);
    // Empty: the same place, own text.
    const empty = await attempts(o, '   ');
    assert.equal(empty.sent, false);
    assert.match(empty.error, /Setnummer eingeben/);
  } finally {
    o.w.close();
  }
});

test('wrong forms are rejected', async () => {
  const o = await openUi({});
  try {
    for (const n of ['abc', 'fig-000123', '10294-', '10294-1-2', '-1', '10 294', '<b>1</b>']) {
      const r = await attempts(o, n);
      assert.equal(r.sent, false, `„${n}“ went to the server`);
    }
  } finally {
    o.w.close();
  }
});

test('valid numbers pass', async () => {
  const o = await openUi({});
  try {
    const corpus = CORPUS.map(f => f.erwartet).filter(Boolean);
    assert.ok(corpus.length >= 10, 'corpus not read');
    for (const n of [...corpus, '10294', '10294-1', ' 42143-1 ', 'llca30-1', 'comcon001', '6284070-1', '71000-12']) {
      const r = await attempts(o, n);
      assert.equal(r.sent, true, `„${n}“ was rejected: ${r.error}`);
      assert.equal(r.error, '');
    }
  } finally {
    o.w.close();
  }
});
