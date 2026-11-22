/**
 * Every class name does something — it styles or it is a handle.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');

/**
 * A class name in a selector.
 *
 * With lookahead instead of consumption: `.bstat .bstat-l{…}` — a pattern that
 * EATS the separator swallows the dot of the second name and then reports
 * it as undefined. Exactly that happened on the first attempt and
 * produced twelve false alarms.
 */
const CLASS = /\.(-?[A-Za-z_][\w-]*)(?=[\s,{:.[)>~+]|$)/g;

/** All source files of the UI — without comments, without the bundle. */
function quellen() {
  const out = [];
  const lauf = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!/node_modules|locales/.test(p)) lauf(p);
        continue;
      }
      if (e.name === 'app.bundle.js') continue;
      if (!/\.(js|css|html)$/.test(e.name)) continue;
      let s = fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      if (e.name.endsWith('.js')) s = s.replace(/^\s*\/\/.*$/gm, '');
      out.push([path.relative(ROOT, p), s]);
    }
  };
  lauf(PUB);
  return out;
}

test('every class name styles something or is a handle', () => {
  const dateien = quellen();
  assert.ok(dateien.length >= 20, `Nur ${dateien.length} Quelldateien gefunden`);

  // Defined: everything that stands as a selector in a stylesheet — AND what the
  // script itself assembles as style. The log page (monitor.js) builds
  // its own <style> as a string; without this step its six classes would
  // count as undefined.
  const definiert = new Set();
  for (const [rel, s] of dateien) if (/\.(css|js)$/.test(rel)) for (const m of s.matchAll(CLASS)) definiert.add(m[1]);
  // Plus the one inline style in index.html (startup skeleton, via hash in the CSP).
  for (const [rel, s] of dateien)
    if (rel.endsWith('index.html'))
      for (const m of (/<style id="startstil">([\s\S]*?)<\/style>/.exec(s)?.[1] ?? '').matchAll(CLASS))
        definiert.add(m[1]);
  // MEASURED there are 600.
  assert.ok(definiert.size >= 300, `Nur ${definiert.size} Klassennamen in den Stylesheets — Muster veraltet?`);

  // Handles: names by which JavaScript finds or toggles elements.
  const griffe = new Set();
  for (const [rel, s] of dateien) {
    if (!rel.endsWith('.js')) continue;
    for (const m of s.matchAll(/classList\.\w+\(\s*['"]([\w-]+)['"]/g)) griffe.add(m[1]);
    for (const m of s.matchAll(
      /(?:querySelector|querySelectorAll|closest|matches|queryAll|queryOne)\(\s*['"`]([^'"`]*)['"`]/g,
    ))
      for (const t of m[1].matchAll(CLASS)) griffe.add(t[1]);
    for (const m of s.matchAll(/getElementsByClassName\(\s*['"]([\w-]+)['"]/g)) griffe.add(m[1]);
  }
  assert.ok(griffe.size >= 20, `Nur ${griffe.size} Griffe gefunden — Muster veraltet?`);

  const benutzt = new Map();
  for (const [rel, s] of dateien) {
    if (rel.endsWith('.css')) continue;
    // No `$` and no brace: `class="chip ${aktiv}"` is composed.
    for (const m of s.matchAll(/class="([^"$<>{]*)"/g))
      for (const k of m[1].trim().split(/\s+/)) if (k && !benutzt.has(k)) benutzt.set(k, rel);
    for (const m of s.matchAll(/classList\.\w+\(\s*['"]([\w-]+)['"]/g)) if (!benutzt.has(m[1])) benutzt.set(m[1], rel);
  }
  // MEASURED there are 161.
  assert.ok(benutzt.size >= 100, `Nur ${benutzt.size} benutzte Klassennamen gefunden — Muster veraltet?`);

  const wirkungslos = [...benutzt]
    .filter(([k]) => !definiert.has(k) && !griffe.has(k))
    .map(([k, rel]) => `${k}   (${rel})`)
    .sort();
  assert.deepEqual(
    wirkungslos,
    [],
    'Diese Klassennamen kennt kein Stylesheet, und kein Skript sucht danach:\n  ' +
      wirkungslos.join('\n  ') +
      '\nEntweder fehlt die Regel — dann sieht die Stelle anders aus als gemeint —, ' +
      'oder der Name ist übrig geblieben und gehört weg.',
  );
});
