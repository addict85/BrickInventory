/**
 * Remove inline handlers so that `script-src 'unsafe-inline'` can disappear
 * from the CSP (item 2 of the optimization list).
 *
 * Counter-checks of the source-text cases deleted on 08.11.2026, where they run
 * (measured each alone):
 *   CSP without unsafe-inline, img-src without https:, worker-src, no foreign host
 *   in the CSP → sicherheit-querschnitt-db “every response carries …” (directive
 *   spoiled each alone → red); no inline <script> and no foreign host in
 *   the delivered page → there “the delivered page …” (red with an
 *   inserted inline script or foreign stylesheet).
 *   Handlers from index.html and templates registered, dispatcher included,
 *   arguments/data-val/this, capture of image errors, retry, mode
 *   “keep”, log window without inline script → aktionen-dispatcher-
 *   oberflaeche (counter-checks A–H there); the placeholder mode →
 *   images-placeholder.test.js.
 */
const { isAppModule } = require('../scripts/build-frontend');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', 'public');
const HTML = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
const ACT = fs.readFileSync(path.join(PUB, 'js', 'actions.js'), 'utf8');
const JS_FILES = fs.readdirSync(path.join(PUB, 'js')).filter(f => isAppModule(f));

test('no more inline handlers anywhere — neither in index.html nor in the templates', () => {
  // Important: (?<!data-) excludes data-onerror, and the pattern requires ="
  // — el.onclick = fn in JavaScript is CSP-compliant and may stay.
  const RE = /(?<!data-)\bon(click|change|input|blur|keydown|error|load|submit|mouseenter|mouseleave)=\\?"/g;
  // Remove comments: the documentation in aktionen.js quotes the old
  // handlers ("War: onclick=…") and would otherwise trigger the check itself.
  const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');
  const found = [];
  for (const [name, src] of [
    ['index.html', HTML],
    ...JS_FILES.concat(['actions.js']).map(f => [f, fs.readFileSync(path.join(PUB, 'js', f), 'utf8')]),
  ]) {
    for (const m of strip(src).matchAll(RE)) found.push(`${name}: ${m[0]}`);
  }
  assert.deepEqual(found, [], `Noch ${found.length} Inline-Handler — mit denen wäre die geschlossene CSP ein Ausfall`);
});

