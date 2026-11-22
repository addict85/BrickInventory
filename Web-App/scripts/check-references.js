#!/usr/bin/env node
/**
 * Resolve path references in code comments, README.md and docs/; report dead ones.
 * A comment pointing to a vanished file sends the reader into
 * nothing. Call: node scripts/check-references.js [Web-App directory]
 * Output per dead reference `file:line path`, exit code 1 if there are any.
 */
const fs = require('node:fs');
const path = require('node:path');

const OUTER_BEFORE = new Set(['node_modules', 'dist', 'coverage', 'data', '.git', 'vendor', 'test']);
const EXTENSIONS = 'ts|js|sql|html|css|json|md|sh|ya?ml|kt|kts|xml|txt';
// Former folders: a reference to them is surely dead, but without the folder it would not be recognized as a path.
const EARLIER = ['utils', 'handlers'];

/** @param {string} web */
function pruefe(web) {
  const repo = path.dirname(web);
  const folder = [web, repo]
    .flatMap(w =>
      fs
        .readdirSync(w, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name),
    )
    .filter(n => !['node_modules', 'dist', 'coverage', 'data', '.git'].includes(n))
    .concat(EARLIER);
  const muster = new RegExp(
    `(?<![\\w./-])((?:${folder.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})/[\\w./-]*\\w\\.(?:${EXTENSIONS}))\\b`,
    'g',
  );
  /** @param {string} p @param {string} datei */
  const gibt = (p, datei) =>
    [web, repo, path.dirname(datei)].some(
      w => fs.existsSync(path.join(w, p)) || (p.endsWith('.js') && fs.existsSync(path.join(w, `${p.slice(0, -3)}.ts`))),
    );

  /** @type {string[]} */
  const sources = [];
  /** @type {string[]} */
  const docs = [path.join(web, 'README.md')];
  (function lauf(/** @type {string} */ d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!OUTER_BEFORE.has(e.name)) lauf(p);
      } else if (/\.(ts|js|sh)$/.test(e.name) && !e.name.startsWith('app.bundle.js')) sources.push(p);
      else if (e.name.endsWith('.md') && path.relative(web, p).startsWith(`docs${path.sep}`)) docs.push(p);
    }
  })(web);

  /** @type {string[]} */
  const tot = [];
  let gesehen = 0;
  /** @param {string} datei @param {(z: string) => string} teil the part of a line to check */
  const lies = (datei, teil) =>
    fs
      .readFileSync(datei, 'utf8')
      .split('\n')
      .forEach((z, i) => {
        for (const m of teil(z).matchAll(muster)) {
          const pfad = m[1] ?? '';
          gesehen++;
          if (!gibt(pfad, datei)) tot.push(`${path.relative(web, datei)}:${i + 1} ${pfad}`);
        }
      });
  for (const f of sources) lies(f, f.endsWith('.sh') ? commentSh : commentJs);
  for (const f of docs) if (fs.existsSync(f)) lies(f, z => z);
  return { tot, gesehen, dateien: sources.length + docs.length };
}

/** Only the comment part: a comment line entirely, otherwise what stands behind ` // `
 * (the space before it keeps `https://` out). */
function commentJs(/** @type {string} */ z) {
  const t = z.trim();
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return t;
  const i = z.search(/\s\/\/\s/);
  return i === -1 ? '' : z.slice(i);
}
function commentSh(/** @type {string} */ z) {
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
