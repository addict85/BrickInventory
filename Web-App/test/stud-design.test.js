/**
 * Counter-check: var(--brick-0) in public/themes/noppe.css replaced → red “the lid colors come from the SAME source”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// TREE and not ROOT: eigenbruecken.test.js resolves every `path.join(ROOT, …)`
// against the WEB root. A second meaning for the same name has already
// cost an hour once in this session.
const TREE = path.join(__dirname, '..', '..');
const css = fs.readFileSync(path.join(TREE, 'Web-App', 'public', 'themes', 'noppe.css'), 'utf8');
const glanz = fs.readFileSync(path.join(TREE, 'Web-App', 'public', 'themes', 'hochglanz.css'), 'utf8');
const source = JSON.parse(fs.readFileSync(path.join(TREE, 'shared', 'design-tokens.json'), 'utf8'));

/**
 * The theme "noppe" — the clamping brick as a component of the UI. What is checked
 * is the web app; the app draws the same theme from shared/design-tokens.json.
 */

test('the lid colors come from the SAME source', () => {
  const steine = source.listen.steine.werte;
  assert.ok(
    steine.length === 6,
    `Die Steinliste hat ${steine.length} Eintraege statt sechs — sechs, damit die ` +
      'Wiederholung als Rhythmus lesbar bleibt statt als Zufall.',
  );

  // None of the six colors may stand as a hex value in the stylesheet.
  // If it stands there, it is copied — and a copy pulls
  // along the next time.
  for (const hex of steine) {
    assert.ok(
      !css.toLowerCase().includes(hex.toLowerCase()),
      `themes/noppe.css schreibt ${hex} aus, statt var(--brick-N) zu benutzen`,
    );
  }
  assert.match(css, /var\(--brick-0\)/, 'themes/noppe.css benutzt die Steinliste nicht');
});

test('the brick color runs in step with the brick list', () => {
  // Modulo six, and on the same number: if the web cycles through six and
  // the app through four, the same set shows a different lid on phone and computer
  // — and nobody would think of considering that an error,
  // because the color means nothing after all. …
  const webTick = new Set([...css.matchAll(/nth-child\(6n\+?(\d*)\)/g)].map(m => m[1])).size;
  assert.equal(
    webTick,
    5,
    `themes/noppe.css zaehlt an ${webTick} verschiedenen Positionen durch, erwartet fuenf ` +
      '(--brick-0 steht als Vorgabe schon in der Grundregel)',
  );
});

test('frame and offset shadow are on the same tone', () => {
  // Plastic casts no cloud, it rests on top: the shadow is the same tone
  // as the border, only offset. If they were two tones, the edge would look
  // like a misprint.
  const schatten = [...css.matchAll(/--sh\d:([^;]+);/g)].map(m => m[1].trim());
  assert.ok(schatten.length >= 3, `Nur ${schatten.length} Schattenstufen — greift die Suche noch?`);
  for (const s of schatten) {
    assert.match(
      s,
      /var\(--ink\)/,
      `Die Schattenstufe "${s}" benutzt nicht die Tinte. Zwei Toene fuer ` +
        'Rahmen und Schatten sehen aus wie ein Druckfehler.',
    );
    assert.ok(!/blur|rgba/.test(s), `Die Schattenstufe "${s}" ist weich. Dieses Design kennt nur harte Kanten.`);
  }
});

test('the brick color stays rhythm and never becomes information', () => {});

test('the table stays quiet', () => {
  // The loud parts belong at the edges — header bar, buttons, badges —, not
  // between the numbers. An inventory is not something one looks at once.
  const tabelle = css.slice(css.indexOf('table td'));
  assert.ok(tabelle.length > 0, 'Die Tabellenregel ist nicht mehr zu finden');
  assert.ok(
    !/border-bottom:2\.5px solid var\(--ink\)/.test(tabelle),
    'Die Tabellenzeilen haben die Tintenkante bekommen. Das ist dann ein ' + 'Gitter und kein Text.',
  );
});

test('the design leads its font', () => {
  assert.match(
    css,
    /--font:'Nunito'/,
    'themes/noppe.css stellt die Schrift nicht um — dann ist das Design im Web ' + 'nur eine Farbvariante',
  );
  const fonts = fs.readFileSync(path.join(TREE, 'Web-App', 'public', 'vendor', 'fonts', 'fonts.css'), 'utf8');
  assert.match(
    fonts,
    /font-family: 'Nunito'/,
    'Die Schrift ist nicht selbst gehostet. Von einem Fremdhost bekaeme eine ' +
      'Installation im Offline-Betrieb sie gar nicht — genau der Grund, aus dem ' +
      'die anderen beiden Familien hier liegen.',
  );
});

