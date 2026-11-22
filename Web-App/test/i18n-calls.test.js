/**
 * Every key the UI calls also stands in the dictionary.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadTranslations } = require('./helpers/sources');
const ROOT = path.join(__dirname, '..');

/** All source files of the UI — without comments, without the bundle. */
function oberflaeche() {
  const out = [];
  const lauf = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      // locales/ itself contains the keys as a definition, not as a call.
      if (e.isDirectory()) {
        if (!/node_modules|locales/.test(p)) lauf(p);
        continue;
      }
      if (!/\.(js|html)$/.test(e.name) || e.name === 'app.bundle.js') continue;
      // Comments out FIRST: i18n.js documents its own usage with
      // `t('key')` in a comment. Without this step the sample call
      // counts as a real location — exactly the trap that
      // test/helpers/sources.js warns about.
      out.push([
        path.relative(ROOT, p),
        fs
          .readFileSync(p, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, ''),
      ]);
    }
  };
  lauf(path.join(ROOT, 'public'));
  return out;
}

const CALL = /\bt(?:Raw)?\(\s*'([a-z0-9_.]+)'|\bt(?:Raw)?\(\s*"([a-z0-9_.]+)"|data-i18n(?:-tab)?="([a-z0-9_.]+)"/g;

test('every called i18n key is in the dictionary', () => {
  const { de, en } = loadTranslations();
  const existing = new Set([...Object.keys(de), ...Object.keys(en)]);
  assert.ok(existing.size >= 400, `Nur ${existing.size} Schlüssel geladen — Pfad oder Format veraltet?`);

  const dateien = oberflaeche();
  assert.ok(dateien.length >= 15, `Nur ${dateien.length} Quelldateien gefunden`);

  const gerufen = new Map();
  for (const [rel, src] of dateien)
    for (const m of src.matchAll(CALL)) {
      const k = m[1] || m[2] || m[3];
      if (!gerufen.has(k)) gerufen.set(k, rel);
    }
  // Self-proof: if the pattern no longer matches, the set would be empty and the
  // test green without having checked anything. MEASURED there are 542.
  assert.ok(gerufen.size >= 300, `Nur ${gerufen.size} Aufrufstellen gefunden — Muster veraltet?`);

  // Composed keys (`t('monitor.job.' + k)`) end in a dot.
  const prefixes = [...gerufen.keys()].filter(k => k.endsWith('.'));
  assert.equal(
    prefixes.length,
    1,
    `${prefixes.length} zusammengesetzte Schlüssel (${prefixes.join(', ')}) — erwartet ` +
      'wird genau einer (monitor.job.). Ein zweiter braucht dieselbe eigene ' +
      'Absicherung wie er: Das Ergebnis gegen den Schlüssel prüfen und auf etwas ' +
      'anderes zurückfallen.',
  );

  const fehlend = [...gerufen]
    .filter(([k]) => !k.endsWith('.') && !existing.has(k))
    .map(([k, rel]) => `${k}   (${rel})`)
    .sort();
  assert.deepEqual(
    fehlend,
    [],
    'Diese Schlüssel ruft die Oberfläche, aber es gibt sie nicht:\n  ' +
      fehlend.join('\n  ') +
      '\nt() gibt dann den Schlüssel selbst aus — im Text sichtbar, im aria-label ' +
      'liest ihn der Bildschirmleser vor.',
  );
});

/**
 * And the form of the call?
 */
test('every data-i18n form is also evaluated by applyLang', () => {
  const i18n = fs
    .readFileSync(path.join(ROOT, 'public', 'i18n.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  // dataset.i18nAttr → data-i18n-attr; dataset.i18n → data-i18n.
  const erlaubt = new Set(
    [...i18n.matchAll(/\bdataset\.(i18n[A-Za-z]*)/g)].map(
      m => 'data-' + m[1].replace(/[A-Z]/g, c => '-' + c.toLowerCase()),
    ),
  );
  assert.ok(
    erlaubt.size >= 3,
    `Nur ${erlaubt.size} Formen in i18n.js gefunden (${[...erlaubt].join(', ')}) — Muster veraltet?`,
  );

  const benutzt = new Map();
  for (const [rel, src] of oberflaeche())
    for (const m of src.matchAll(/\b(data-i18n[a-z-]*)\s*=/g)) if (!benutzt.has(m[1])) benutzt.set(m[1], rel);
  // MEASURED there are four forms, 386 occurrences.
  assert.ok(benutzt.size >= 2, `Nur ${benutzt.size} data-i18n-Formen im Markup gefunden`);

  const wirkungslos = [...benutzt]
    .filter(([f]) => !erlaubt.has(f))
    .map(([f, rel]) => `${f}   (${rel})`)
    .sort();
  assert.deepEqual(
    wirkungslos,
    [],
    'Diese data-i18n-Formen wertet applyLang() nicht aus:\n  ' +
      wirkungslos.join('\n  ') +
      `\nAusgewertet werden nur: ${[...erlaubt].sort().join(', ')}. Ein Attribut, das ` +
      'keine davon ist, sieht nach Übersetzung aus und lässt den Text stehen, wie er ' +
      'im Quelltext steht — in jeder Sprache.',
  );
});
