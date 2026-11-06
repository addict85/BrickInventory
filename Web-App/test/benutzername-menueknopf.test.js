/**
 * Die drei Striche stecken IM Benutzernamen — und bleiben dort.
 * Ausführlich: docs/begruendungen/test/benutzername-menueknopf.test.js.md#kopf
 *
 * ── Gegenproben (durchgeführt, Ergebnisse abgeschrieben) ────────────────────
 *
 * A  Name und Striche zu EINEM Element verschmolzen, das `ubadge` heisst:
 *      <button class="ubadge" id="ubadge" data-click="benutzerMenue">— ☰</button>
 *    → „die Striche stecken im Knopf"        GRÜN  (die Glyphe ist ja drin)
 *      „die Striche überleben den Namen"     rot: „Die drei Striche sind nach
 *                                            dem Setzen des Namens verschwunden"
 *      „sagt einem Bildschirmleser …"        rot (keine eigene Glyphe, die man
 *                                            verstecken könnte)
 *
 * B  die Glyphe aus dem Knopf entfernt      → alle drei rot
 *
 * C  zurück zum alten, getrennten Aufbau (Plakette, daneben ein Knopf):
 *    → „die Striche stecken im Knopf"        rot: „Name und Striche sind
 *                                            wieder getrennt"
 *      „die Striche überleben den Namen"     rot
 *      „sagt einem Bildschirmleser …"        GRÜN — und das ist richtig so:
 *                                            der alte Knopf war barrierefrei,
 *                                            er war nur nicht der Namenszug.
 *
 * A ist der Fall, auf den es ankommt: Dort bleibt Fall 1 grün und nur Fall 2
 * fällt. Die beiden messen also wirklich Verschiedenes — „die Striche sind im
 * Knopf" und „sie bleiben dort, wenn sich jemand anmeldet".
 *
 * Und eine Gegenprobe, die NICHTS gemessen hat, als Warnung: Beim ersten
 * Versuch suchte die Prüfung den Knopf über `getElementById('btn-umenu')` und
 * die Variante gab dem Knopf versehentlich zwei `id`-Attribute. Der Parser
 * nimmt das erste, `btn-umenu` war damit gar nicht da, und alle drei Fälle
 * fielen über `assert.ok(knopf)` — aus formalem Grund, nicht am Schaden. Drei
 * rote Fälle sahen nach einer scharfen Prüfung aus und waren eine kaputte
 * Vorlage. Daher die Suche über `data-click`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
/** Die Striche sind seit dem 27.10. ein Symbol der Symbolfamilie statt „☰“. */
const striche = (knopf) => knopf.querySelector('.ubadge-striche use[href="#i-menue"]');

function kopfleiste() {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const auf = html.indexOf('<header');
  const zu = html.indexOf('</header>');
  assert.ok(auf > 0 && zu > auf, 'Kein <header> in index.html — greift die Suche noch?');
  return new JSDOM('<!doctype html><html><body>' + html.slice(auf, zu + 9) + '</body></html>');
}

/**
 * Den Menüknopf über seinen HANDLER finden, nicht über die ID.
 * Ausführlich: docs/begruendungen/test/benutzername-menueknopf.test.js.md#menueknopf
 */
function menueKnopf(document) {
  const knopf = document.querySelector('[data-click="benutzerMenue"]');
  assert.ok(knopf, 'Kein Element mit data-click="benutzerMenue" in der Kopfleiste');
  assert.equal(knopf.tagName, 'BUTTON');
  return knopf;
}

test('die Striche stecken im Knopf, nicht daneben', () => {
  const { document } = kopfleiste().window;
  const knopf = menueKnopf(document);

  assert.ok(striche(knopf),
    'Die drei Striche stehen nicht im Menüknopf — sind sie wieder ein eigenes Element daneben?');

  // Und der Name steht im SELBEN Knopf. Genau das ist „integrieren": nicht
  // zwei Elemente, die nebeneinander liegen, sondern eines.
  const name = document.getElementById('ubadge');
  assert.ok(name, 'Kein #ubadge in der Kopfleiste');
  assert.ok(knopf.contains(name),
    'Der Namenszug liegt nicht im Menüknopf — Name und Striche sind wieder getrennt');
});

test('die Striche überleben den Benutzernamen', () => {
  const { document } = kopfleiste().window;
  const knopf = menueKnopf(document);
  const name = document.getElementById('ubadge');
  assert.ok(name, 'Kein #ubadge — 01-konto.js schreibt den Namen genau dorthin');

  // Genau was 01-konto.js in showApp() tut.
  name.textContent = 'marco';

  assert.ok(striche(knopf),
    'Die drei Striche sind nach dem Setzen des Namens verschwunden — ' +
    'liegt `id="ubadge"` am Knopf statt am inneren Feld?');
  assert.ok(knopf.textContent.includes('marco'),
    'Der Benutzername steht nach dem Setzen nicht im Knopf');
});

