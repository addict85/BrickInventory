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
    `The brick list has ${steine.length} entries instead of six — six, so that the ` +
      'repetition reads as a rhythm rather than as chance.',
  );

  // None of the six colors may stand as a hex value in the stylesheet.
  // If it stands there, it is copied — and a copy pulls
  // along the next time.
  for (const hex of steine) {
    assert.ok(
      !css.toLowerCase().includes(hex.toLowerCase()),
      `themes/noppe.css spells out ${hex} instead of using var(--brick-N)`,
    );
  }
  assert.match(css, /var\(--brick-0\)/, 'themes/noppe.css does not use the brick list');
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
    `themes/noppe.css cycles through ${webTick} different positions, expected five ` +
      '(--brick-0 is already the default in the base rule)',
  );
});

test('frame and offset shadow are on the same tone', () => {
  // Plastic casts no cloud, it rests on top: the shadow is the same tone
  // as the border, only offset. If they were two tones, the edge would look
  // like a misprint.
  const schatten = [...css.matchAll(/--sh\d:([^;]+);/g)].map(m => m[1].trim());
  assert.ok(schatten.length >= 3, `Only ${schatten.length} shadow levels — does the search still work?`);
  for (const s of schatten) {
    assert.match(
      s,
      /var\(--ink\)/,
      `The shadow level "${s}" does not use the ink. Two tones for ` + 'border and shadow look like a printing error.',
    );
    assert.ok(!/blur|rgba/.test(s), `The shadow level "${s}" is soft. This design only knows hard edges.`);
  }
});

test('the brick color stays rhythm and never becomes information', () => {});

test('the table stays quiet', () => {
  // The loud parts belong at the edges — header bar, buttons, badges —, not
  // between the numbers. An inventory is not something one looks at once.
  const tabelle = css.slice(css.indexOf('table td'));
  assert.ok(tabelle.length > 0, 'The table rule can no longer be found');
  assert.ok(
    !/border-bottom:2\.5px solid var\(--ink\)/.test(tabelle),
    'The table rows got the ink edge. That is then a ' + 'grid and not text.',
  );
});

test('the design leads its font', () => {
  assert.match(
    css,
    /--font:'Nunito'/,
    'themes/noppe.css does not switch the font — then the design on the web is ' + 'just a colour variant',
  );
  const fonts = fs.readFileSync(path.join(TREE, 'Web-App', 'public', 'vendor', 'fonts', 'fonts.css'), 'utf8');
  assert.match(
    fonts,
    /font-family: 'Nunito'/,
    'The font is not self-hosted. From a foreign host an ' +
      'installation running offline would not get it at all — exactly the reason why ' +
      'the other two families live here.',
  );
});

test('hochglanz inherits the palette instead of copying it', () => {
  assert.equal(
    source.designs.hochglanz.erbt,
    'noppe',
    'hochglanz keeps its own palette. It is the same as that of noppe — ' + 'a copy will not follow along next time.',
  );
  // And the generator must really make values of it, otherwise the
  // theme falls back to the base theme and is blue instead of red.
  const tokens = fs.readFileSync(path.join(TREE, 'Web-App', 'public', 'tokens.css'), 'utf8');
  const block = tokens.slice(tokens.indexOf('[data-theme="hochglanz"]'));
  assert.match(
    block.slice(0, 400),
    /--b600: #d91f26;/,
    'tokens.css carries no resolved palette for hochglanz — then :root applies, and ' +
      'the design would be blue instead of red',
  );
});

