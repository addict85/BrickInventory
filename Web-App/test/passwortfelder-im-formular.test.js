/**
 * Passwortfelder gehören in ein <form> — und das Absenden darf nichts laden.
 *
 * ── Marcos Browserfenster ───────────────────────────────────────────────────
 *
 *     [DOM] Password field is not contained in a form: (More info: <URL>)   ×13
 *
 * Kein Fehler, ein Hinweis — aber einer mit Folgen: Ohne umgebendes Formular
 * entscheidet der Browser nach Heuristik, ob der Passwortmanager Speichern
 * und Ausfüllen anbietet. Mal ja, mal nein, und niemand kann sagen warum.
 * Betroffen waren Anmeldung, Registrierung, Passwort-Zurücksetzen,
 * Passwort ändern, Benutzer anlegen und der Zurücksetzen-Dialog.
 *
 * ── Warum nicht alle dreizehn ───────────────────────────────────────────────
 *
 * Fünf bleiben bewusst draussen: `bl-cs`, `bl-ts` (BrickLink-Zugangsdaten),
 * `rb-key`, `bs-key` (Rebrickable, Brickset; seit dem 29.10. verdeckt) und
 * `smtp-pass`. Das sind SCHNITTSTELLEN-Geheimnisse, keine Passwörter
 * eines Menschen — sie tragen `autocomplete="off"`, und ein Formular drumherum
 * lüde den Passwortmanager dazu ein, sie als Anmeldedaten zu speichern. Der
 * Hinweis in der Konsole ist dort das kleinere Übel. Diese Prüfung hält beide
 * Seiten fest, damit die Entscheidung nicht versehentlich gekippt wird.
 *
 * ── Was beim Absenden passieren muss ────────────────────────────────────────
 *
 * Nichts. Die Oberfläche spricht über fetch() mit dem Server; ein echtes
 * Absenden lüde die Seite neu und verlöre den Zustand. Der delegierte
 * Lauscher in js/11-actions.js bricht deshalb ab und drückt stattdessen den
 * Knopf, den `data-submit` nennt — womit die EINGABETASTE im Passwortfeld
 * endlich anmeldet, statt nichts zu tun.
 *
 * Die Knöpfe tragen `type="button"`. Ohne das wären sie Absendeknöpfe, ihr
 * Klick löste wieder ein submit aus, und der Lauscher drehte sich im Kreis.
 * Genau das prüft der dritte Fall.
 *
 * ── Gegenproben (durchgeführt) ──────────────────────────────────────────────
 *
 *   a) preventDefault() aus dem Lauscher entfernt → Fall 2 rot.
 *   b) type="button" an btn-login entfernt → Fall 3 rot.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

/**
 * Nur den Formular-Lauscher aus js/11-actions.js herausschneiden.
 *
 * Dieselbe Technik wie in test/app-scrollbar.test.js: Die ganze Datei
 * auszuwerten hiesse, den halben Verteiler mitsamt Registry nachzubauen. Der
 * Schnitt haengt an der Kommentarmarke — verschwindet sie, faellt dieser Test
 * aus, und das ist gewollt: Dann ist der Lauscher umgebaut worden.
 */
function lauscherCode() {
  const roh = fs.readFileSync(path.join(ROOT, 'public', 'js', '11-actions.js'), 'utf8');
  const von = roh.indexOf("  document.addEventListener('submit'");
  assert.ok(von > 0, 'Der submit-Lauscher steht nicht mehr in js/11-actions.js');
  const bis = roh.indexOf('});', roh.indexOf('knopf.click()', von)) + 3;
  const stueck = roh.slice(von, bis);
  assert.match(stueck, /preventDefault/, 'Der herausgeschnittene Block ist nicht der richtige');
  return stueck;
}

/** Das echte index.html in jsdom, mit dem Lauscher davor. */
function buehne() {
  const dom = new JSDOM(HTML, { runScripts: 'outside-only' });
  dom.window.eval(lauscherCode());
  return dom;
}

