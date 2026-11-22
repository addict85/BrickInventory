#!/usr/bin/env node
/**
 * Removes the rationale references from the comments under Web-App/. The archive
 * is no longer in the tree (CLAUDE.md); a reference pointed nowhere. Idempotent: a second run changes
 * nothing, which is why it can be applied again after every merge.
 *
 * Call: node scripts/remove-rationales.js [--pruefen] [root]
 *   --pruefen: only name them, exit 1 on findings; root: default is Web-App/
 */
const fs = require('node:fs');
const path = require('node:path');

const WEB = path.resolve(__dirname, '..');
// Assembled, so that neither this script nor its test counts itself as a finding.
const TARGET = ['docs', 'begruendungen'].join('/');
const PATH = `${TARGET.replace('/', '\\/')}\\/[^\\s*]+`;
const REFERENCE = new RegExp(`[ \\t]*Ausführlich:[ \\t]*${PATH}`);
const WRAP = new RegExp(`[ \\t]*Ausführlich:[ \\t]*\\n[ \\t]*\\/\\/[ \\t]*${PATH}[ \\t]*(?=\\n|$)`, 'g');
const OUT = new Set(['node_modules', 'dist', 'coverage', 'data', '.git', 'CHANGELOG', 'begruendungen', 'fixtures']);
const EXTENSION = /\.(?:ts|js|cjs|mjs|html|css|sh)$/;

const EMPTY_ROW = /^\s*(?:\/\/|\*|\/\*\*?\s*\*\/|<!--\s*-->)\s*$/;

/**
 * Appends a comment end (`*\/`, `-->`) to the last content line if the line does not grow beyond
 * biome.json's 120 characters as a result; otherwise it stays alone on its line.
 * @param {string[]} from
 * @param {string} rest
 * @param {string} indent
 */
function close(from, rest, indent) {
  const before = from[from.length - 1];
  if (before === undefined) return void from.push(indent + rest);
  const t = before.trim();
  if (rest === '*/' && (t === '/**' || t === '/*')) return void from.pop();
  if (rest === '-->' && t === '<!--') return void from.pop();
  if (/^\*\s*$/.test(t)) from.pop();
  const last = from[from.length - 1] ?? '';
  const tag = /^\s*\*\s*@/.test(last);
  if (!tag && `${last} ${rest}`.length <= 120) from[from.length - 1] = `${last} ${rest}`;
  else from.push(indent + rest);
}

/**
 * A row that holds a reference, without it. @param {string[]} from @param {string} z
 * @returns whether the kept text now ends with a blank line
 */
function withoutReference(from, z) {
  const fresh = z.replace(new RegExp(REFERENCE.source, 'g'), '').replace(/[ \t]+$/, '');
  const indent = (z.match(/^\s*/) || [''])[0];
  const t = fresh.trim().replace(/^\*\s+(?=\*\/$)/, '');
  if (t === '*/' || t === '-->') {
    close(from, t, indent);
    return false;
  }
  if (EMPTY_ROW.test(fresh)) {
    // A blank line of the comment directly before it would now stand at the end of the block.
    if (/^\s*\/\/$/.test(fresh) && /^\s*\/\/$/.test(from[from.length - 1] ?? '')) from.pop();
    return (from[from.length - 1] ?? '').trim() === '';
  }
  from.push(fresh);
  return false;
}

/**
 * Removes every reference from a source text; comments without remaining content disappear entirely.
 * @param {string} text
 * @returns {string}
 */
function removeReferences(text) {
  if (!REFERENCE.test(text) && !new RegExp(WRAP.source).test(text)) return text;
  const rows = text.replace(WRAP, '').split('\n');
  /** @type {string[]} */
  const from = [];
  // If the reference stood alone between two blank lines, one of them goes along.
  let emptyBefore = false;
  for (const z of rows) {
    if (REFERENCE.test(z)) {
      emptyBefore = withoutReference(from, z);
      continue;
    }
    if (!(emptyBefore && z.trim() === '')) from.push(z);
    emptyBefore = false;
  }
  // Whatever the reference alone filled would otherwise remain as an empty block or empty final line.
  return from
    .join('\n')
    .replace(/^[ \t]*\/\*\*?[ \t]*\n[ \t]*\*\/[ \t]*\n/gm, '')
    .replace(/^([ \t]*\*[ \t]*\S.*)\n[ \t]*\*[ \t]*\n([ \t]*\*\/)/gm, '$1\n$2');
}

/** @param {string} d @param {string[]} [out] */
function files(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      if (!OUT.has(e.name)) files(p, out);
    } else if (EXTENSION.test(e.name) && e.name !== 'app.bundle.js') out.push(p);
  }
  return out;
}

/** @param {string} wurzel */
function lauf(wurzel, checkOnly = false) {
  const changed = [];
  for (const f of files(wurzel)) {
    const alt = fs.readFileSync(f, 'utf8');
    const fresh = removeReferences(alt);
    if (fresh === alt) continue;
    changed.push(path.relative(wurzel, f));
    if (!checkOnly) fs.writeFileSync(f, fresh);
  }
  return changed;
}

if (require.main === module) {
  const check = process.argv.includes('--pruefen');
  const wurzel = process.argv.slice(2).find(a => !a.startsWith('--')) ?? WEB;
  const changed = lauf(path.resolve(wurzel), check);
  console.log(`[begruendungen] ${changed.length} Dateien ${check ? 'mit Verweisen' : 'bereinigt'}`);
  if (check && changed.length) {
    console.log(changed.join('\n'));
    process.exit(1);
  }
}

module.exports = { removeReferences, lauf };