test('no style attribute and no <style> in the markup — except the start skeleton, which the CSP allows by hash', () => {
  // Counter-check: a data-style in index.html back as style= → red.
  const strip = t =>
    require('./helpers/sources')
      .withoutHtmlComments(t)
      .replace(/<style id="startstil">[\s\S]*?<\/style>/, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/[^\n]*$/gm, '');
  const found = [];
  for (const [name, src] of [
    ['index.html', HTML],
    ['logviewer.js', fs.readFileSync(path.join(PUB, 'js', 'logviewer.js'), 'utf8')],
    ...JS_FILES.map(f => [f, fs.readFileSync(path.join(PUB, 'js', f), 'utf8')]),
  ]) {
    for (const m of strip(src).matchAll(/(?<![-\w])style=\\?["']|<style[\s>]/g)) found.push(`${name}: ${m[0]}`);
    // A value with ${…} is not on the allow list and would have no effect;
    // only the building blocks pass on the style parameter of their caller.
    for (const m of src.matchAll(/data-style="([^"]*\$\{[^"]*)"/g))
      if (!/^\$\{(esc\()?o\.(style|rowsStyle|valueStyle)\)?\}$/.test(m[1])) found.push(`${name}: data-style="${m[1]}"`);
  }
  assert.deepEqual(found, []);
});

test('the dispatcher gets by without eval', () => {
  // Comments out: the explanatory text names "kein eval, kein new Function" and
  // would otherwise trigger the check itself.
  const code = ACT.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(
    code,
    /\beval\s*\(|new Function/,
    "Ein eval() würde 'unsafe-eval' verlangen und damit dasselbe Problem erzeugen",
  );
  // The typeof check moved with the registry to js/registry.js
  // (resolveAction) — the dispatcher only calls it now.
  const REG = fs.readFileSync(path.join(PUB, 'js', 'registry.js'), 'utf8');
  assert.match(REG, /typeof fn === 'function'/, 'Der Name muss aufgelöst und geprüft werden');
  assert.match(
    ACT,
    /console\.warn\('\[actions\] unknown handler:'/,
    'Ein Tippfehler im Handlernamen muss auffallen, nicht stumm nichts tun',
  );
});

test('hover effects live in the stylesheet', () => {
  const css = fs.readFileSync(path.join(PUB, 'styles.css'), 'utf8');
  assert.match(
    css,
    /\.hover-row:hover/,
    'Die früheren onmouseenter/onmouseleave-Attribute brauchen eine CSS-Entsprechung',
  );
});

test('delete buttons on tiles carry a trash can, no ✕', () => {
  const core = require('./helpers/sources').coreSource();
  assert.match(core, /const TRASH_ICON_SVG/, 'Symbol fehlt');
  // currentColor: the same path serves white on red background (.delbtn) and red
  // on light background (.bd) — no second version needed.
  assert.match(core, /stroke="currentColor"/, 'Das Symbol muss die Farbe erben');

  // The rule instead of the count
  const EXCEPTION = new Set(['delInstr']);
  let exceptionsSeen = 0;

  // The self-proof counts across ALL files, not per file
  let buttonsTotal = 0;
  for (const file of ['collection.js', 'sets-table.js', 'parts.js', 'minifigs.js', 'set-detail.js']) {
    const src = fs.readFileSync(path.join(PUB, 'js', file), 'utf8');
    // `del\w*` and not `delete\w*`: the gallery tile calls `delSetStop`.
    // With the narrower pattern the search found NOTHING there — and the self-proof
    // reported exactly that instead of running through green.
    const knoepfe = [...src.matchAll(/<button[^>]*data-click="del\w*"[\s\S]{0,400}?<\/button>/g)].map(m => m[0]);
    buttonsTotal += knoepfe.length;
    let gefunden = 0;
    for (const k of knoepfe) {
      const name = (k.match(/data-click="(del\w*)"/) || [])[1];
      if (EXCEPTION.has(name)) {
        gefunden++;
        continue;
      }
      assert.match(
        k,
        /\$\{TRASH_ICON_SVG\}/,
        `${file}: ein Löschknopf ohne Papierkorb-Symbol — ` +
          `dieselbe Aktion soll überall gleich aussehen:\n${k.slice(0, 160)}`,
      );
    }
    exceptionsSeen += gefunden;
  }
  assert.ok(buttonsTotal >= 1, 'Kein einziger Löschknopf gefunden — Muster veraltet?');

  // A line that nobody needs anymore is a permission that nobody
  // checks — the same rule as in the other guards of this tree.
  assert.equal(
    exceptionsSeen,
    EXCEPTION.size,
    `${exceptionsSeen} von ${EXCEPTION.size} Ausnahmen gefunden — eine davon ` +
      'beschreibt keinen Knopf mehr und gehoert gestrichen.',
  );

  // The affected buttons may no longer contain ✕
  const gallery = fs.readFileSync(path.join(PUB, 'js', 'collection.js'), 'utf8');
  assert.doesNotMatch(gallery, /class="delbtn"[^>]*>✕/, 'Set-Kachel zeigt noch ✕');

  // The trash on the tile is a mouse path and hidden from assistive
  // technology (otherwise there would be a button inside a button); deleting via keyboard goes
  // via the detail dialog. A title tells the mouse what it does.
  assert.match(
    gallery,
    /<span class="delbtn" data-click="delSetStop"(?:\$\{genuine\(\)\})? aria-hidden="true"[^>]*title=/,
    'Set-Kachel: Papierkorb nicht verborgen',
  );
  const figs = fs.readFileSync(path.join(PUB, 'js', 'minifigs.js'), 'utf8');
  assert.match(
    figs,
    /<span class="delbtn" data-click="deleteManualFigStop"(?:\$\{genuine\(\)\})? aria-hidden="true"[^>]*title=/,
    'Minifiguren-Kachel: Papierkorb nicht verborgen',
  );

  // Uniform pattern across all three tables: .ca as hover container with
  // .delbtn inside. Previously the minifigure button was a "btn bd" with its own
  // inline style and permanently visible, parts had none at all.
  for (const [file, expected] of /** @type {[string, number][]} */ ([
    ['collection.js', 1],
    ['parts.js', 1],
    ['minifigs.js', 2],
  ])) {
    const src = fs.readFileSync(path.join(PUB, 'js', file), 'utf8');
    const n = (src.match(/<div class="ca"><(?:button|span) class="delbtn"/g) || []).length;
    assert.equal(n, expected, `${file}: ${n} statt ${expected} Kachel-Löschknöpfe im .ca/.delbtn-Muster`);
  }

  // The hover applies to set AND manual tiles, and without a pointing device
  // the button stays visible — otherwise deleting by touch would not be reachable.
  const css = fs.readFileSync(path.join(PUB, 'styles.css'), 'utf8');
  // .mk-row has been in it since 24.09.: the wishlist row carries
  // the same trash at the top right and needs the same fade-in.
  assert.match(
    css,
    /\.sc:hover \.ca, \.man-tile:hover \.ca, \.mk-row:hover \.ca\{opacity:1\}/,
    'Manuelle Kacheln oder die Merklisten-Zeile zeigen den Löschknopf nicht beim Überfahren',
  );
  assert.match(
    css,
    /@media \(hover: none\)\{ \.ca\{opacity:1\} \}/,
    'Ohne Zeigegerät bliebe der Löschknopf unerreichbar',
  );

  const i18n = require('./helpers/sources').i18nAll();
  assert.match(i18n, /'figs\.delete':\s*'Minifigur löschen'/, 'DE-Beschriftung fehlt');
  assert.match(i18n, /'figs\.delete':\s*'Delete minifigure'/, 'EN-Beschriftung fehlt');
});

test('the delete button has its own version per theme', () => {
  // What this test NO longer checks
  const css = fs.readFileSync(path.join(PUB, 'styles.css'), 'utf8');
  const brick = fs.readFileSync(path.join(PUB, 'themes', 'brick.css'), 'utf8');

  const del = css.slice(css.indexOf('.delbtn{'), css.indexOf('.delbtn svg'));

  // 1) own version per design
  assert.ok(del.length > 0, 'styles.css hat keine .delbtn-Regel');
  assert.match(
    brick,
    /\[data-theme="brick"\] \.sc \.delbtn\{/,
    'Das Stein-Design braucht eine eigene Fassung — sonst sitzt der helle Knopf auf der dunklen Leiste',
  );
  assert.match(
    brick,
    /\[data-theme="brick"\] \.sc \.delbtn:hover\{/,
    'Auch der Hover braucht im Stein-Design eine eigene Fassung',
  );

  // 2) Fokusring
  assert.match(del, /\.delbtn:focus-visible\{outline/, 'Ohne Fokusring ist der Knopf per Tastatur unsichtbar');

  // 3) token instead of literal — which token does not matter to the test
  for (const [name, src] of [
    ['styles.css', del],
    ['brick.css', brick],
  ]) {
    assert.doesNotMatch(src, /#ef4444/, `${name}: --r500 benutzen statt Literal`);
    assert.doesNotMatch(src, /rgba\(239,\s*68,\s*68/, `${name}: --r500 benutzen statt Literal`);
  }
});

test('the font files really are in the tree', () => {
  // A fonts.css whose woff2 files are missing is worse than the old state:
  // the browser first waits for a 404 and then falls back to system fonts
  // — visible only in production, not in the type check.
  const dir = path.join(__dirname, '..', 'public', 'vendor', 'fonts');
  const css = fs.readFileSync(path.join(dir, 'fonts.css'), 'utf8');
  const refs = [...css.matchAll(/url\(\.\/([^)]+)\)/g)].map(m => m[1]);
  assert.ok(refs.length >= 2, 'fonts.css verweist auf keine Dateien');
  for (const rel of refs) {
    assert.ok(fs.existsSync(path.join(dir, rel)), `Schriftdatei fehlt: ${rel}`);
  }
  // The license texts belong to it (SIL OFL) — as with vendor/qrcode.
  const licenses = fs.readdirSync(dir).filter(f => f.startsWith('LICENSE'));
  assert.ok(licenses.length >= 2, 'Die Schriftlizenzen fehlen neben den Dateien');
});

test('external links open without access to the opener window', () => {
  // A target="_blank" without rel="noopener" gives the opened page access to
  // the own window via window.opener — it can redirect it
  // (tabnabbing). Modern browsers now set noopener for _blank by
  // themselves; older ones and embedded WebViews do not, and the code set it on …
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const ohne = [...html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)]
    .map(m => m[0])
    .filter(tag => !/rel="[^"]*noopener/.test(tag));
  assert.deepEqual(ohne, [], `target="_blank" ohne rel="noopener": ${ohne.join(' | ')}`);
});
