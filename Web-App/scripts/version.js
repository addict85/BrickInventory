'use strict';
/**
 * The version of this build: APP_VERSION (CI, Docker build argument), otherwise
 * `git describe`, otherwise "unknown". It is written to dist/version.json at build time
 * — never into the working tree, so that `npm ci` and `npm run build`
 * change no file in the repository.
 *
 * Call: node scripts/version.js [--outdir dist]   (otherwise output only)
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

/** @param {Record<string, string | undefined>} env @returns {string} */
function buildVersion(env = process.env, cwd = ROOT) {
  const assigned = (env.APP_VERSION || '').trim();
  if (assigned) return assigned;
  // The Android tags (android-v…, apk-neuste) belong to the app; the web app would otherwise name their number.
  try {
    return (
      execFileSync(
        'git',
        ['describe', '--tags', '--exclude', 'android-*', '--exclude', 'apk-*', '--always', '--dirty'],
        {
          cwd,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      ).trim() || 'unbekannt'
    );
  } catch {
    // No Git (Docker context without .git): without a build argument it stays open.
    return 'unbekannt';
  }
}

/** @param {string} outdir @param {string} version */
function writeVersion(outdir, version) {
  fs.mkdirSync(outdir, { recursive: true });
  fs.writeFileSync(
    path.join(outdir, 'version.json'),
    JSON.stringify({ version, built: new Date().toISOString() }, null, 2) + '\n',
  );
}

if (require.main === module) {
  const i = process.argv.indexOf('--outdir');
  const target = i !== -1 ? process.argv[i + 1] : undefined;
  const version = buildVersion();
  if (target) writeVersion(path.resolve(target), version);
  console.log(`[version] ${version}`);
}

module.exports = { buildVersion, writeVersion };
