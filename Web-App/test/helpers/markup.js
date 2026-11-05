/**
 * Die echten Markup-Helfer (00-escapen.js, setzeHtml/fuegeHtmlEin aus 01-dom.js)
 * für Tests, die ein Modul ohne Bündel in einer Sandbox laufen lassen. Nachbauen
 * hiesse: Die Sandbox prüfte eine andere Maskierung als die Seite.
 */
const fs = require('node:fs');
const path = require('node:path');

const JS = path.join(__dirname, '..', '..', 'public', 'js');

/** Quelltext einer exportierten Funktion, ohne `export`. */
function funktion(src, name) {
  const a = src.indexOf(`export function ${name}(`);
  if (a < 0) throw new Error(`${name}() nicht gefunden`);
  const e = src.indexOf('\n}\n', a);
  return src.slice(a, e + 2).replace(/^export /, '');
}

function markupHelfer() {
  const escapen = fs.readFileSync(path.join(JS, '00-escapen.js'), 'utf8').replace(/^export /gm, '');
  const dom = fs.readFileSync(path.join(JS, '01-dom.js'), 'utf8');
  const namen = ['esc', 'escJs', 'escUrl', 'sichereUrl', 'escHex', 'hexZiffern', 'escHtmlAttr',
    'SicheresHtml', 'einsetzen', 'html', 'ungeprueft', 'setzeHtml', 'fuegeHtmlEin'];
  // eslint-disable-next-line no-new-func
  return new Function(`${escapen}\n${funktion(dom, 'setzeHtml')}\n${funktion(dom, 'fuegeHtmlEin')}\nreturn { ${namen.join(', ')} };`)();
}

module.exports = { markupHelfer };
