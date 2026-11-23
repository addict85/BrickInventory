/**
 * Assertion messages of node:assert calls and whether they are German. Tests speak English
 * (CLAUDE.md); texts users read stay German, so quoted UI text inside a message does not count.
 */
const fs = require('node:fs');
const path = require('node:path');

const WORDS = new Set(
  fs
    .readFileSync(path.join(__dirname, '..', 'fixtures', 'german-words.txt'), 'utf8')
    .split(/\s+/)
    .filter(Boolean),
);

/** How many leading arguments an assert function takes before its message. */
const ARITY = {
  ok: 1,
  equal: 2,
  notEqual: 2,
  strictEqual: 2,
  notStrictEqual: 2,
  deepEqual: 2,
  notDeepEqual: 2,
  deepStrictEqual: 2,
  notDeepStrictEqual: 2,
  match: 2,
  doesNotMatch: 2,
  throws: 2,
  doesNotThrow: 2,
  rejects: 2,
  doesNotReject: 2,
  fail: 0,
};

/** Top-level arguments of the call whose opening parenthesis is at `open`. */
function argumentsAt(src, open) {
  const args = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') i++;
        else if (q === '`' && src[i] === '$' && src[i + 1] === '{') {
          let d = 1;
          i += 2;
          while (i < src.length && d > 0) {
            if (src[i] === '{') d++;
            else if (src[i] === '}') d--;
            if (d > 0) i++;
          }
        }
        i++;
      }
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && /[(,=:[!&|?{};]\s*$/.test(src.slice(Math.max(open, i - 8), i))) {
      // A regex literal: its quotes and brackets belong to the pattern, not to the call.
      for (let inClass = false, j = i + 1; j < src.length && src[j] !== '\n'; j++) {
        if (src[j] === '\\') j++;
        else if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) {
          i = j;
          break;
        }
      }
    } else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) {
      depth--;
      if (depth === 0) {
        args.push(src.slice(start, i).trim());
        return args.filter(Boolean);
      }
    } else if (c === ',' && depth === 1) {
      args.push(src.slice(start, i).trim());
      start = i + 1;
    }
  }
  return args;
}

/** Message arguments (string, template or concatenation) of all assert calls in a source text. */
function messages(src) {
  const out = [];
  for (const m of src.matchAll(/\bassert\.(\w+)\s*\(/g)) {
    const n = ARITY[m[1]];
    if (n === undefined) continue;
    const args = argumentsAt(src, m.index + m[0].length - 1);
    const msg = args[n];
    if (msg && /^['"`]/.test(msg)) out.push(msg);
  }
  for (const m of src.matchAll(/(?<![.\w])assert\s*\(/g)) {
    const args = argumentsAt(src, m.index + m[0].length - 1);
    if (args[1] && /^['"`]/.test(args[1])) out.push(args[1]);
  }
  return out;
}

const QUOTED = /„[^“\n]*“|“[^”\n]*”|«[^»\n]*»|\$\{[^}]*\}/g;
const PROSE =
  /(?<![\w-])(der|die|das|und|nicht|wird|ist|kein|keine|ohne|mit|nach|fehlt|steht|gefunden|erlaubt|sind|statt|muss|darf|wurde|noch|auch|einer|eine|ein|als|für|über|wenn|oder|beim|zum|zur|vom|im|dem|den|des|sich|soll|kann|zwei|alle|bei|aus|hat|sein|wird)(?![\w-])/;

/** German if the text outside quotes uses German prose words, known German words or umlauts. */
function isGermanMessage(literal) {
  const t = literal.replace(QUOTED, ' ').toLowerCase();
  if (PROSE.test(t)) return true;
  return (t.match(/(?<![\w-])[a-zäöüß]{4,}(?![\w-])/g) || []).some(w => WORDS.has(w) || /[äöüß]/.test(w));
}

/** German messages per file under test/ and test/helpers/. */
function germanMessages(dir) {
  const files = [dir, path.join(dir, 'helpers')].flatMap(d =>
    fs
      .readdirSync(d)
      .filter(n => n.endsWith('.js'))
      .map(n => path.join(d, n)),
  );
  const found = [];
  for (const f of files)
    for (const msg of messages(require('./sources').withoutComments(fs.readFileSync(f, 'utf8'))))
      if (isGermanMessage(msg)) found.push(`${path.relative(dir, f)}: ${msg.slice(0, 80)}`);
  return found;
}

module.exports = { messages, isGermanMessage, germanMessages };
