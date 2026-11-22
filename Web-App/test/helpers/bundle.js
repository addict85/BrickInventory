/**
 * The bundle (public/js/app.bundle.js) is a product and not in git.
 * Every test that reads it or starts a server with a UI fetches it
 * here; the build itself is only in scripts/build-frontend.js.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { OUT_REL, placeBundleSafe } = require('../../scripts/build-frontend');

const ROOT = path.join(__dirname, '..', '..');
const BUNDLE_FILE = path.join(ROOT, 'public', OUT_REL);

/**
 * A bundle from main.js plus `extra` (source text with imports relative to
 * public/js), for example to put the registry on window. The shipped
 * bundle stays unchanged; the file is deleted at process end.
 * Usage: `process.env.TEST_BUENDEL = buildTestbuendel(…)` before helpers/oberflaeche.
 * @param {string} name
 * @param {string} extra
 */
function buildTestBundle(name, extra) {
  const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'));
  const { allowedStyles } = require('../../scripts/build-frontend');
  const ziel = path.join(os.tmpdir(), `${name}-${process.pid}.js`);
  esbuild.buildSync({
    stdin: {
      contents: `import './main.js';\n${extra}`,
      resolveDir: path.join(ROOT, 'public', 'js'),
      loader: 'js',
      sourcefile: `${name}-einstieg.js`,
    },
    bundle: true,
    format: 'iife',
    charset: 'utf8',
    outfile: ziel,
    logLevel: 'error',
    define: { __ALLOWED_STYLES__: JSON.stringify(allowedStyles()) },
  });
  process.on('exit', () => fs.rmSync(ziel, { force: true }));
  return ziel;
}

module.exports = { BUNDLE_FILE, placeBundleSafe, buildTestBundle };
