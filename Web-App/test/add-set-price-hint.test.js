/**
 * "Set hinzufügen": the purchase price field carries a hint that an empty value
 * becomes the market price — the same rule the parts and minifigure dialogs
 * already state (`parts.add.price_placeholder`). On the real bundle in jsdom.
 *
 * Counter-check (measured 23.11.2026): the hint span removed from the add-set
 * dialog markup → red: "the label names the rule" (no element with the text found).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, tick } = require('./helpers/ui');

async function openAddSetDialog(language = 'de') {
  const o = await openUi({}, { language });
  o.d.querySelector('[data-click="openCapture"][data-arg="set"]').click();
  await tick(20);
  return o;
}

test('the label names the rule: empty price = market price', async () => {
  const o = await openAddSetDialog('de');
  const label = o.d.querySelector('label[for="add-price"]');
  assert.match(label.textContent, /Marktpreis/, `label was "${label.textContent}"`);
  o.w.close();
});

test('English: the label names the rule', async () => {
  const o = await openAddSetDialog('en');
  const label = o.d.querySelector('label[for="add-price"]');
  assert.match(label.textContent, /market price/, `label was "${label.textContent}"`);
  o.w.close();
});