test('hochglanz inherits the palette instead of copying it', () => {
  assert.equal(
    source.designs.hochglanz.erbt,
    'noppe',
    'hochglanz fuehrt eine eigene Palette. Es ist dieselbe wie die von noppe — ' +
      'eine Abschrift zieht beim naechsten Mal nicht mit.',
  );
  // And the generator must really make values of it, otherwise the
  // theme falls back to the base theme and is blue instead of red.
  const tokens = fs.readFileSync(path.join(TREE, 'Web-App', 'public', 'tokens.css'), 'utf8');
  const block = tokens.slice(tokens.indexOf('[data-theme="hochglanz"]'));
  assert.match(
    block.slice(0, 400),
    /--b600: #d91f26;/,
    'tokens.css traegt fuer hochglanz keine aufgeloeste Palette — dann greift :root, und ' +
      'das Design waere blau statt rot',
  );
});

test('hochglanz carries only the layers, not the anatomy', () => {
  // Every rule in noppe.css applies to BOTH themes — that is the shared
  // basis. hochglanz.css must not set them up a second time.
  const studRules = [...css.matchAll(/\[data-theme="noppe"\][^{]*\{/g)].length;
  assert.ok(studRules >= 10, `Nur ${studRules} Regeln in noppe.css — greift die Suche noch?`);
  assert.ok(
    !/\[data-theme="noppe"\]/.test(glanz),
    'hochglanz.css nennt noppe — die gemeinsamen Regeln gehoeren in noppe.css, einmal',
  );

  // The anatomy must not stand here once more. These four properties
  // determine it; if one of them shows up here, the file is no longer an overlay
  // but a second theme.
  for (const property of ['--rad:', '--font:', 'border-radius:14px', 'padding-top:26px']) {
    assert.ok(!glanz.includes(property), `hochglanz.css setzt ${property} — das ist Anatomie und steht in noppe.css`);
  }
});

test('the hard offset shadow survives the lacquer', () => {
  // The edge carries, even when it shines. If it drops away, it is a
  // different anatomy and not the same theme in another material.
  const karte = glanz.slice(glanz.indexOf('[data-theme="hochglanz"] .card'));
  assert.match(
    karte,
    /0 4px 0 var\(--ink\)/,
    'Der harte Versatzschatten ist im Lack verschwunden. Dann glaenzt etwas ' +
      'anderes als noppe, und es ist nicht mehr dasselbe Design.',
  );
});

test('the light stripe does not lie over the whole tile', () => {
  // A white veil over white text is no shine but gray.
  const strip = '118deg';
  assert.ok(glanz.includes(strip), 'Der Lichtstreifen fehlt ganz');
  // It may lie on the image field (.sci), not on the tile (.sc) itself.
  for (const regel of glanz.split('}')) {
    if (!regel.includes(strip)) continue;
    const kopf = regel.slice(0, regel.indexOf('{'));
    assert.ok(
      /\.sci\b/.test(kopf) && !/\.sc\s*[,{]/.test(kopf),
      `Der Lichtstreifen steht in einer Regel fuer "${kopf.trim()}". Er gehoert ` +
        'auf das Bildfeld (.sci) — ueber weissem Text ist er Grau, nicht Glanz.',
    );
  }
});

test('the gloss sits on fixed stops', () => {
  // The light falloff is a linear-gradient in CSS and a
  // Brush.verticalGradient in Compose. Different languages, the same four stops —
  // if they drift apart, the same theme looks different on phone and computer,
  // and nobody looks for the reason in a number.
  const fromCss = [...glanz.matchAll(/rgba\((?:255,255,255|0,0,0),\.(\d+)\) (\d+)%/g)].map(m => `${m[2]}/${m[1]}`);
  assert.ok(fromCss.length >= 4, `Nur ${fromCss.length} Haltepunkte im CSS — greift die Suche noch?`);
});

test('the lid is ONE building block, not two', () => {});

/** The two rules that draw a stud row. */
const studsRows = () => css.split('}').filter(r => /header::before|\.sc::after/.test(r.slice(0, r.indexOf('{') + 1)));

test('the studs have a round top edge, not a gradient edge', () => {
  const reihen = studsRows();
  // Self-proof: MEASURED there are two — the header bar and the tile lid.
  assert.equal(reihen.length, 2, `${reihen.length} Noppenreihen gefunden statt zwei — greift die Suche noch?`);

  for (const rowList of reihen) {
    const kopf = rowList.slice(0, rowList.indexOf('{')).trim();
    assert.ok(rowList.includes('var(--studs-form)'), `"${kopf}" benutzt die Noppenform nicht`);
    assert.ok(
      !/repeating-linear-gradient/.test(rowList),
      `"${kopf}" zeichnet die Noppen wieder als Verlauf. Ein Verlauf kann keine ` +
        'runden Ecken — genau daran sahen sie aus wie Striche.',
    );
    assert.ok(
      !/border-radius/.test(rowList),
      `"${kopf}" rundet mit border-radius. Das rundet den BALKEN, nicht die ` +
        'einzelne Noppe — der Unterschied war in der laufenden App zu sehen.',
    );
  }
});

test('bar and lid share ONE stud shape', () => {
  // Two forms would drift apart at the next touch-up: one row
  // would get round studs, the other would keep its old ones — and both stand
  // one below the other on the same screen.
  const reason = fs.readFileSync(path.join(TREE, 'Web-App', 'public', 'styles.css'), 'utf8');
  const explanations = [...(css + reason).matchAll(/--studs-form:/g)].length;
  assert.equal(
    explanations,
    1,
    `Die Noppenform steht ${explanations}-mal im Baum. Einmal reicht; jede ` +
      'weitere Reihe nimmt dieselbe Form in einem anderen Takt (mask-size).',
  );
  assert.match(reason, /--studs-form:url\("data:image\/svg\+xml,/, 'Die Noppenform ist keine Maske mehr');
});

test('the gloss is in step with the mask', () => {
  // The place where it silently goes wrong
  const masksTicks = [...css.matchAll(/\bmask-size:(\d+)px \d+px/g)].map(m => m[1]);
  const glossTicks = [...glanz.matchAll(/\bbackground-size:(\d+)px \d+px/g)].map(m => m[1]);
  // Self-proof: MEASURED there are four mask beats (per row once with and
  // once without -webkit-) and two shine beats.
  assert.deepEqual(
    [...new Set(masksTicks)].sort(),
    ['22', '24'],
    `Die Masken-Takte sind ${masksTicks.join(', ')} — greift die Suche noch?`,
  );
  assert.deepEqual(
    [...new Set(glossTicks)].sort(),
    ['22', '24'],
    `Der Glanz wiederholt sich im Takt ${glossTicks.join(', ')}, die Maske aber ` +
      `im Takt ${[...new Set(masksTicks)].join(', ')}. Dann sitzt der Lichtpunkt ` +
      'nicht mehr auf der Noppe.',
  );
});

test('the lid color does not erase the lacquer', () => {
  // The error this assertion prevents
  const colorRules = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('}')
    .filter(r => /--brick-\d/.test(r));
  // Self-proof: MEASURED there are six — the base rule and five positions.
  assert.equal(
    colorRules.length,
    6,
    `${colorRules.length} Regeln mit einer Deckelfarbe statt sechs — greift die Suche noch?`,
  );

  const shortForm = colorRules
    .filter(r => /(?:^|[;{\s])background:\s*var\(--brick-/.test(r))
    .map(r => r.slice(0, r.indexOf('{')).trim().split(',')[0]);
  assert.deepEqual(
    shortForm,
    [],
    'Diese Regeln setzen die Deckelfarbe mit der Kurzform `background:`. Sie ' +
      'loescht damit den `background-image` des Lacks — und weil :nth-child wie ' +
      'eine Klasse zaehlt, gewinnt sie gegen hochglanz.css. `background-color:` ' +
      'setzt nur die Farbe und laesst den Lack stehen.',
  );
});

const stein = fs.readFileSync(path.join(TREE, 'Web-App', 'public', 'themes', 'brick.css'), 'utf8');
const grundCss = fs.readFileSync(path.join(TREE, 'Web-App', 'public', 'styles.css'), 'utf8');

test('the stud shape belongs to all designs, not to one', () => {
  // It stood in themes/noppe.css. As long as only one theme drew studs,
  // that was right; since there are two, it is the place where they
  // auseinanderlaufen.
  assert.match(
    grundCss,
    /--studs-form:url\("data:image\/svg\+xml,/,
    'Die Noppenform steht nicht mehr in styles.css unter :root',
  );
  assert.ok(
    !/--studs-form:/.test(css),
    'themes/noppe.css fuehrt wieder eine eigene Noppenform — dann hat das ' +
      'Stein-Design seine eigene, und genau so ist der Unterschied entstanden.',
  );
  assert.match(stein, /var\(--studs-form\)/, 'Das Stein-Design benutzt die gemeinsame Noppenform nicht');
  // Only the ROW, not every circle: the handles of the year sliders are
  // round buttons with a highlight (`circle at 35% 32%`) and should stay
  // that. A stud row is recognized by its anchoring in pixels —
  // `circle at 8px center`, repeated every 16px. The first version forbade
  // both and would have torn down two correct rules with it.
  const reihen = [...stein.matchAll(/radial-gradient\(circle at \d+px center/g)];
  assert.deepEqual(
    reihen.map(m => m[0]),
    [],
    'Das Stein-Design zeichnet eine Noppenreihe wieder als Kreise. Von vorn ist ' +
      'eine Noppe ein Rechteck mit runder Oberkante — das war der Grund, aus dem ' +
      'die Kante wie „ein Balken mit Punkten" aussah.',
  );
});
