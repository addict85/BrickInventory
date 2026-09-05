/**
 * Kein fester Text an einer Stelle, die der Nutzer liest.
 *
 * ── Die Regel gab es nur für die App ────────────────────────────────────────
 *
 * Android-App/…/StringResourceParityTest besteht seit jeher darauf, dass in
 * `Text(...)`, `contentDescription` und `Toast` kein Literal steht. Die
 * Weboberfläche hatte nichts Vergleichbares — und beide sollen gleich gut zu
 * benutzen sein, nicht nur gleich aussehen.
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 *
 * NACHGEMESSEN standen ELF Texte fest im Quelltext. Sieben davon waren
 * Knopfbeschriftungen, die nach einem Klick ZURÜCKGESCHRIEBEN wurden:
 *
 *     btn.textContent = 'Registrieren'   // im Markup: data-i18n="register.submit"
 *
 * Zwei Folgen, beide unbemerkt: In einer englischen Oberfläche stand nach dem
 * ersten Klick ein deutsches Wort auf dem Knopf. Und das Literal stimmte nicht
 * einmal mit dem Wörterbuch überein — `register.submit` heisst „Konto
 * erstellen"; der Knopf beschriftete sich also auch auf Deutsch um.
 *
 * Dazu vier Meldungen („Importiere…", „❌ Netzwerkfehler", „QR-Code
 * abgelaufen", „PDF.js nicht geladen") und das ganze Protokollfenster: sechs
 * Zeitspannen, Titel, Suchfeld und der Auto-Knopf, alle deutsch, in einem
 * Fenster, das ein englischsprachiger Verwalter genauso öffnet.
 *
 * Das Gegenmittel bei den Knöpfen ist nicht ein weiterer Schlüssel, sondern
 * ein GEMERKTER Wert: `knopfBesetzt()` (01-core.js) hält die Beschriftung fest
 * und gibt sie zurück. Damit gibt es keine zweite Fassung, die auseinander-
 * laufen kann.
 *
 * ── Was geprüft wird, und warum genau das ───────────────────────────────────
 *
 * Nur Zuweisungen an `textContent`, `placeholder`, `title` sowie `toast()`,
 * `confirm()` und `alert()` — Stellen, an denen ein Literal ohne Umweg auf dem
 * Bildschirm landet. `innerHTML` steht bewusst NICHT dabei: Dort steht
 * überwiegend Markup mit eingesetzten Werten, und ein Muster, das darin Text
 * von Auszeichnung trennen will, erzeugt Fehlalarme — und eine Prüfung mit
 * Fehlalarmen wird abgeschaltet statt befolgt.
 *
 * Ein Literal ohne zwei zusammenhängende Buchstaben ist kein Text: „…", „–",
 * „❌ " und Zahlen fallen durch dieselbe Maschen wie in der App.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const SENKEN = [
  /\.(?:textContent|placeholder|title)\s*=\s*'([^']{2,})'/g,
  /\.(?:textContent|placeholder|title)\s*=\s*"([^"]{2,})"/g,
  /\btoast\(\s*'([^']{2,})'/g,
  /\btoast\(\s*"([^"]{2,})"/g,
  /\bconfirm\(\s*'([^']{2,})'/g,
  /\balert\(\s*'([^']{2,})'/g,
];

test('kein fester Text in textContent, placeholder, title, toast, confirm oder alert', () => {
  const dateien = [];
  const lauf = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!/node_modules|locales/.test(p)) lauf(p); continue; }
      if (!e.name.endsWith('.js') || e.name === 'app.bundle.js') continue;
      dateien.push([path.relative(ROOT, p),
        fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')]);
    }
  };
  lauf(path.join(ROOT, 'public'));
  assert.ok(dateien.length >= 15, `Nur ${dateien.length} Quelldateien gefunden`);

  let geprueft = 0;
  const fest = [];
  for (const [rel, src] of dateien)
    for (const muster of SENKEN)
      for (const m of src.matchAll(muster)) {
        geprueft++;
        // Mindestens zwei zusammenhängende Buchstaben — „…" ist kein Text.
        if (!/[^\W\d_]{2,}/u.test(m[1])) continue;
        const zeile = src.slice(0, m.index).split('\n').length;
        fest.push(`${rel}:${zeile}  „${m[1].slice(0, 50)}"`);
      }
  // Selbstbeweis: Greift kein Muster mehr, wäre die Liste leer und der Test
  // grün, ohne etwas geprüft zu haben. GEMESSEN sind es 18 Zuweisungen an
  // diesen Stellen — die Schranke liegt bewusst darunter, sie soll „findet
  // gar nichts mehr" fangen.
  assert.ok(geprueft >= 8,
    `Nur ${geprueft} Zuweisungen an sichtbare Stellen gefunden — Muster veraltet?`);

  assert.deepEqual(fest.sort(), [],
    'Diese Texte stehen fest im Quelltext statt im Wörterbuch:\n  ' + fest.join('\n  ') +
    '\nIn einer englischen Oberfläche steht dann ein deutsches Wort da. Bei einer ' +
    'Knopfbeschriftung, die nach dem Klick zurückkommt, hilft knopfBesetzt() ' +
    '(01-core.js): Es MERKT sich den Text, statt einen zweiten zu erfinden.');
});
