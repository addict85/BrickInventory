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
  const roh = fs.readFileSync(path.join(ROOT, 'public', 'js', 'actions.js'), 'utf8');
  const von = roh.indexOf("  document.addEventListener('submit'");
  assert.ok(von > 0, 'Der submit-Lauscher steht nicht mehr in js/actions.js');
  const bis = roh.indexOf('});', roh.indexOf('button.click()', von)) + 3;
  const stueck = roh.slice(von, bis);
  assert.match(stueck, /preventDefault/, 'Der herausgeschnittene Block ist nicht der richtige');
  return stueck;
}

/** The real index.html in jsdom, with the listener in front. */
function stage() {
  const dom = new JSDOM(HTML, { runScripts: 'outside-only' });
  dom.window.eval(listenerCode());
  return dom;
}

test('every password field of a HUMAN lies in a form', () => {
  const d = new JSDOM(HTML).window.document;
  const felder = [...d.querySelectorAll('input[type=password]')];
  assert.ok(felder.length >= 13, `Nur ${felder.length} Passwortfelder gefunden — stimmt der Pfad?`);

  const ohne = felder
    .filter(i => !i.closest('form'))
    .map(i => i.id)
    .sort();
  assert.deepEqual(
    ohne,
    ['bl-cs', 'bl-ts', 'bs-key', 'rb-key', 'smtp-pass'],
    'Diese Passwortfelder liegen in keinem Formular: ' +
      ohne.join(', ') +
      '\nErlaubt sind genau die fünf Schnittstellen-Geheimnisse (BrickLink, Rebrickable, Brickset, SMTP) — ' +
      'siehe den Kopf dieser Datei. Steht hier ein Feld eines MENSCHEN, bietet der ' +
      'Passwortmanager dort kein Speichern mehr an.',
  );

  // And the opposite direction: the five must not have an `autocomplete` either
  // that marks them as login data after all.
  for (const id of ohne) {
    const ac = d.getElementById(id).getAttribute('autocomplete');
    assert.equal(
      ac,
      'off',
      `${id} traegt autocomplete="${ac}" statt "off" — dann ist das Formular nicht ` +
        'der Grund, warum der Passwortmanager schweigt, und die Entscheidung oben wackelt',
    );
  }
});

test('submitting does NOT reload the page but presses the button', () => {
  const dom = stage();
  const d = dom.window.document;
  const forms = [...d.querySelectorAll('form[data-submit]')];
  assert.ok(forms.length >= 6, `Nur ${forms.length} Formulare mit data-submit — erwartet mindestens sechs`);

  for (const f of forms) {
    const id = f.getAttribute('data-submit');
    const knopf = d.getElementById(id);
    assert.ok(knopf, `data-submit="${id}" zeigt auf keinen Knopf`);
    assert.ok(f.contains(knopf), `Der Knopf ${id} liegt gar nicht in seinem Formular`);

    let gedrueckt = 0;
    knopf.addEventListener('click', () => {
      gedrueckt++;
    });
    const ev = new dom.window.Event('submit', { bubbles: true, cancelable: true });
    f.dispatchEvent(ev);

    assert.equal(
      ev.defaultPrevented,
      true,
      `Das Absenden von ${id} wurde NICHT abgebrochen — der Browser lüde die Seite neu ` +
        'und der angemeldete Zustand wäre weg',
    );
    assert.equal(
      gedrueckt,
      1,
      `Der Knopf ${id} wurde ${gedrueckt}-mal gedrückt statt genau einmal. Null heisst: ` +
        'die Eingabetaste tut nichts. Mehr als einmal heisst: es dreht sich im Kreis.',
    );
  }
});

test('the submit buttons carry type="button"', () => {
  // The reason stands in the header: without type="button" a <button> in a
  // <form> is a SUBMIT button. The listener presses it, its click triggers
  // submit again, and so it goes on until the counter above counts more than one
  // or the browser aborts.
  const d = new JSDOM(HTML).window.document;
  const falsch = [];
  for (const f of d.querySelectorAll('form')) {
    for (const b of f.querySelectorAll('button')) {
      if (b.getAttribute('type') !== 'button') falsch.push(b.id || b.textContent.trim().slice(0, 20));
    }
  }
  assert.deepEqual(
    falsch,
    [],
    'Diese Knöpfe in einem Formular sind Absendeknöpfe: ' +
      falsch.join(', ') +
      '\nOhne type="button" löst ihr Klick wieder ein submit aus.',
  );
});
