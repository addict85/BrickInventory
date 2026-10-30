'use strict';
/**
 * Die Version dieses Baus: APP_VERSION (CI, Docker-Build-Argument), sonst
 * `git describe`, sonst „unbekannt“. Sie wird zur Bauzeit nach dist/version.json
 * geschrieben — nie in den Arbeitsbaum, damit `npm ci` und `npm run build`
 * keine Datei im Repository verändern.
 *
 * Aufruf: node scripts/version.js [--outdir dist]   (sonst nur Ausgabe)
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/** @param {Record<string, string | undefined>} env @returns {string} */
function bauVersion(env = process.env) {
  const gesetzt = (env.APP_VERSION || '').trim();
  if (gesetzt) return gesetzt;
  try {
    return execFileSync('git', ['describe', '--tags', '--always', '--dirty'],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || 'unbekannt';
  } catch {
    // Kein Git (Docker-Kontext ohne .git): Ohne Build-Argument bleibt es offen.
    return 'unbekannt';
  }
}

/** @param {string} outdir @param {string} version */
function schreibe(outdir, version) {
  fs.mkdirSync(outdir, { recursive: true });
  fs.writeFileSync(path.join(outdir, 'version.json'),
    JSON.stringify({ version, gebaut: new Date().toISOString() }, null, 2) + '\n');
}

if (require.main === module) {
  const i = process.argv.indexOf('--outdir');
  const ziel = i !== -1 ? process.argv[i + 1] : undefined;
  const version = bauVersion();
  if (ziel) schreibe(path.resolve(ziel), version);
  console.log(`[version] ${version}`);
}

module.exports = { bauVersion, schreibe };
