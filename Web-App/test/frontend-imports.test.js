/**
 * Frontend-Module: Ruft eine Datei einen Namen auf, den ein ANDERES Modul
 * deklariert, ohne ihn zu importieren?
 *
 * ── Warum das nötig ist ─────────────────────────────────────────────────────
 * `public/js/` sind ES-Module, die der Bundler aneinanderreiht. Ein Aufruf, der
 * ins Leere zeigt, fällt weder beim Bauen noch beim Laden auf — erst wenn der
 * betroffene Knopf gedrückt wird, steht in der Browser-Konsole
 * „X is not defined", und die Handlung bricht mittendrin ab.
 *
 * Genau so gemeldet: Beim Eigentümerwechsel im Kaufpreis-Dialog warf
 * `closeModal is not defined`. Die Funktion lag als modul-lokale Funktion in
 * 02-gallery.js und war nur über registerActions() für data-click-Knöpfe
 * erreichbar — 07-admin.js rief sie direkt auf. Der Wechsel selbst war schon
 * gespeichert; sichtbar blieb ein offener Dialog und eine veraltete Galerie.
 *
 * Das ist die Frontend-Fassung von test/require-exports.test.js: Dort prüft
 * TypeScript die späten require() nicht, hier prüft niemand die Modulgrenzen.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const { ROOT, ohneKommentare } = require('./helpers/sources');
const JS_DIR = path.join(ROOT, 'public', 'js');

/**
 * Namen, die eine Datei auf OBERSTER Ebene deklariert (Spalte 0).
 *
 * Bewusst nur ohne Einrückung: Sonst landeten Funktionsparameter wie das
 * `resolve` aus `new Promise(resolve => …)` in der Liste der projektbekannten
 * Namen, und jede andere Datei mit einem eigenen Promise wäre fälschlich
 * angeschlagen.
 */
function deklarierteOben(src) {
  const namen = new Set();
  for (const m of src.matchAll(/^(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm)) namen.add(m[1]);
  for (const m of src.matchAll(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) namen.add(m[1]);
  for (const m of src.matchAll(/^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/gm)) namen.add(m[1]);
  return namen;
}

/** Alle Deklarationen einer Datei, auch verschachtelte — für „ist lokal da?". */
function deklarierte(src) {
  const namen = new Set();
  for (const m of src.matchAll(/(?:^|[;{}\s])(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g)) namen.add(m[1]);
  for (const m of src.matchAll(/(?:^|[;{}\s])(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) namen.add(m[1]);
  for (const m of src.matchAll(/(?:^|[;{}\s])(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g)) namen.add(m[1]);
  return namen;
}

/** Namen, die eine Datei importiert (inklusive Umbenennung via `as`). */
function importierte(src) {
  const namen = new Set();
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
    for (const roh of m[1].split(',')) {
      const n = roh.split(' as ').pop().trim();
      if (n) namen.add(n);
    }
  }
  for (const m of src.matchAll(/import\s+([A-Za-z_$][\w$]*)\s*(?:,|from)/g)) namen.add(m[1]);
  return namen;
}

test('jedes Frontend-Modul importiert, was es aufruft', () => {
  const dateien = fs.readdirSync(JS_DIR)
    .filter(f => f.endsWith('.js') && f !== 'app.bundle.js')
    // logviewer.js läuft im eigenen Popup-Fenster ohne Modulsystem und bringt
    // seine Helfer selbst mit — es teilt sich keinen Namensraum mit dem Rest.
    .filter(f => f !== 'logviewer.js');
  assert.ok(dateien.length > 8, `nur ${dateien.length} Frontend-Module gefunden`);

  const quellen = new Map();
  for (const f of dateien) quellen.set(f, ohneKommentare(fs.readFileSync(path.join(JS_DIR, f), 'utf8')));

  // ── i18n.js gehört dazu (Nachtrag 138) ────────────────────────────────────
  //
  // Diese Prüfung las ausschliesslich public/js/. i18n.js liegt eine Ebene
  // höher (public/i18n.js) und war damit unsichtbar — ihre Exporte galten als
  // „unbekannter Name" und wurden übersprungen.
  //
  // Marcos Befund: js/12-pdfviewer.js rief t() ohne Import. Im Browser
  // „ReferenceError: t is not defined", und zwar erst beim ÖFFNEN eines PDFs —
  // nicht beim Laden der Seite, also auch nicht beim Bündeln.
  quellen.set('../i18n.js', ohneKommentare(
    fs.readFileSync(path.join(ROOT, 'public', 'i18n.js'), 'utf8')));

  // Alle Namen, die IRGENDWO im Frontend deklariert werden. Nur diese werden
  // geprüft — dadurch schlägt der Test nicht bei Browser-Globalen an.
  const bekannt = new Map();
  for (const [f, src] of quellen) for (const n of deklarierteOben(src)) bekannt.set(n, f);

  const fehlend = [];
  for (const [f, src] of quellen) {
    const lokal = deklarierte(src);
    const imp   = importierte(src);
    for (const [name, herkunft] of bekannt) {
      if (herkunft === f || lokal.has(name) || imp.has(name)) continue;
      // Aufruf des Namens, nicht als Eigenschaft (obj.name) und nicht als
      // Zeichenkette in einer Aktionsliste.
      const aufruf = new RegExp(`(?<![.\\w$'"\`])${name}\\s*\\(`);
      if (aufruf.test(src)) fehlend.push(`public/js/${f}: ruft ${name}() aus ${herkunft} ohne Import`);
    }
  }

  assert.deepEqual(fehlend, [],
    `Aufrufe über Modulgrenzen ohne Import:\n  ${fehlend.join('\n  ')}`);
});
