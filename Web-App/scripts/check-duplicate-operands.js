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
    limit = null;
  for (let i = 0; i < t.length; i++) {
    // `const c = t[i]` would be `string|undefined` under noUncheckedIndexedAccess.
    // charAt() returns '' for an index outside — unreachable here,
    // but the type says so without a `!` being necessary.
    const c = t.charAt(i);
    if (limit) {
      out += c;
      if (c === '\\' && i + 1 < t.length) {
        out += t[i + 1];
        i++;
      } else if (c === limit) limit = null;
    } else if (c === '"' || c === "'" || c === '`' || c === '/') {
      limit = c;
      out += c;
    } else if (!/\s/.test(c)) out += c;
  }
  return out;
}

/** Expression left of position i, bracket-balanced. */
/** @param {string} s @param {number} i */
function links(s, i) {
  let j = i - 1,
    depth = 0;
  while (j >= 0) {
    const c = s[j];
    if (c === ')' || c === ']' || c === '}') depth++;
    else if (c === '(' || c === '[' || c === '{') {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0 && (c === ',' || c === ';' || s.slice(j, j + 2) === '||' || s.slice(j, j + 2) === '&&'))
      break;
    j--;
  }
  return s.slice(j + 1, i);
}

/** Expression right of position i. */
/** @param {string} s @param {number} i */
function right(s, i) {
  let j = i,
    depth = 0;
  while (j < s.length) {
    const c = s[j];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0 && (c === ',' || c === ';' || s.slice(j, j + 2) === '||' || s.slice(j, j + 2) === '&&'))
      break;
    j++;
  }
  return s.slice(i, j);
}

/** @param {string} wurzel @param {string[]} extensions @param {string[]} from */
function files(wurzel, extensions, from) {
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
      if (from.some(a => p.includes(a))) continue;
      if (x.isDirectory()) lauf(p);
      else if (extensions.some(s => x.name.endsWith(s))) out.push(p);
    }
  };
  lauf(wurzel);
  return out;
}

// Only the web app: Kotlin source belongs in the Android suite, not in this one.
const sources = files(ROOT, ['.ts', '.js'], ['node_modules', `${path.sep}dist`, 'app.bundle', 'vendor', '.d.ts']);
if (sources.length < 300) {
  console.error(
    `❌ Nur ${sources.length} Quelldateien gefunden — Pfad veraltet? ` +
      'Eine leere Suche wäre still grün, und genau davor warnt der Kopf dieser Datei.',
  );
  process.exit(1);
}

const fehler = [];
let checked = 0;
for (const p of sources) {
  const rel = path.relative(path.join(ROOT, '..'), p);
  const rows = fs.readFileSync(p, 'utf8').split('\n');
  for (let i = 0; i < rows.length; i++) {
    const z = rows[i] ?? '';
    const t = z.trim();
    if (!t || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;

    // A) the same operand on both sides of || or &&
    for (const m of z.matchAll(/\|\||&&/g)) {
      checked++;
      const l = tight(links(z, m.index));
      const r = tight(right(z, m.index + 2));
      if (l.length >= 8 && l === r) {
        const short = `${path.relative(ROOT, p)}:${l}`;
        if (!ALLOWED.has(short)) fehler.push(`${rel}:${i + 1}  ${l} ${m[0]} ${l}`);
        break;
      }
    }

    // B) the same column twice in a SELECT list
    const sel = z.match(/SELECT\s+([A-Za-z_][\w\s,.]{4,200}?)\s+FROM\b/i);
    if (sel) {
      checked++;
      const sp = (sel[1] ?? '')
        .split(',')
        .map(x => (x.trim().split(/\s+/).pop() ?? '').split('.').pop() ?? '')
        .filter(x => x !== '');
      const duplicate = sp.filter((x, k) => sp.indexOf(x) !== k);
      if (duplicate.length) fehler.push(`${rel}:${i + 1}  SELECT … ${duplicate.join(', ')} zweimal`);
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
  `✅ Doppelte Operanden: ${sources.length} Dateien, ${checked} Stellen geprüft, ` +
    `${ALLOWED.size} begründete Ausnahme(n).`,
);
