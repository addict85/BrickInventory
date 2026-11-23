/**
 * Finds German identifiers in JavaScript/TypeScript source text, for the
 * language ratchet in ratschen.test.js. Comments and string contents are
 * dropped first: user-facing texts stay German on purpose (CLAUDE.md).
 */
const fs = require('node:fs');
const path = require('node:path');

const WORDS = new Set(
  fs
    .readFileSync(path.join(__dirname, '..', 'fixtures', 'german-words.txt'), 'utf8')
    .split(/\s+/)
    .filter(Boolean),
);

/** Camel and snake parts of one identifier, lower case. */
function parts(id) {
  return id
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9äöüÄÖÜß]+/)
    .filter(Boolean)
    .map(w => w.toLowerCase());
}

/** German if one part is a known German word or has an umlaut. A trailing
 *  `An`/`Ab`/`Auf`/`Aus`/`Zu` is a split-off verb prefix, and an article after
 *  the first part (`backInDieTable`) is half-translated German. */
function isGerman(id) {
  const p = parts(id);
  if (p.some(w => /[äöüß]/.test(w) || WORDS.has(w))) return true;
  if (p.length > 1 && /^(an|ab|auf|aus|zu)$/.test(p[p.length - 1])) return true;
  return p.slice(1).some(w => /^(die|der|das|dem|den)$/.test(w));
}

/** Code without comments and without the contents of strings and templates.
 *  Code inside `${…}` is scanned again, so a nested string or template there
 *  does not end the outer template early and turn its text into "code". */
function codeOnly(src) {
  let i = 0;
  /** Scans code until an unmatched `}` (inside a template) or the end. */
  function code(inTemplate) {
    let out = '';
    let depth = 0;
    while (i < src.length) {
      const c = src[i];
      const n = src[i + 1];
      if (c === '/' && n === '/') {
        while (i < src.length && src[i] !== '\n') i++;
      } else if (c === '/' && n === '*') {
        i = src.indexOf('*/', i + 2);
        i = i < 0 ? src.length : i + 2;
      } else if (c === "'" || c === '"') {
        i++;
        while (i < src.length && src[i] !== c && src[i] !== '\n') i += src[i] === '\\' ? 2 : 1;
        i++;
        out += "''";
      } else if (c === '/' && /(^|[(,=:[!&|?{};+\-*%<>~^]|\breturn)\s*$/.test(out.slice(-12))) {
        // A regex literal: its quotes and backticks are no strings.
        regex();
        out += "''";
      } else if (c === '`') {
        i++;
        out += ` ${template()} `;
      } else if (c === '{') {
        depth++;
        out += c;
        i++;
      } else if (c === '}') {
        if (inTemplate && depth === 0) {
          i++;
          return out;
        }
        depth--;
        out += c;
        i++;
      } else {
        out += c;
        i++;
      }
    }
    return out;
  }
  /** Skips a regex literal including its flags; `/` inside a class does not end it. */
  function regex() {
    let inClass = false;
    i++;
    while (i < src.length && src[i] !== '\n') {
      const c = src[i];
      if (c === '\\') i++;
      else if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) break;
      i++;
    }
    i++;
    while (/[a-z]/.test(src[i] ?? '')) i++;
  }
  /** Drops the text of a template and keeps the code of its `${…}` parts. */
  function template() {
    let out = "''";
    while (i < src.length && src[i] !== '`') {
      if (src[i] === '\\') i += 2;
      else if (src[i] === '$' && src[i + 1] === '{') {
        i += 2;
        out += ` ${code(true)} `;
      } else i++;
    }
    i++;
    return out;
  }
  return code(false);
}

/** Distinct German identifiers of one source text. */
function germanIdentifiers(src) {
  const found = new Set();
  for (const m of codeOnly(src).matchAll(/[A-Za-z_$][\w$]*/g)) if (isGerman(m[0])) found.add(m[0]);
  return found;
}

module.exports = { germanIdentifiers, isGerman, codeOnly };
