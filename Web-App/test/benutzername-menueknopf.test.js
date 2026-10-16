/**
 * Die drei Striche stecken IM Benutzernamen — und bleiben dort.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 *
 * Erst (16.10.): „die restlichen Seiten oben Rechts hinter dem Benutzernamen
 * als Aufklappbares Menu mit 3 - anzeigen." Gebaut wurde das als zwei Dinge
 * nebeneinander: die Namensplakette, und daneben ein Knopf mit „☰".
 *
 * Dann (17.10.): „kannst du die 3 Striche oben Rechts in den Benutzernamen
 * integrieren?" Seither IST der Namenszug der Knopf.
 *
 * ── Warum das eine Prüfung braucht ──────────────────────────────────────────
 *
 * Nicht wegen des Aussehens — das sieht man. Sondern wegen einer Falle, die
 * man NICHT sieht und die beim Bauen fast zugeschnappt ist:
 *
 *     01-core.js:827   G('ubadge').textContent = ME.username;
 *     05-settings.js   if (uel) uel.textContent = username;
 *
 * Beide Stellen schreiben den Namen über `textContent`. Das ersetzt den
 * GANZEN Inhalt des Elements. Läge `id="ubadge"` am Knopf — der nächstliegende
 * Umbau, wenn Name und Knopf eins werden —, dann wären die drei Striche in
 * dem Augenblick weg, in dem sich jemand anmeldet. Nicht beim Laden der
 * Seite, wo man es beim Entwickeln sähe: beim ANMELDEN. Wer die Seite mit
 * offener Sitzung neu lädt, läuft durch genau dieselbe Zeile.
 *
 * Darum hängt die ID an einem inneren Feld, und darum prüft das hier nicht
 * das Markup, sondern das Ergebnis: Namen setzen wie die Anwendung es tut,
 * danach müssen die Striche noch da sein.
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
const STRICHE = '☰';

function kopfleiste() {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const auf = html.indexOf('<header');
  const zu = html.indexOf('</header>');
  assert.ok(auf > 0 && zu > auf, 'Kein <header> in index.html — greift die Suche noch?');
  return new JSDOM('<!doctype html><html><body>' + html.slice(auf, zu + 9) + '</body></html>');
}

/**
 * Den Menüknopf über seinen HANDLER finden, nicht über die ID.
 *
 * Der Grund ist eine Gegenprobe, die zunächst nichts gemessen hat: Wer Name
 * und Striche zu einem Element verschmilzt, schreibt am ehesten
 *
 *     <button class="ubadge" id="ubadge" data-click="benutzerMenue">— ☰</button>
 *
 * — ein Knopf, der `ubadge` HEISST. Dann gibt es gar kein `btn-umenu` mehr,
 * und eine Prüfung, die darüber sucht, scheitert an `assert.ok(knopf)`, statt
 * den eigentlichen Schaden zu zeigen. Über `data-click` findet sie den Knopf
 * in beiden Bauweisen und kann sagen, was wirklich kaputt ist.
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

  assert.ok(knopf.textContent.includes(STRICHE),
    `Die drei Striche (${STRICHE}) stehen nicht im Menüknopf — sind sie wieder ein eigenes Element daneben?`);

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
  assert.ok(name, 'Kein #ubadge — 01-core.js schreibt den Namen genau dorthin');

  // Genau was 01-core.js in showApp() tut.
  name.textContent = 'marco';

  assert.ok(knopf.textContent.includes(STRICHE),
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
