// Finds German code names under public/: identifiers, class names, IDs, data attributes, i18n keys and
// comments. What users read (texts in the locale files, HTML text and labels, the colour-word tables in
// i18n.js) is not code and stays German. Used by the language ratchet in test/ratschen.test.js.
const fs = require('node:fs');
const path = require('node:path');
const GERMAN_WORDS = require('./german-words');

const WEB = path.join(__dirname, '..', '..');

/** @param {string} dir @returns {string[]} */
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'vendor' ? [] : files(p);
    return /\.(js|css|html|svg)$/.test(e.name) && e.name !== 'app.bundle.js' ? [p] : [];
  });
}

/** The code part of a file: what users read is cut out. @param {string} file @param {string} src */
function codeOf(file, src) {
  if (/[\\/]locales[\\/]/.test(file))
    return [...src.matchAll(/^\s*'([^']+)':|\{(\w+)\}/gm)].map(m => m[1] ?? m[2]).join('\n');
  if (/\.(html|svg)$/.test(file)) {
    const comments = [...src.matchAll(/<!--[\s\S]*?-->/g)].map(m => m[0]);
    const markup = src
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/\s(?:aria-label|title|placeholder|alt|content|aria-description)="[^"]*"/g, ' ')
      .replace(/>[^<]*</g, '><');
    return [...comments, markup].join('\n');
  }
  if (/i18n\.js$/.test(file)) return src.replace(/const COLOR_WORDS_DE = [\s\S]*?export function colorName/, '');
  return src;
}

/** @param {string} token */
function germanWords(token) {
  return token
    .replace(/([a-zäöü])([A-ZÄÖÜ])/g, '$1 $2')
    .split(/[^A-Za-zÄÖÜäöüß]+/)
    .map(w => w.toLowerCase())
    .filter(w => /[äöüß]/.test(w) || GERMAN_WORDS.has(w));
}

/**
 * All German names with their place. `allowed` holds names that are not ours to rename (API field
 * names and values, server texts); a token counts as allowed if it, or any of its `.`/`_` suffixes, is in it.
 * @param {Set<string>} allowed
 */
function germanNames(allowed) {
  const ok = (/** @type {string} */ t) => {
    if (allowed.has(t)) return true;
    for (const seg of t.split('.')) {
      if (allowed.has(seg)) continue;
      const parts = seg.split('_');
      if (parts.some((_, i) => allowed.has(parts.slice(i).join('_')))) continue;
      if (!germanWords(seg).length) continue;
      return false;
    }
    return true;
  };
  /** @type {string[]} */
  const found = [];
  for (const f of [
    ...files(path.join(WEB, 'public')),
    ...['ui.d.ts', 'api.d.ts'].map(n => path.join(WEB, 'frontend-types', n)),
  ]) {
    const code = codeOf(f, fs.readFileSync(f, 'utf8'));
    for (const m of code.matchAll(/[A-Za-z_$äöüÄÖÜß][\w$äöüÄÖÜß-]*(?:\.[A-Za-z_][\w-]*)*/g)) {
      const t = m[0];
      // Segments of API paths and query parameters are the server's names (/v2/auth/second-factor?x=1).
      const before = code[m.index - 1];
      if (before === '/' || code[m.index + t.length] === '/' || /[?&]/.test(before ?? '')) continue;
      if (!germanWords(t).length || ok(t) || ok(t.replace(/^data-/, ''))) continue;
      found.push(`${path.relative(WEB, f)}: ${t}`);
    }
  }
  return found;
}

/** Field names, parameters and enum values of the API contract (contract.d.ts and docs/openapi-v2.json). */
function contractNames() {
  const s = fs.readFileSync(path.join(WEB, 'frontend-types', 'contract.d.ts'), 'utf8');
  const names = new Set([
    ...[...s.matchAll(/'([^'\n]*)'/g)].map(m => m[1]),
    ...[...s.matchAll(/\b([A-Za-z_]\w*)\??:/g)].map(m => m[1]),
    ...[...s.matchAll(/export (?:type|interface) (\w+)/g)].map(m => m[1]),
  ]);
  const visit = (/** @type {unknown} */ o, /** @type {string} */ key) => {
    if (Array.isArray(o)) {
      for (const v of o) if (key === 'enum' && typeof v === 'string') names.add(v);
      for (const v of o) visit(v, '');
    } else if (o && typeof o === 'object') {
      for (const [k, v] of Object.entries(o)) {
        if (key === 'properties') names.add(k);
        if (k === 'name' && typeof v === 'string' && 'in' in o) names.add(v);
        visit(v, k);
      }
    }
  };
  visit(JSON.parse(fs.readFileSync(path.join(WEB, 'docs', 'openapi-v2.json'), 'utf8')), '');
  return names;
}

module.exports = { germanNames, contractNames, germanWords };