test('der Knopf sagt einem Bildschirmleser, dass er ein Menü ist', () => {
  const { document } = kopfleiste().window;
  const knopf = menueKnopf(document);

  // Die ID bleibt gefordert: menueSchliessen() und benutzerMenue() in
  // js/02-gallery.js führen `aria-expanded` über G('btn-umenu') mit.
  assert.equal(knopf.id, 'btn-umenu',
    'Der Menüknopf heißt nicht mehr `btn-umenu` — 02-gallery.js führt `aria-expanded` darüber mit');

  assert.equal(knopf.getAttribute('aria-haspopup'), 'true');
  assert.equal(knopf.getAttribute('aria-expanded'), 'false',
    'Zu Beginn ist das Menü zu — `aria-expanded` muss das sagen');
  assert.equal(knopf.getAttribute('aria-controls'), 'umenu-pop');

  // KEIN aria-label: Das ersetzt den sichtbaren Namen, der Bildschirmleser
  // hätte den Benutzernamen dann gar nicht mehr genannt. Der Zusatz steht
  // stattdessen als vorgelesener Text im Knopf.
  assert.equal(knopf.getAttribute('aria-label'), null,
    'Ein `aria-label` am Knopf würde den Benutzernamen für Bildschirmleser verdecken');

  const zusatz = knopf.querySelector('.vh');
  assert.ok(zusatz && zusatz.textContent.trim().length >= 2,
    'Der vorgelesene Zusatz („Menü") fehlt — der Knopf hiesse dann nur „marco ☰"');

  // Die Striche selbst sind für einen Bildschirmleser nichts wert.
  const glyphe = knopf.querySelector('.ubadge-striche');
  assert.ok(glyphe, 'Kein .ubadge-striche im Knopf');
  assert.equal(glyphe.getAttribute('aria-hidden'), 'true',
    '„☰" vorgelesen ergibt nichts — die Glyphe gehört versteckt');
});

/**
 * Nachtrag vom 17.10.: der Verwalter-Hinweis steht IM Namen
 * Ausführlich: docs/begruendungen/test/benutzername-menueknopf.test.js.md#der-namenszug-traegt-den-verwalter-hinwe
 *
 * Gegenproben (durchgeführt): `ME.isAdmin` in der Bedingung durch `true`
 * ersetzt → „ohne Verwalterrecht steht nur der Name" rot. Den Zusatz ganz
 * entfernt → „mit Verwalterrecht steht (Admin) dahinter" rot.
 */
test('der Namenszug trägt den Verwalter-Hinweis, die Kachel ist weg', () => {
  const { document } = kopfleiste().window;
  assert.equal(document.getElementById('abadge'), null,
    'Die Admin-Plakette steht wieder in der Kopfleiste — dann sagt sie dasselbe ' +
    'wie der Name daneben, und das Menü sitzt nicht mehr ganz rechts.');

  // Der Namensknopf ist das LETZTE Element der Reihe.
  const reihe = document.querySelector('.umenu');
  assert.ok(reihe, 'Keine .umenu in der Kopfleiste');
  const letztes = [...reihe.children].at(-1);
  assert.ok(letztes.contains(document.getElementById('btn-umenu')),
    'Nach dem Menüknopf steht noch etwas in der Reihe — dann ist er nicht ganz rechts.');
});

test('mit Verwalterrecht steht (Admin) dahinter, ohne nur der Name', () => {
  // Geprüft wird die QUELLE und nicht ein nachgebauter Ablauf: zeigeBenutzernamen()
  // hängt an ME und am Sprachtext, beides gibt es hier nicht. Was zählt, ist,
  // dass die Regel beide Fälle unterscheidet — und dass sie nur EINMAL dasteht.
  const core = fs.readFileSync(path.join(ROOT, 'public', 'js', '01-konto.js'), 'utf8');
  const fn = core.slice(core.indexOf('export function zeigeBenutzernamen'));
  const rumpf = fn.slice(0, fn.indexOf('\n}'));
  assert.ok(rumpf.includes('ME.isAdmin'),
    'zeigeBenutzernamen() unterscheidet nicht nach Verwalterrecht — dann trägt ' +
    'entweder jeder den Hinweis oder niemand.');
  assert.match(rumpf, /\$\{ME\.username\} \(\$\{tRaw\('users\.admin_badge'\)\}\)/,
    'Der Zusatz steht nicht als „Name (Admin)" da.');
  assert.match(rumpf, /:\s*ME\.username/,
    'Ohne Verwalterrecht steht nicht nur der Name da.');
  assert.ok(rumpf.includes("tRaw('users.admin_badge')"),
    'Der Zusatz ist ein Literal statt eines Sprachtextes — eine englische ' +
    'Oberfläche zeigte dann deutsches „Admin".');

  // EINE Stelle, die schreibt. 05-settings.js rief früher von Hand
  // `uel.textContent = username` auf — und hatte dabei schon einmal den
  // falschen Elementnamen, jahrelang unbemerkt.
  const settings = fs.readFileSync(path.join(ROOT, 'public', 'js', '05-settings.js'), 'utf8');
  assert.ok(settings.includes('zeigeBenutzernamen()'),
    'Die Profilseite setzt den Namen wieder selbst — dann schneidet sie den ' +
    'Verwalter-Hinweis beim Speichern ab.');
  assert.doesNotMatch(settings, /uel\.textContent\s*=/,
    'In 05-settings.js steht wieder eine eigene Fassung der Regel.');
});
