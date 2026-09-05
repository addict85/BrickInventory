/**
 * Jeder Klassenname tut etwas — er gestaltet oder er ist ein Griff.
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 *
 * Dieselbe Fehlerklasse wie bei den Element-ids (dom-ids.test.js), nur eine
 * Ebene weiter: Ein `class="…"`, das kein Stylesheet kennt, sieht im Quelltext
 * nach Absicht aus und bewirkt nichts. Der Browser meldet nichts, die Seite
 * baut sich auf, und wer sie ansieht, kann nicht wissen, dass hier etwas
 * gemeint war.
 *
 * NACHGEMESSEN: 161 Klassennamen stehen in Auszeichnung oder werden per
 * classList gesetzt, 600 sind in den Stylesheets definiert. SECHS trugen
 * keine Regel — fünf davon zu Recht:
 *
 *   admin-only, parts-body, parts-list, pl-have-input, job-sched-input
 *
 * Die sind GRIFFE: JavaScript sucht Elemente daran (querySelector,
 * classList.contains). Ein Griff braucht keine Regel, und ihn zu melden hiesse,
 * eine Prüfung mit fünf Fehlalarmen zu bauen — die wird abgeschaltet, nicht
 * befolgt.
 *
 * Der sechste war `scope-select` an den vier Kontoauswahl-Feldern: kein
 * Stylesheet kannte ihn, kein JavaScript suchte danach. Die Breite stand
 * stattdessen viermal gleichlautend im style-Attribut. Jetzt trägt die Klasse
 * die Regel (styles.css), und die vier Inline-Angaben sind weg.
 *
 * ── Was der Test NICHT prüft ────────────────────────────────────────────────
 *
 * Die Gegenrichtung — eine CSS-Regel, die niemand benutzt — bleibt offen. Sie
 * ist harmlos (ein paar Byte) und liesse sich nur mit einem echten Parser
 * beantworten: Regeln wie `.dt tr:hover td` oder `[data-theme] .sc` treffen
 * Elemente, die erst zur Laufzeit entstehen.
 *
 * Zusammengesetzte Namen (`class="chip ${aktiv}"`) sieht er auch nicht; sie
 * tragen keinen festen Namen. Beides ist bewusst offen gelassen — die eine
 * Frage, die hier zählt, ist: Kann dieser Name überhaupt etwas bewirken?
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');

/**
 * Ein Klassenname in einem Selektor.
 *
 * Mit Vorausschau statt Verbrauch: `.bstat .bstat-l{…}` — ein Muster, das das
 * Trennzeichen MITISST, verschluckt den Punkt des zweiten Namens und meldet
 * ihn dann als undefiniert. Genau das ist beim ersten Anlauf passiert und hat
 * zwölf Fehlalarme erzeugt.
 */
const KLASSE = /\.(-?[A-Za-z_][\w-]*)(?=[\s,{:.[)>~+]|$)/g;

/** Alle Quelldateien der Oberfläche — ohne Kommentare, ohne das Bündel. */
function quellen() {
  const out = [];
  const lauf = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!/node_modules|locales/.test(p)) lauf(p); continue; }
      if (e.name === 'app.bundle.js') continue;
      if (!/\.(js|css|html)$/.test(e.name)) continue;
      let s = fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      if (e.name.endsWith('.js')) s = s.replace(/^\s*\/\/.*$/gm, '');
      out.push([path.relative(ROOT, p), s]);
    }
  };
  lauf(PUB);
  return out;
}

test('jeder Klassenname gestaltet etwas oder ist ein Griff', () => {
  const dateien = quellen();
  assert.ok(dateien.length >= 20, `Nur ${dateien.length} Quelldateien gefunden`);

  // Definiert: alles, was in einem Stylesheet als Selektor steht — UND was das
  // Skript selbst als Stil zusammensetzt. Die Protokollseite (01-core.js) baut
  // ihr eigenes <style> als Zeichenkette; ohne diesen Schritt gälten ihre
  // sechs Klassen als undefiniert.
  const definiert = new Set();
  for (const [rel, s] of dateien)
    if (/\.(css|js)$/.test(rel))
      for (const m of s.matchAll(KLASSE)) definiert.add(m[1]);
  // GEMESSEN sind es 600.
  assert.ok(definiert.size >= 300,
    `Nur ${definiert.size} Klassennamen in den Stylesheets — Muster veraltet?`);

  // Griffe: Namen, an denen JavaScript Elemente sucht oder umschaltet.
  const griffe = new Set();
  for (const [rel, s] of dateien) {
    if (!rel.endsWith('.js')) continue;
    for (const m of s.matchAll(/classList\.\w+\(\s*['"]([\w-]+)['"]/g)) griffe.add(m[1]);
    for (const m of s.matchAll(/(?:querySelector|querySelectorAll|closest|matches)\(\s*['"`]([^'"`]*)['"`]/g))
      for (const t of m[1].matchAll(KLASSE)) griffe.add(t[1]);
    for (const m of s.matchAll(/getElementsByClassName\(\s*['"]([\w-]+)['"]/g)) griffe.add(m[1]);
  }
  assert.ok(griffe.size >= 20, `Nur ${griffe.size} Griffe gefunden — Muster veraltet?`);

  const benutzt = new Map();
  for (const [rel, s] of dateien) {
    if (rel.endsWith('.css')) continue;
    // Kein `$` und keine Klammer: `class="chip ${aktiv}"` ist zusammengesetzt.
    for (const m of s.matchAll(/class="([^"$<>{]*)"/g))
      for (const k of m[1].trim().split(/\s+/))
        if (k && !benutzt.has(k)) benutzt.set(k, rel);
    for (const m of s.matchAll(/classList\.\w+\(\s*['"]([\w-]+)['"]/g))
      if (!benutzt.has(m[1])) benutzt.set(m[1], rel);
  }
  // GEMESSEN sind es 161.
  assert.ok(benutzt.size >= 100,
    `Nur ${benutzt.size} benutzte Klassennamen gefunden — Muster veraltet?`);

  const wirkungslos = [...benutzt]
    .filter(([k]) => !definiert.has(k) && !griffe.has(k))
    .map(([k, rel]) => `${k}   (${rel})`)
    .sort();
  assert.deepEqual(wirkungslos, [],
    'Diese Klassennamen kennt kein Stylesheet, und kein Skript sucht danach:\n  ' +
    wirkungslos.join('\n  ') +
    '\nEntweder fehlt die Regel — dann sieht die Stelle anders aus als gemeint —, ' +
    'oder der Name ist übrig geblieben und gehört weg.');
});
