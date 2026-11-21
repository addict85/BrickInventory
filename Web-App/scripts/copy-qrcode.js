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
const DATEIEN = ['qrcode.min.js', 'LICENSE'];

/** @returns the copied version, or null without an installed qrcodejs */
function copyQrcode(ziel = ROOT, quelle = ROOT) {
  const paket = path.join(quelle, 'node_modules', 'qrcodejs');
  if (!fs.existsSync(path.join(paket, 'package.json'))) return null;
  const fassung = JSON.parse(fs.readFileSync(path.join(paket, 'package.json'), 'utf8')).version;
  const ordner = path.join(ziel, 'public', 'vendor', 'qrcode');
  fs.mkdirSync(ordner, { recursive: true });
  for (const d of DATEIEN) fs.copyFileSync(path.join(paket, d), path.join(ordner, d));
  return fassung;
}

module.exports = { copyQrcode, DATEIEN };

if (require.main === module) {
  const fassung = copyQrcode(process.argv[2] ? path.resolve(process.argv[2]) : ROOT);
  console.log(
    fassung
      ? `[qrcode] qrcodejs ${fassung} → public/vendor/qrcode/`
      : '[qrcode] qrcodejs nicht installiert — die eingecheckten Dateien bleiben',
  );
}
