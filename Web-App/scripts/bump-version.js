'use strict';

// ── Automatische Versionierung (Server) ──────────────────────────────────────
// Erzeugt aus dem aktuellen Zeitpunkt die Version "YYYY.MM.DD.HHMM"
// (z. B. 2026.07.08.1430) und stempelt sie an alle relevanten Stellen:
//   • package.json  → "version"
//   • public/index.html → Cache-Busting (?v=…) für alle .js/.css-Referenzen + Build-Text
//   • public/version.json → zur Laufzeit auslesbar (optional)
//
// Läuft automatisch als npm "postinstall" und explizit im Docker-Build.
// Absichtlich extrem defensiv: Ein Fehler hier darf `npm install` NIE abbrechen.
// Deaktivierbar über  NO_VERSION_BUMP=1  (z. B. in CI ohne Bump gewünscht).

const fs   = require('fs');
const path = require('path');

/**
 * Lesbarer Text eines gefangenen Fehlers.
 *
 * Bewusst eine eigene, kurze Fassung statt utils/httpError: Dieses Skript
 * laeuft als eigenstaendiges Werkzeug ueber `node`, ohne den Build — es kann
 * ein TypeScript-Modul gar nicht laden. Die Regel ist dieselbe: Ein geworfener
 * String oder ein Objekt ohne `message` soll nicht als „undefined" enden.
 * @param {unknown} e
 * @returns {string}
 */
function fehlertext(e) {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string' && e) return e;
  // Der Umweg ueber die Zwischenvariable ist noetig, weil `typeof e === 'object'`
  // den Typ auf `object` verengt und der kein `message` kennt.
  const m = e ? /** @type {any} */ (e).message : undefined;
  if (typeof m === 'string' && m) return m;
  // `String([])` ist leer — siehe utils/httpError.ts, dort gefunden.
  return e === null || e === undefined ? 'Unbekannter Fehler' : (String(e) || 'Unbekannter Fehler');
}


function run() {
  if (process.env.NO_VERSION_BUMP === '1') {
    console.log('[version] NO_VERSION_BUMP=1 → übersprungen');
    return;
  }

  const now = new Date();
  const p = (/** @type {number} */ n, w = 2) => String(n).padStart(w, '0');
  const yyyy = now.getFullYear();
  const mm   = p(now.getMonth() + 1);
  const dd   = p(now.getDate());
  const hhmm = p(now.getHours()) + p(now.getMinutes()); // 4-stelliger Build-Stempel
  const version = `${yyyy}.${mm}.${dd}.${hhmm}`;

  const root = path.join(__dirname, '..');

  // 1) package.json → version
  try {
    const pkgPath = path.join(root, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    pkg.version = version;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`[version] package.json → ${version}`);
  } catch (e) {
    console.warn(`[version] package.json übersprungen: ${fehlertext(e)}`);
  }

  // 2) public/index.html → Cache-Busting-Query + Build-Text
  try {
    const htmlPath = path.join(root, 'public', 'index.html');
    if (fs.existsSync(htmlPath)) {
      let html = fs.readFileSync(htmlPath, 'utf8');
      // Cache-Busting für ALLE .js/.css-Referenzen (i18n.js, js/*.js, styles.css)
      // — beliebiger alter Wert wird ersetzt
      html = html.replace(/(\.js\?v=)[^"']+/g,  `$1${version}`);
      html = html.replace(/(\.css\?v=)[^"']+/g, `$1${version}`);
      // "Build …"-Anzeige (Datum/Version hinter dem Wort Build)
      html = html.replace(/(Build\s+)[0-9][0-9.]*/g, `$1${version}`);
      fs.writeFileSync(htmlPath, html);
      console.log(`[version] index.html → ${version}`);
    } else {
      console.log('[version] index.html (noch) nicht vorhanden → übersprungen');
    }
  } catch (e) {
    console.warn(`[version] index.html übersprungen: ${fehlertext(e)}`);
  }

  // 3) public/version.json → zur Laufzeit auslesbar
  try {
    const pubDir = path.join(root, 'public');
    if (fs.existsSync(pubDir)) {
      fs.writeFileSync(
        path.join(pubDir, 'version.json'),
        JSON.stringify({ version, builtAt: now.toISOString() }, null, 2) + '\n'
      );
    }
  } catch (e) {
    console.warn(`[version] version.json übersprungen: ${fehlertext(e)}`);
  }
}

try {
  run();
} catch (e) {
  // Niemals den Install/Build abbrechen
  console.warn(`[version] Bump fehlgeschlagen (ignoriert): ${fehlertext(e)}`);
}
