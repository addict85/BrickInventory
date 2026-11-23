/**
 * Password fields belong in a <form> — and submitting must load nothing.
 *
 * ── Counter-checks (carried out) ──────────────────────────────────────────────
 *
 *   a) preventDefault() removed from the listener → case 2 red.
 *   b) type="button" removed on btn-login → case 3 red.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

/**
 * Cut only the form listener out of js/actions.js.
 *
 * The same technique as in test/app-scrollbar.test.js: evaluating the whole file
 * would mean rebuilding half the dispatcher including the registry. The
 * cut hangs on the comment marker — if it disappears, this test fails,
 * and that is intended: then the listener has been rebuilt.
 */
function listenerCode() {
  const raw = fs.readFileSync(path.join(ROOT, 'public', 'js', 'actions.js'), 'utf8');
  const from = raw.indexOf("  document.addEventListener('submit'");
  assert.ok(from > 0, 'The submit listener is no longer in js/actions.js');
  const until = raw.indexOf('});', raw.indexOf('button.click()', from)) + 3;
  const piece = raw.slice(from, until);
  assert.match(piece, /preventDefault/, 'The cut-out block is not the right one');
  return piece;
}

/** The real index.html in jsdom, with the listener in front. */
function stage() {
  const dom = new JSDOM(HTML, { runScripts: 'outside-only' });
  dom.window.eval(listenerCode());
  return dom;
}

test('every password field of a HUMAN lies in a form', () => {
  const d = new JSDOM(HTML).window.document;
  const fields = [...d.querySelectorAll('input[type=password]')];
  assert.ok(fields.length >= 13, `Only ${fields.length} password fields found — is the path right?`);

  const without = fields
    .filter(i => !i.closest('form'))
    .map(i => i.id)
    .sort();
  assert.deepEqual(
    without,
    ['bl-cs', 'bl-ts', 'bs-key', 'rb-key', 'smtp-pass'],
    'These password fields are in no form: ' +
      without.join(', ') +
      '\nAllowed are exactly the five interface secrets (BrickLink, Rebrickable, Brickset, SMTP) — ' +
      'see the head of this file. If a field of a HUMAN is listed here, the ' +
      'password manager no longer offers to save there.',
  );

  // And the opposite direction: the five must not have an `autocomplete` either
  // that marks them as login data after all.
  for (const id of without) {
    const ac = d.getElementById(id).getAttribute('autocomplete');
    assert.equal(
      ac,
      'off',
      `${id} carries autocomplete="${ac}" instead of "off" — then the form is not ` +
        'the reason why the password manager stays silent, and the decision above is shaky',
    );
  }
});

test('submitting does NOT reload the page but presses the button', () => {
  const dom = stage();
  const d = dom.window.document;
  const forms = [...d.querySelectorAll('form[data-submit]')];
  assert.ok(forms.length >= 6, `Only ${forms.length} forms with data-submit — expected at least six`);

  for (const f of forms) {
    const id = f.getAttribute('data-submit');
    const button = d.getElementById(id);
    assert.ok(button, `data-submit="${id}" points to no button`);
    assert.ok(f.contains(button), `The button ${id} is not inside its form at all`);

    let pressed = 0;
    button.addEventListener('click', () => {
      pressed++;
    });
    const ev = new dom.window.Event('submit', { bubbles: true, cancelable: true });
    f.dispatchEvent(ev);

    assert.equal(
      ev.defaultPrevented,
      true,
      `Submitting ${id} was NOT cancelled — the browser would reload the page ` +
        'and the logged-in state would be gone',
    );
    assert.equal(
      pressed,
      1,
      `The button ${id} was pressed ${pressed} times instead of exactly once. Zero means: ` +
        'the Enter key does nothing. More than once means: it goes round in circles.',
    );
  }
});

test('the submit buttons carry type="button"', () => {
  // The reason stands in the header: without type="button" a <button> in a
  // <form> is a SUBMIT button. The listener presses it, its click triggers
  // submit again, and so it goes on until the counter above counts more than one
  // or the browser aborts.
  const d = new JSDOM(HTML).window.document;
  const wrong = [];
  for (const f of d.querySelectorAll('form')) {
    for (const b of f.querySelectorAll('button')) {
      if (b.getAttribute('type') !== 'button') wrong.push(b.id || b.textContent.trim().slice(0, 20));
    }
  }
  assert.deepEqual(
    wrong,
    [],
    'These buttons in a form are submit buttons: ' +
      wrong.join(', ') +
      '\nWithout type="button" their click triggers a submit again.',
  );
});