test('hochglanz carries only the layers, not the anatomy', () => {
  // Every rule in noppe.css applies to BOTH themes — that is the shared
  // basis. hochglanz.css must not set them up a second time.
  const studRules = [...css.matchAll(/\[data-theme="noppe"\][^{]*\{/g)].length;
  assert.ok(studRules >= 10, `Only ${studRules} rules in noppe.css — does the search still work?`);
  assert.ok(
    !/\[data-theme="noppe"\]/.test(glanz),
    'hochglanz.css names noppe — the shared rules belong in noppe.css, once',
  );

  // The anatomy must not stand here once more. These four properties
  // determine it; if one of them shows up here, the file is no longer an overlay
  // but a second theme.
  for (const property of ['--rad:', '--font:', 'border-radius:14px', 'padding-top:26px']) {
    assert.ok(!glanz.includes(property), `hochglanz.css sets ${property} — that is anatomy and lives in noppe.css`);
  }
});

test('the hard offset shadow survives the lacquer', () => {
  // The edge carries, even when it shines. If it drops away, it is a
  // different anatomy and not the same theme in another material.
  const karte = glanz.slice(glanz.indexOf('[data-theme="hochglanz"] .card'));
  assert.match(
    karte,
    /0 4px 0 var\(--ink\)/,
    'The hard offset shadow disappeared in the lacquer. Then something other than ' +
      'noppe shines, and it is no longer the same design.',
  );
});

test('the light stripe does not lie over the whole tile', () => {
  // A white veil over white text is no shine but gray.
  const strip = '118deg';
  assert.ok(glanz.includes(strip), 'The light streak is missing entirely');
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
  assert.ok(fromCss.length >= 4, `Only ${fromCss.length} breakpoints in the CSS — does the search still work?`);
});

test('the lid is ONE building block, not two', () => {});

/** The two rules that draw a stud row. */
const studsRows = () => css.split('}').filter(r => /header::before|\.sc::after/.test(r.slice(0, r.indexOf('{') + 1)));

test('the studs have a round top edge, not a gradient edge', () => {
  const reihen = studsRows();
  // Self-proof: MEASURED there are two — the header bar and the tile lid.
  assert.equal(reihen.length, 2, `${reihen.length} stud rows found instead of two — does the search still work?`);

  for (const rowList of reihen) {
    const kopf = rowList.slice(0, rowList.indexOf('{')).trim();
    assert.ok(rowList.includes('var(--studs-form)'), `"${kopf}" does not use the stud shape`);
    assert.ok(
      !/repeating-linear-gradient/.test(rowList),
      `"${kopf}" draws the studs as a gradient again. A gradient cannot do ` +
        'rounded corners — that is exactly why they looked like dashes.',
    );
    assert.ok(
      !/border-radius/.test(rowList),
      `"${kopf}" rounds with border-radius. That rounds the BAR, not the ` +
        'single stud — the difference was visible in the running app.',
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
    `The stud shape appears ${explanations} times in the tree. Once is enough; every ` +
      'further row takes the same shape at a different beat (mask-size).',
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
    `The mask beats are ${masksTicks.join(', ')} — does the search still work?`,
  );
  assert.deepEqual(
    [...new Set(glossTicks)].sort(),
    ['22', '24'],
    `The gloss repeats at the beat ${glossTicks.join(', ')}, but the mask ` +
      `at the beat ${[...new Set(masksTicks)].join(', ')}. Then the highlight ` +
      'no longer sits on the stud.',
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
    `${colorRules.length} rules with a cap colour instead of six — does the search still work?`,
  );

  const shortForm = colorRules
    .filter(r => /(?:^|[;{\s])background:\s*var\(--brick-/.test(r))
    .map(r => r.slice(0, r.indexOf('{')).trim().split(',')[0]);
  assert.deepEqual(
    shortForm,
    [],
    'These rules set the cap colour with the shorthand `background:`. It ' +
      'thereby clears the `background-image` of the lacquer — and because :nth-child counts ' +
      'like a class, it wins against hochglanz.css. `background-color:` ' +
      'only sets the colour and leaves the lacquer in place.',
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
    'themes/noppe.css keeps its own stud shape again — then the ' +
      'brick design has its own, and that is exactly how the difference came about.',
  );
  assert.match(stein, /var\(--studs-form\)/, 'The brick design does not use the shared stud shape');
  // Only the ROW, not every circle: the handles of the year sliders are
  // round buttons with a highlight (`circle at 35% 32%`) and should stay
  // that. A stud row is recognized by its anchoring in pixels —
  // `circle at 8px center`, repeated every 16px. The first version forbade
  // both and would have torn down two correct rules with it.
  const reihen = [...stein.matchAll(/radial-gradient\(circle at \d+px center/g)];
  assert.deepEqual(
    reihen.map(m => m[0]),
    [],
    'The brick design draws a stud row as circles again. From the front ' +
      'a stud is a rectangle with a rounded top edge — that was the reason why ' +
      'the edge looked like „ein Balken mit Punkten“.',
  );
});
