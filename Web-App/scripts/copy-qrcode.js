#!/usr/bin/env node
/**
 * QRCode.js comes from the npm dependency qrcodejs (exact version in
 * package.json), so that npm audit and Dependabot see it. This script puts
 * script and license into public/vendor/qrcode/; build-frontend.js calls it.
 *
 *   node scripts/copy-qrcode.js [target root]
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const FILES = ['qrcode.min.js', 'LICENSE'];

/** @returns the copied version, or null without an installed qrcodejs */
function copyQrcode(target = ROOT, source = ROOT) {
  const pkg = path.join(source, 'node_modules', 'qrcodejs');
  if (!fs.existsSync(path.join(pkg, 'package.json'))) return null;
  const version = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8')).version;
  const folder = path.join(target, 'public', 'vendor', 'qrcode');
  fs.mkdirSync(folder, { recursive: true });
  for (const d of FILES) fs.copyFileSync(path.join(pkg, d), path.join(folder, d));
  return version;
}

module.exports = { copyQrcode, FILES };

if (require.main === module) {
  const version = copyQrcode(process.argv[2] ? path.resolve(process.argv[2]) : ROOT);
  console.log(
    version
      ? `[qrcode] qrcodejs ${version} → public/vendor/qrcode/`
      : '[qrcode] qrcodejs nicht installiert — die eingecheckten Dateien bleiben',
  );
}
