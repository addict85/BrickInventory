#!/usr/bin/env node
/**
 * Pfadverweise in Code-Kommentaren, README.md und docs/ auflösen; tote melden.
 * Ein Kommentar, der auf eine verschwundene Datei zeigt, schickt den Leser ins
 * Leere. Aufruf: node scripts/verweise-pruefen.js [Web-App-Verzeichnis]
 * Ausgabe je totem Verweis `datei:zeile pfad`, Exit-Code 1, wenn es welche gibt.
 */
const fs = require('node:fs');
const path = require('node:path');

const AUSSEN_VOR = new Set(['node_modules', 'dist', 'coverage', 'data', '.git', 'vendor', 'test']);
const ENDUNGEN = 'ts|js|sql|html|css|json|md|sh|ya?ml|kt|kts|xml|txt';
// Frühere Ordner: Ein Verweis darauf ist sicher tot, würde ohne den Ordner aber nicht als Pfad erkannt.
const FRUEHER = ['utils', 'handlers'];

/** @param {string} web */
function pruefe(web) {
  const repo = path.dirname(web);
  const ordner = [web, repo]
    .flatMap(w =>
      fs
        .readdirSync(w, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name),
    )
    .filter(n => !['node_modules', 'dist', 'coverage', 'data', '.git'].includes(n))
    .concat(FRUEHER);
  const muster = new RegExp(
    `(?<![\\w./-])((?:${ordner.map(n => n.replace(/[.]/g, '\\.')).join('|')})/[\\w./-]*\\w\\.(?:${ENDUNGEN}))\\b`,
    'g',
  );
  /** @param {string} p @param {string} datei */
  const gibt = (p, datei) =>
    [web, repo, path.dirname(datei)].some(
      w => fs.existsSync(path.join(w, p)) || (p.endsWith('.js') && fs.existsSync(path.join(w, `${p.slice(0, -3)}.ts`))),
    );

  /** @type {string[]} */
  const quellen = [];
  /** @type {string[]} */
  const doku = [path.join(web, 'README.md')];
  (function lauf(/** @type {string} */ d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!AUSSEN_VOR.has(e.name)) lauf(p);
      } else if (/\.(ts|js|sh)$/.test(e.name) && !e.name.startsWith('app.bundle.js')) quellen.push(p);
      else if (e.name.endsWith('.md') && path.relative(web, p).startsWith(`docs${path.sep}`)) doku.push(p);
    }
  })(web);

  /** @type {string[]} */
  const tot = [];
  let gesehen = 0;
  /** @param {string} datei @param {(z: string) => string} teil Der zu prüfende Teil einer Zeile */
  const lies = (datei, teil) =>
    fs
      .readFileSync(datei, 'utf8')
      .split('\n')
      .forEach((z, i) => {
        for (const m of teil(z).matchAll(muster)) {
          gesehen++;
          if (!gibt(m[1], datei)) tot.push(`${path.relative(web, datei)}:${i + 1} ${m[1]}`);
        }
      });
  for (const f of quellen) lies(f, f.endsWith('.sh') ? kommentarSh : kommentarJs);
  for (const f of doku) if (fs.existsSync(f)) lies(f, z => z);
  return { tot, gesehen, dateien: quellen.length + doku.length };
}

/** Nur der Kommentarteil: eine Kommentarzeile ganz, sonst was hinter ` // ` steht
 * (das Leerzeichen davor hält `https://` heraus). */
function kommentarJs(/** @type {string} */ z) {
  const t = z.trim();
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return t;
  const i = z.search(/\s\/\/\s/);
  return i === -1 ? '' : z.slice(i);
}
function kommentarSh(/** @type {string} */ z) {
  const i = z.search(/(^|\s)#/);
  return i === -1 ? '' : z.slice(i);
}

module.exports = { pruefe };

if (require.main === module) {
  const web = path.resolve(process.argv[2] || path.join(__dirname, '..'));
  const { tot, gesehen, dateien } = pruefe(web);
  for (const z of tot) console.log(z);
  console.error(`[verweise] ${gesehen} Pfadverweise in ${dateien} Dateien, ${tot.length} tot`);
  process.exitCode = tot.length ? 1 : 0;
}
