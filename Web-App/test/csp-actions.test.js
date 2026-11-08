/**
 * Inline-Handler entfernen, damit `script-src 'unsafe-inline'` aus der CSP
 * verschwinden kann (Punkt 2 der Optimierungsliste).
 * Ausführlich: docs/begruendungen/test/csp-actions.test.js.md#kopf
 *
 * Gegenproben der am 08.11.2026 gestrichenen Quelltext-Fälle, wo sie laufen
 * (je einzeln gemessen):
 *   CSP ohne unsafe-inline, img-src ohne https:, worker-src, kein fremder Host
 *   in der CSP → sicherheit-querschnitt-db „jede Antwort trägt …“ (Direktive
 *   je einzeln verdorben → rot); kein Inline-<script> und kein Fremdhost in
 *   der ausgelieferten Seite → dort „die ausgelieferte Seite …“ (rot mit
 *   eingefügtem Inline-Skript bzw. Fremd-Stylesheet).
 *   Handler aus index.html und Vorlagen angemeldet, Dispatcher eingebunden,
 *   Argumente/data-val/this, Capture der Bildfehler, Wiederholversuch, Modus
 *   „keep“, Protokollfenster ohne Inline-Skript → aktionen-dispatcher-
 *   oberflaeche (Gegenproben A–H dort); der Platzhalter-Modus →
 *   bilder-platzhalter.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUB  = path.join(__dirname, '..', 'public');
const HTML = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
const ACT  = fs.readFileSync(path.join(PUB, 'js', '11-actions.js'), 'utf8');
const JS_FILES = fs.readdirSync(path.join(PUB, 'js')).filter(f => /^\d\d-.*\.js$/.test(f));


test('nirgends mehr Inline-Handler — weder in index.html noch in den Templates', () => {
  // Wichtig: (?<!data-) schliesst data-onerror aus, und das Muster verlangt ="
  // — el.onclick = fn in JavaScript ist CSP-konform und darf bleiben.
  const RE = /(?<!data-)\bon(click|change|input|blur|keydown|error|load|submit|mouseenter|mouseleave)=\\?"/g;
  // Kommentare entfernen: Die Dokumentation in 11-actions.js zitiert die alten
  // Handler ("War: onclick=…") und würde die Prüfung sonst selbst auslösen.
  const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');
  const found = [];
  for (const [name, src] of [['index.html', HTML],
       ...JS_FILES.concat(['11-actions.js']).map(f => [f, fs.readFileSync(path.join(PUB, 'js', f), 'utf8')])]) {
    for (const m of strip(src).matchAll(RE)) found.push(`${name}: ${m[0]}`);
  }
  assert.deepEqual(found, [],
    `Noch ${found.length} Inline-Handler — mit denen wäre die geschlossene CSP ein Ausfall`);
});

test('kein style-Attribut und kein <style> im Markup — ausser dem Startgerüst, das die CSP per Hash erlaubt', () => {
  // Gegenprobe: ein data-stil in index.html wieder als style= → rot.
  const strip = t => require('./helpers/sources').ohneHtmlKommentare(t).replace(/<style id="startstil">[\s\S]*?<\/style>/, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');
  const found = [];
  for (const [name, src] of [['index.html', HTML], ['logviewer.js', fs.readFileSync(path.join(PUB, 'js', 'logviewer.js'), 'utf8')],
       ...JS_FILES.map(f => [f, fs.readFileSync(path.join(PUB, 'js', f), 'utf8')])]) {
    for (const m of strip(src).matchAll(/(?<![-\w])style=\\?["']|<style[\s>]/g)) found.push(`${name}: ${m[0]}`);
    // Ein Wert mit ${…} steht nicht auf der Freigabeliste und bliebe wirkungslos;
    // nur die Bausteine reichen den stil-Parameter ihres Aufrufers weiter.
    for (const m of src.matchAll(/data-stil="([^"]*\$\{[^"]*)"/g))
      if (!/^\$\{(esc\()?o\.(stil|zeilenStil|wertStil)\)?\}$/.test(m[1])) found.push(`${name}: data-stil="${m[1]}"`);
  }
  assert.deepEqual(found, []);
});

test('der Dispatcher kommt ohne eval aus', () => {
  // Kommentare weg: Der Erklärtext nennt "kein eval, kein new Function" und
  // würde die Prüfung sonst selbst auslösen.
  const code = ACT.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /\beval\s*\(|new Function/,
    "Ein eval() würde 'unsafe-eval' verlangen und damit dasselbe Problem erzeugen");
  // Die typeof-Prüfung ist mit der Registry nach js/00-registry.js gewandert
  // (resolveAction) — der Dispatcher ruft sie nur noch auf.
  const REG = fs.readFileSync(path.join(PUB, 'js', '00-registry.js'), 'utf8');
  assert.match(REG, /typeof fn === 'function'/, 'Der Name muss aufgelöst und geprüft werden');
  assert.match(ACT, /console\.warn\('\[actions\] unbekannter Handler:'/,
    'Ein Tippfehler im Handlernamen muss auffallen, nicht stumm nichts tun');
});

test('Hover-Effekte liegen im Stylesheet', () => {
  const css = fs.readFileSync(path.join(PUB, 'styles.css'), 'utf8');
  assert.match(css, /\.hover-row:hover/,
    'Die früheren onmouseenter/onmouseleave-Attribute brauchen eine CSS-Entsprechung');
});

test('Löschknöpfe auf Kacheln tragen einen Papierkorb, kein ✕', () => {
  const core = require('./helpers/sources').coreQuelle();
  assert.match(core, /const TRASH_ICON_SVG/, 'Symbol fehlt');
  // currentColor: derselbe Pfad dient weiss auf rotem Grund (.delbtn) und rot
  // auf hellem Grund (.bd) — keine zweite Fassung nötig.
  assert.match(core, /stroke="currentColor"/, 'Das Symbol muss die Farbe erben');

  // Die Regel statt der Anzahl
  // Ausführlich: docs/begruendungen/test/csp-actions.test.js.md#ausnahme
  const AUSNAHME = new Set(['delInstr']);
  let ausnahmenGesehen = 0;

  // Der Selbstbeweis zählt über ALLE Dateien, nicht je Datei
  // Ausführlich: docs/begruendungen/test/csp-actions.test.js.md#knoepfegesamt
  let knoepfeGesamt = 0;
  for (const file of ['02-gallery.js', '03-parts.js', '06-minifigs.js', '07-set-detail.js']) {
    const src = fs.readFileSync(path.join(PUB, 'js', file), 'utf8');
    // `del\w*` und nicht `delete\w*`: Die Galerie-Kachel ruft `delSetStop`.
    // Mit dem engeren Muster fand die Suche dort NICHTS — und der Selbstbeweis
    // hat genau das gemeldet, statt gruen durchzulaufen.
    const knoepfe = [...src.matchAll(/<button[^>]*data-click="del\w*"[\s\S]{0,400}?<\/button>/g)]
      .map(m => m[0]);
    knoepfeGesamt += knoepfe.length;
    let gefunden = 0;
    for (const k of knoepfe) {
      const name = (k.match(/data-click="(del\w*)"/) || [])[1];
      if (AUSNAHME.has(name)) { gefunden++; continue; }
      assert.match(k, /\$\{TRASH_ICON_SVG\}/,
        `${file}: ein Löschknopf ohne Papierkorb-Symbol — ` +
        `dieselbe Aktion soll überall gleich aussehen:\n${k.slice(0, 160)}`);
    }
    ausnahmenGesehen += gefunden;
  }
  assert.ok(knoepfeGesamt >= 1, 'Kein einziger Löschknopf gefunden — Muster veraltet?');

  // Eine Zeile, die niemand mehr braucht, ist eine Erlaubnis, die niemand
  // prueft — dieselbe Regel wie in den anderen Waechtern dieses Baums.
  assert.equal(ausnahmenGesehen, AUSNAHME.size,
    `${ausnahmenGesehen} von ${AUSNAHME.size} Ausnahmen gefunden — eine davon ` +
    'beschreibt keinen Knopf mehr und gehoert gestrichen.');

  // Die betroffenen Knöpfe dürfen kein ✕ mehr enthalten
  const gallery = fs.readFileSync(path.join(PUB, 'js', '02-gallery.js'), 'utf8');
  assert.doesNotMatch(gallery, /class="delbtn"[^>]*>✕/, 'Set-Kachel zeigt noch ✕');

  // Der Papierkorb auf der Kachel ist ein Mausweg und für Hilfstechnik
  // verborgen (sonst steckte ein Knopf im Knopf); Löschen per Tastatur geht
  // über den Detail-Dialog. Ein title sagt der Maus, was er tut.
  assert.match(gallery, /<span class="delbtn" data-click="delSetStop"(?:\$\{echt\(\)\})? aria-hidden="true"[^>]*title=/, 'Set-Kachel: Papierkorb nicht verborgen');
  const figs = fs.readFileSync(path.join(PUB, 'js', '06-minifigs.js'), 'utf8');
  assert.match(figs, /<span class="delbtn" data-click="deleteManualFigStop"(?:\$\{echt\(\)\})? aria-hidden="true"[^>]*title=/,
    'Minifiguren-Kachel: Papierkorb nicht verborgen');

  // Einheitliches Muster über alle drei Tabellen: .ca als Hover-Behälter mit
  // .delbtn darin. Vorher war der Minifiguren-Knopf ein "btn bd" mit eigenem
  // Inline-Style und dauerhaft sichtbar, Teile hatten gar keinen.
  // Ausführlich: docs/begruendungen/test/csp-actions.test.js.md#for-stelle
  for (const [file, expected] of [['02-gallery.js', 1], ['03-parts.js', 1], ['06-minifigs.js', 2]]) {
    const src = fs.readFileSync(path.join(PUB, 'js', file), 'utf8');
    const n = (src.match(/<div class="ca"><(?:button|span) class="delbtn"/g) || []).length;
    assert.equal(n, expected, `${file}: ${n} statt ${expected} Kachel-Löschknöpfe im .ca/.delbtn-Muster`);
  }

  // Der Hover gilt für Set- UND manuelle Kacheln, und ohne Zeigegerät bleibt
  // der Knopf sichtbar — sonst wäre Löschen per Touch nicht erreichbar.
  const css = fs.readFileSync(path.join(PUB, 'styles.css'), 'utf8');
  // .mk-zeile steht seit dem 24.09. mit darin: Die Merklisten-Zeile trägt
  // denselben Papierkorb oben rechts und braucht dieselbe Einblendung.
  assert.match(css, /\.sc:hover \.ca, \.man-tile:hover \.ca, \.mk-zeile:hover \.ca\{opacity:1\}/,
    'Manuelle Kacheln oder die Merklisten-Zeile zeigen den Löschknopf nicht beim Überfahren');
  assert.match(css, /@media \(hover: none\)\{ \.ca\{opacity:1\} \}/,
    'Ohne Zeigegerät bliebe der Löschknopf unerreichbar');

  const i18n = require('./helpers/sources').i18nAll();
  assert.match(i18n, /'figs\.delete':\s*'Minifigur löschen'/, 'DE-Beschriftung fehlt');
  assert.match(i18n, /'figs\.delete':\s*'Delete minifigure'/, 'EN-Beschriftung fehlt');
});

test('der Löschknopf hat je Design eine eigene Fassung', () => {
  // Was dieser Test NICHT mehr prüft
  // Ausführlich: docs/begruendungen/test/csp-actions.test.js.md#css-stelle
  const css   = fs.readFileSync(path.join(PUB, 'styles.css'), 'utf8');
  const brick = fs.readFileSync(path.join(PUB, 'themes', 'brick.css'), 'utf8');

  const del = css.slice(css.indexOf('.delbtn{'), css.indexOf('.delbtn svg'));

  // 1) Eigene Fassung je Design
  assert.ok(del.length > 0, 'styles.css hat keine .delbtn-Regel');
  assert.match(brick, /\[data-theme="brick"\] \.sc \.delbtn\{/,
    'Das Stein-Design braucht eine eigene Fassung — sonst sitzt der helle Knopf auf der dunklen Leiste');
  assert.match(brick, /\[data-theme="brick"\] \.sc \.delbtn:hover\{/,
    'Auch der Hover braucht im Stein-Design eine eigene Fassung');

  // 2) Fokusring
  assert.match(del, /\.delbtn:focus-visible\{outline/,
    'Ohne Fokusring ist der Knopf per Tastatur unsichtbar');

  // 3) Token statt Literal — welcher Token, ist dem Test egal
  for (const [name, src] of [['styles.css', del], ['brick.css', brick]]) {
    assert.doesNotMatch(src, /#ef4444/, `${name}: --r500 benutzen statt Literal`);
    assert.doesNotMatch(src, /rgba\(239,\s*68,\s*68/, `${name}: --r500 benutzen statt Literal`);
  }
});

test('die Schriftdateien liegen wirklich im Baum', () => {
  // Eine fonts.css, deren woff2 fehlen, ist schlimmer als der alte Zustand:
  // Der Browser wartet erst auf einen 404 und fällt dann auf Systemschriften
  // zurück — sichtbar erst im Betrieb, nicht im Typecheck.
  const dir = path.join(__dirname, '..', 'public', 'vendor', 'fonts');
  const css = fs.readFileSync(path.join(dir, 'fonts.css'), 'utf8');
  const refs = [...css.matchAll(/url\(\.\/([^)]+)\)/g)].map(m => m[1]);
  assert.ok(refs.length >= 2, 'fonts.css verweist auf keine Dateien');
  for (const rel of refs) {
    assert.ok(fs.existsSync(path.join(dir, rel)), `Schriftdatei fehlt: ${rel}`);
  }
  // Die Lizenztexte gehören dazu (SIL OFL) — wie bei vendor/qrcode.
  const lizenzen = fs.readdirSync(dir).filter(f => f.startsWith('LICENSE'));
  assert.ok(lizenzen.length >= 2, 'Die Schriftlizenzen fehlen neben den Dateien');
});

test('externe Links öffnen ohne Zugriff auf das Öffnerfenster', () => {
  // Ein target="_blank" ohne rel="noopener" gibt der geöffneten Seite über
  // window.opener Zugriff auf das eigene Fenster — sie kann es umleiten
  // (Tabnabbing). Moderne Browser setzen noopener bei _blank inzwischen von
  // selbst; ältere und eingebettete WebViews nicht, und der Code setzte es an …
  // Ausführlich: docs/begruendungen/test/csp-actions.test.js.md#html-2
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const ohne = [...html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)]
    .map(m => m[0]).filter(tag => !/rel="[^"]*noopener/.test(tag));
  assert.deepEqual(ohne, [], `target="_blank" ohne rel="noopener": ${ohne.join(' | ')}`);
});
