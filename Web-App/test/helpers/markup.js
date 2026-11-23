/**
 * The real markup helpers (escaping.js, setHtml/fuegeHtmlEin from dom.js)
 * for tests that run a module without the bundle in a sandbox. Rebuilding them
 * would mean: the sandbox checks a different escaping than the page.
 */
const fs = require('node:fs');
const path = require('node:path');

const JS = path.join(__dirname, '..', '..', 'public', 'js');

/** Source text of an exported function, without `export`. */
function funktion(src, name) {
  const a = src.indexOf(`export function ${name}(`);
  if (a < 0) throw new Error(`${name}() not found`);
  const e = src.indexOf('\n}\n', a);
  return src.slice(a, e + 2).replace(/^export /, '');
}

function markupHelper() {
  const escaping = fs.readFileSync(path.join(JS, 'escaping.js'), 'utf8').replace(/^export /gm, '');
  const dom = fs.readFileSync(path.join(JS, 'dom.js'), 'utf8');
  const namen = [
    'esc',
    'escJs',
    'escUrl',
    'safeUrl',
    'escHex',
    'rawHex',
    'escHtmlAttr',
    'SafeHtml',
    'toText',
    'html',
    'rawHtml',
    'joinHtml',
    'setHtml',
    'insertHtml',
  ];
  // eslint-disable-next-line no-new-func
  return new Function(
    `${escaping}\n${funktion(dom, 'setHtml')}\n${funktion(dom, 'insertHtml')}\nreturn { ${namen.join(', ')} };`,
  )();
}

module.exports = { markupHelper };
