'use strict';
/**
 * The same operand twice — the typo that hides best.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/** Places where the repetition is intended. Each with a reason. */
const ALLOWED = new Map([
  ['test/rate-limit.test.js:l.tryConsume()', 'Der Aufruf ZÄHLT hoch — dreimal hintereinander ist genau der Punkt'],
]);

/** Remove whitespace, but not in strings or regex literals. */
/** @param {string} t */
function tight(t) {
  let out = '',
    grenze = null;
  for (let i = 0; i < t.length; i++) {
    // `const c = t[i]` would be `string|undefined` under noUncheckedIndexedAccess.
    // charAt() returns '' for an index outside — unreachable here,
    // but the type says so without a `!` being necessary.
    const c = t.charAt(i);
    if (grenze) {
      out += c;
      if (c === '\\' && i + 1 < t.length) {
        out += t[i + 1];
        i++;
      } else if (c === grenze) grenze = null;
    } else if (c === '"' || c === "'" || c === '`' || c === '/') {
      grenze = c;
      out += c;
    } else if (!/\s/.test(c)) out += c;
  }
  return out;
}

/** Expression left of position i, bracket-balanced. */
/** @param {string} s @param {number} i */
function links(s, i) {
  let j = i - 1,
    tiefe = 0;
  while (j >= 0) {
    const c = s[j];
    if (c === ')' || c === ']' || c === '}') tiefe++;
    else if (c === '(' || c === '[' || c === '{') {
      if (tiefe === 0) break;
      tiefe--;
    } else if (tiefe === 0 && (c === ',' || c === ';' || s.slice(j, j + 2) === '||' || s.slice(j, j + 2) === '&&'))
      break;
    j--;
  }
  return s.slice(j + 1, i);
}

/** Expression right of position i. */
/** @param {string} s @param {number} i */
function rechts(s, i) {
  let j = i,
    tiefe = 0;
  while (j < s.length) {
    const c = s[j];
    if (c === '(' || c === '[' || c === '{') tiefe++;
    else if (c === ')' || c === ']' || c === '}') {
      if (tiefe === 0) break;
      tiefe--;
    } else if (tiefe === 0 && (c === ',' || c === ';' || s.slice(j, j + 2) === '||' || s.slice(j, j + 2) === '&&'))
      break;
    j++;
  }
  return s.slice(i, j);
}

/** @param {string} wurzel @param {string[]} extensions @param {string[]} aus */
function dateien(wurzel, extensions, aus) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} d */
  const lauf = d => {
    let e;
    try {
      e = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const x of e) {
      const p = path.join(d, x.name);
      if (aus.some(a => p.includes(a))) continue;
      if (x.isDirectory()) lauf(p);
      else if (extensions.some(s => x.name.endsWith(s))) out.push(p);
    }
  };
  lauf(wurzel);
  return out;
}

// Only the web app: Kotlin source belongs in the Android suite, not in this one.
const quellen = dateien(ROOT, ['.ts', '.js'], ['node_modules', `${path.sep}dist`, 'app.bundle', 'vendor', '.d.ts']);
if (quellen.length < 300) {
  console.error(
    `❌ Nur ${quellen.length} Quelldateien gefunden — Pfad veraltet? ` +
      'Eine leere Suche wäre still grün, und genau davor warnt der Kopf dieser Datei.',
  );
  process.exit(1);
}

const fehler = [];
let geprueft = 0;
for (const p of quellen) {
  const rel = path.relative(path.join(ROOT, '..'), p);
  const zeilen = fs.readFileSync(p, 'utf8').split('\n');
  for (let i = 0; i < zeilen.length; i++) {
    const z = zeilen[i] ?? '';
    const t = z.trim();
    if (!t || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;

    // A) the same operand on both sides of || or &&
    for (const m of z.matchAll(/\|\||&&/g)) {
      geprueft++;
      const l = tight(links(z, m.index));
      const r = tight(rechts(z, m.index + 2));
      if (l.length >= 8 && l === r) {
        const kurz = `${path.relative(ROOT, p)}:${l}`;
        if (!ALLOWED.has(kurz)) fehler.push(`${rel}:${i + 1}  ${l} ${m[0]} ${l}`);
        break;
      }
    }

    // B) the same column twice in a SELECT list
    const sel = z.match(/SELECT\s+([A-Za-z_][\w\s,.]{4,200}?)\s+FROM\b/i);
    if (sel) {
      geprueft++;
      const sp = (sel[1] ?? '')
        .split(',')
        .map(x => (x.trim().split(/\s+/).pop() ?? '').split('.').pop() ?? '')
        .filter(x => x !== '');
      const doppelt = sp.filter((x, k) => sp.indexOf(x) !== k);
      if (doppelt.length) fehler.push(`${rel}:${i + 1}  SELECT … ${doppelt.join(', ')} zweimal`);
    }
  }
}

if (fehler.length) {
  console.error('❌ Doppelte Operanden:');
  for (const f of fehler) {
    console.error(
      `  ${f}\n     Derselbe Ausdruck zweimal ist entweder folgenlos — dann ist er ` +
        'irreführend — oder es war ein anderer gemeint. Beides gehört angesehen.',
    );
  }
  process.exit(1);
}
console.log(
  `✅ Doppelte Operanden: ${quellen.length} Dateien, ${geprueft} Stellen geprüft, ` +
    `${ALLOWED.size} begründete Ausnahme(n).`,
);