test('jedes Passwortfeld eines MENSCHEN liegt in einem Formular', () => {
  const d = new JSDOM(HTML).window.document;
  const felder = [...d.querySelectorAll('input[type=password]')];
  assert.ok(felder.length >= 13, `Nur ${felder.length} Passwortfelder gefunden — stimmt der Pfad?`);

  const ohne = felder.filter(i => !i.closest('form')).map(i => i.id).sort();
  assert.deepEqual(ohne, ['bl-cs', 'bl-ts', 'bs-key', 'rb-key', 'smtp-pass'],
    'Diese Passwortfelder liegen in keinem Formular: ' + ohne.join(', ') +
    '\nErlaubt sind genau die fünf Schnittstellen-Geheimnisse (BrickLink, Rebrickable, Brickset, SMTP) — ' +
    'siehe den Kopf dieser Datei. Steht hier ein Feld eines MENSCHEN, bietet der ' +
    'Passwortmanager dort kein Speichern mehr an.');

  // Und die Gegenrichtung: Die fuenf duerfen auch kein `autocomplete` haben,
  // das sie doch wieder als Anmeldedaten ausweist.
  for (const id of ohne) {
    const ac = d.getElementById(id).getAttribute('autocomplete');
    assert.equal(ac, 'off',
      `${id} traegt autocomplete="${ac}" statt "off" — dann ist das Formular nicht ` +
      'der Grund, warum der Passwortmanager schweigt, und die Entscheidung oben wackelt');
  }
});

test('Absenden lädt die Seite NICHT neu, sondern drückt den Knopf', () => {
  const dom = buehne();
  const d = dom.window.document;
  const formulare = [...d.querySelectorAll('form[data-submit]')];
  assert.ok(formulare.length >= 6,
    `Nur ${formulare.length} Formulare mit data-submit — erwartet mindestens sechs`);

  for (const f of formulare) {
    const id = f.getAttribute('data-submit');
    const knopf = d.getElementById(id);
    assert.ok(knopf, `data-submit="${id}" zeigt auf keinen Knopf`);
    assert.ok(f.contains(knopf), `Der Knopf ${id} liegt gar nicht in seinem Formular`);

    let gedrueckt = 0;
    knopf.addEventListener('click', () => { gedrueckt++; });
    const ev = new dom.window.Event('submit', { bubbles: true, cancelable: true });
    f.dispatchEvent(ev);

    assert.equal(ev.defaultPrevented, true,
      `Das Absenden von ${id} wurde NICHT abgebrochen — der Browser lüde die Seite neu ` +
      'und der angemeldete Zustand wäre weg');
    assert.equal(gedrueckt, 1,
      `Der Knopf ${id} wurde ${gedrueckt}-mal gedrückt statt genau einmal. Null heisst: ` +
      'die Eingabetaste tut nichts. Mehr als einmal heisst: es dreht sich im Kreis.');
  }
});

test('die Absendeknöpfe tragen type="button"', () => {
  // Der Grund steht im Kopf: Ohne type="button" ist ein <button> in einem
  // <form> ein ABSENDEknopf. Der Lauscher drückt ihn, sein Klick löst wieder
  // submit aus, und das geht so weiter, bis der Zähler oben mehr als eins
  // zählt oder der Browser abbricht.
  const d = new JSDOM(HTML).window.document;
  const falsch = [];
  for (const f of d.querySelectorAll('form')) {
    for (const b of f.querySelectorAll('button')) {
      if (b.getAttribute('type') !== 'button') falsch.push(b.id || b.textContent.trim().slice(0, 20));
    }
  }
  assert.deepEqual(falsch, [],
    'Diese Knöpfe in einem Formular sind Absendeknöpfe: ' + falsch.join(', ') +
    '\nOhne type="button" löst ihr Klick wieder ein submit aus.');
});
