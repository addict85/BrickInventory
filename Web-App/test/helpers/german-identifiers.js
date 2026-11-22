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

/** German if one part is a known German word or has an umlaut; a trailing
 *  `An`/`Ab`/`Auf`/`Aus`/`Zu` part is a split-off German verb prefix. */
function isGerman(id) {
  const p = parts(id);
  if (p.some(w => /[äöüß]/.test(w) || WORDS.has(w))) return true;
  return p.length > 1 && /^(an|ab|auf|aus|zu|die|der|das|dem|den)$/.test(p[p.length - 1]);
}

/** Code without comments and without the contents of strings and templates. */
function codeOnly(src) {
  let out = '';
  let i = 0;
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
    } else if (c === '`') {
      // Template: drop the text, keep the code in ${…} (one nesting level is enough here).
      i++;
      while (i < src.length && src[i] !== '`') {
        if (src[i] === '\\') i += 2;
        else if (src[i] === '$' && src[i + 1] === '{') {
          const end = src.indexOf('}', i);
          out += ` ${src.slice(i + 2, end < 0 ? src.length : end)} `;
          i = end < 0 ? src.length : end + 1;
        } else i++;
      }
      i++;
      out += "''";
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Distinct German identifiers of one source text. */
function germanIdentifiers(src) {
  const found = new Set();
  for (const m of codeOnly(src).matchAll(/[A-Za-z_$][\w$]*/g)) if (isGerman(m[0])) found.add(m[0]);
  return found;
}

module.exports = { germanIdentifiers, isGerman, codeOnly };
