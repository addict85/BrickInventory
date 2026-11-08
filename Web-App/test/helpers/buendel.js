/**
 * Das Bündel (public/js/app.bundle.js) ist ein Erzeugnis und nicht in git.
 * Jeder Test, der es liest oder einen Server mit Oberfläche startet, holt es
 * hier; der Bau selbst steht nur in scripts/build-frontend.js.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { OUT_REL, stelleBuendelSicher } = require('../../scripts/build-frontend');

const ROOT = path.join(__dirname, '..', '..');
const BUENDEL = path.join(ROOT, 'public', OUT_REL);

/**
 * Ein Bündel aus main.js plus `zusatz` (Quelltext mit Importen relativ zu
 * public/js), etwa um die Registry auf window zu legen. Das ausgelieferte
 * Bündel bleibt unverändert; die Datei wird beim Prozessende gelöscht.
 * Nutzung: `process.env.TEST_BUENDEL = baueTestbuendel(…)` vor helpers/oberflaeche.
 * @param {string} name
 * @param {string} zusatz
 */
function baueTestbuendel(name, zusatz) {
  const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'));
  const { erlaubteStile } = require('../../scripts/build-frontend');
  const ziel = path.join(os.tmpdir(), `${name}-${process.pid}.js`);
  esbuild.buildSync({
    stdin: {
      contents: `import './main.js';\n${zusatz}`,
      resolveDir: path.join(ROOT, 'public', 'js'),
      loader: 'js',
      sourcefile: `${name}-einstieg.js`,
    },
    bundle: true,
    format: 'iife',
    charset: 'utf8',
    outfile: ziel,
    logLevel: 'error',
    define: { __ERLAUBTE_STILE__: JSON.stringify(erlaubteStile()) },
  });
  process.on('exit', () => fs.rmSync(ziel, { force: true }));
  return ziel;
}

module.exports = { BUENDEL, stelleBuendelSicher, baueTestbuendel };
