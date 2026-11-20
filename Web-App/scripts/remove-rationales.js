#!/usr/bin/env node
/**
 * Streicht die Verweise „ aus den Kommentaren unter Web-App/. Das Archiv
 * ist nicht mehr im Baum (CLAUDE.md); ein Verweis zeigte ins Leere. Idempotent: Ein zweiter Lauf ändert
 * nichts, deshalb lässt es sich nach jedem Zusammenführen erneut anwenden.
 *
 * Aufruf: node scripts/remove-rationales.js [--pruefen] [wurzel]
 *   --pruefen: nur nennen, Exit 1 bei Funden; wurzel: Vorgabe ist Web-App/
 */
const fs = require('node:fs');
const path = require('node:path');

const WEB = path.resolve(__dirname, '..');
// Zusammengesetzt, damit weder dieses Skript noch sein Test sich selbst als Fund zählen.
const ZIEL = ['docs', 'begruendungen'].join('/');
const PATH = `${ZIEL.replace('/', '\\/')}\\/[^\\s*]+`;
const REFERENCE = new RegExp(`[ \\t]*Ausführlich:[ \\t]*${PATH}`);
const WRAP = new RegExp(`[ \\t]*Ausführlich:[ \\t]*\\n[ \\t]*\\/\\/[ \\t]*${PATH}[ \\t]*(?=\\n|$)`, 'g');
const RAUS = new Set(['node_modules', 'dist', 'coverage', 'data', '.git', 'CHANGELOG', 'begruendungen', 'fixtures']);
const ENDUNG = /\.(?:ts|js|cjs|mjs|html|css|sh)$/;

const EMPTY_ROW = /^\s*(?:\/\/|\*|\/\*\*?\s*\*\/|<!--\s*-->)\s*$/;

/**
 * Hängt einen Kommentarschluss (`*\/`, `-->`) an die letzte Inhaltszeile, wenn die Zeile dadurch nicht über
 * die 120 Zeichen von biome.json wächst; sonst bleibt er allein auf seiner Zeile.
 * @param {string[]} aus
 * @param {string} rest
 * @param {string} indent
 */
function schliessen(aus, rest, indent) {
  const vorher = aus[aus.length - 1];
  if (vorher === undefined) return void aus.push(indent + rest);
  const t = vorher.trim();
  if (rest === '*/' && (t === '/**' || t === '/*')) return void aus.pop();
  if (rest === '-->' && t === '<!--') return void aus.pop();
  if (/^\*\s*$/.test(t)) aus.pop();
  const letzte = aus[aus.length - 1] ?? '';
  const tag = /^\s*\*\s*@/.test(letzte);
  if (!tag && `${letzte} ${rest}`.length <= 120) aus[aus.length - 1] = `${letzte} ${rest}`;
  else aus.push(indent + rest);
}

/**
 * Entfernt jeden Verweis aus einem Quelltext; Kommentare ohne übrigen Inhalt verschwinden ganz.
 * @param {string} text
 * @returns {string}
 */
function removeReferences(text) {
  if (!REFERENCE.test(text) && !new RegExp(WRAP.source).test(text)) return text;
  const zeilen = text.replace(WRAP, '').split('\n');
  /** @type {string[]} */
  const aus = [];
  // Stand der Verweis allein zwischen zwei Leerzeilen, fällt eine davon mit weg.
  let emptyBefore = false;
  for (const z of zeilen) {
    if (!REFERENCE.test(z)) {
      if (!(emptyBefore && z.trim() === '')) aus.push(z);
      emptyBefore = false;
      continue;
    }
    emptyBefore = false;
    const neu = z.replace(new RegExp(REFERENCE.source, 'g'), '').replace(/[ \t]+$/, '');
    const indent = (z.match(/^\s*/) || [''])[0];
    const t = neu.trim().replace(/^\*\s+(?=\*\/$)/, '');
    if (t === '*/' || t === '-->') {
      schliessen(aus, t, indent);
      continue;
    }
    if (EMPTY_ROW.test(neu)) {
      // Eine Leerzeile des Kommentars direkt davor stünde jetzt am Ende des Blocks.
      if (/^\s*\/\/$/.test(neu) && /^\s*\/\/$/.test(aus[aus.length - 1] ?? '')) aus.pop();
      emptyBefore = (aus[aus.length - 1] ?? '').trim() === '';
      continue;
    }
    aus.push(neu);
  }
  // Was der Verweis allein füllte, bleibt sonst als leerer Block oder leere Schlusszeile stehen.
  return aus
    .join('\n')
    .replace(/^[ \t]*\/\*\*?[ \t]*\n[ \t]*\*\/[ \t]*\n/gm, '')
    .replace(/^([ \t]*\*[ \t]*\S.*)\n[ \t]*\*[ \t]*\n([ \t]*\*\/)/gm, '$1\n$2');
}

/** @param {string} d @param {string[]} [raus] */
function dateien(d, raus = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      if (!RAUS.has(e.name)) dateien(p, raus);
    } else if (ENDUNG.test(e.name) && e.name !== 'app.bundle.js') raus.push(p);
  }
  return raus;
}

/** @param {string} wurzel */
function lauf(wurzel, checkOnly = false) {
  const geaendert = [];
  for (const f of dateien(wurzel)) {
    const alt = fs.readFileSync(f, 'utf8');
    const neu = removeReferences(alt);
    if (neu === alt) continue;
    geaendert.push(path.relative(wurzel, f));
    if (!checkOnly) fs.writeFileSync(f, neu);
  }
  return geaendert;
}

if (require.main === module) {
  const pruefen = process.argv.includes('--pruefen');
  const wurzel = process.argv.slice(2).find(a => !a.startsWith('--')) ?? WEB;
  const geaendert = lauf(path.resolve(wurzel), pruefen);
  console.log(`[begruendungen] ${geaendert.length} Dateien ${pruefen ? 'mit Verweisen' : 'bereinigt'}`);
  if (pruefen && geaendert.length) {
    console.log(geaendert.join('\n'));
    process.exit(1);
  }
}

module.exports = { removeReferences, lauf };
