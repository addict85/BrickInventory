#!/usr/bin/env node
/**
 * QRCode.js kommt aus der npm-Abhängigkeit qrcodejs (exakte Fassung in
 * package.json), damit npm audit und Renovate es sehen. Dieses Skript legt
 * Skript und Lizenz nach public/vendor/qrcode/; build-frontend.js ruft es.
 *
 *   node scripts/qrcode-kopieren.js [Zielwurzel]
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DATEIEN = ['qrcode.min.js', 'LICENSE'];

/** @returns die kopierte Fassung, oder null ohne installiertes qrcodejs */
function kopiereQrcode(ziel = ROOT, quelle = ROOT) {
  const paket = path.join(quelle, 'node_modules', 'qrcodejs');
  if (!fs.existsSync(path.join(paket, 'package.json'))) return null;
  const fassung = JSON.parse(fs.readFileSync(path.join(paket, 'package.json'), 'utf8')).version;
  const ordner = path.join(ziel, 'public', 'vendor', 'qrcode');
  fs.mkdirSync(ordner, { recursive: true });
  for (const d of DATEIEN) fs.copyFileSync(path.join(paket, d), path.join(ordner, d));
  return fassung;
}

module.exports = { kopiereQrcode, DATEIEN };

if (require.main === module) {
  const fassung = kopiereQrcode(process.argv[2] ? path.resolve(process.argv[2]) : ROOT);
  console.log(
    fassung
      ? `[qrcode] qrcodejs ${fassung} → public/vendor/qrcode/`
      : '[qrcode] qrcodejs nicht installiert — die eingecheckten Dateien bleiben',
  );
}
