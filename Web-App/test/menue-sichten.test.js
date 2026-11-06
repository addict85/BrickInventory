/**
 * Jede Sicht hinter dem Menü ist erreichbar — und jeder Eintrag führt irgendwohin.
 * Ausführlich: docs/begruendungen/test/menue-sichten.test.js.md#kopf
 *
 * ── Gegenproben (durchgeführt, Befunde gemessen) ────────────────────────────
 *
 *   data-arg="gutscheine" → "gutschein"   -> Fälle 1, 2 UND 3 rot
 *   data-arg="daten"      → "datenX"      -> Fälle 1, 2 UND 3 rot
 *   SICHTEN-Eintrag `app` entfernt        -> Fall 3 rot
 *
 * Die ersten beiden ziehen drei Fälle mit, und das ist kein Mangel, sondern
 * die Kette: Ein verschriebener Eintrag hat keine Fläche (1), lässt seine
 * Fläche unerreichbar zurück (2) und passt nicht mehr zur Lader-Tabelle (3).
 * Vorhergesagt hatte ich je einen Fall — gemessen waren es drei.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT = path.join(__dirname, '..');
/**
 * index.html OHNE Kommentare.
 * Ausführlich: docs/begruendungen/test/menue-sichten.test.js.md#html
 */
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8')
  .replace(/<!--[\s\S]*?-->/g, '');
const NAV  = fs.readFileSync(path.join(ROOT, 'public', 'js', '25-navigation.js'), 'utf8');

/** Die Namen aus dem Menü — `data-click="oeffneSicht" data-arg="…"`. */
function menueEintraege() {
  return [...HTML.matchAll(/data-click="oeffneSicht"\s+data-arg="([\w-]+)"/g)].map(m => m[1]);
}

/** Alle `.tab`-Flächen, die kein Reiter in der Leiste anspricht. */
function sichtFlaechen() {
  const reiter = new Set([...HTML.matchAll(/class="ntab[^"]*"[^>]*data-tab="([\w-]+)"/g)]
    .map(m => m[1]));
  return [...HTML.matchAll(/<div class="tab[^"]*" id="tab-([\w-]+)"/g)]
    .map(m => m[1])
    .filter(n => !reiter.has(n));
}

test('jeder Menüeintrag hat seine Fläche', () => {
  const eintraege = menueEintraege();
  // Selbstnachweis: Ohne Treffer wäre die Schleife darunter still grün.
  assert.ok(eintraege.length >= 5,
    `Nur ${eintraege.length} Menüeinträge gefunden — greift das Muster noch?`);
  const ohneFlaeche = eintraege.filter(n => !HTML.includes(`<div class="tab" id="tab-${n}">`));
  assert.deepEqual(ohneFlaeche, [],
    'Diese Menüeinträge zeigen auf eine Fläche, die es nicht gibt — der Klick ' +
    `täte nichts: ${ohneFlaeche.join(', ')}`);
});

test('jede Sicht ist über das Menü erreichbar', () => {
  const flaechen = sichtFlaechen();
  assert.ok(flaechen.length >= 5,
    `Nur ${flaechen.length} Sichten gefunden — greift das Muster noch?`);
  const eintraege = new Set(menueEintraege());
  const ohneWeg = flaechen.filter(n => !eintraege.has(n));
  assert.deepEqual(ohneWeg, [],
    'Diese Flächen hängen im Markup, aber kein Menüeintrag führt dorthin:\n  ' +
    ohneWeg.join('\n  ') +
    '\nEine Seite, die niemand öffnen kann, ist keine Seite — sie ist ' +
    'Markup mit Pflegekosten. (Dieselbe Regel wie ErreichbareRoutenTest in ' +
    'der Android-App.)');
});

test('jede Sicht lädt, was sie zeigt', () => {
  // `const SICHTEN = { … };` in js/25-navigation.js — die Zuordnung Name → Lader.
  const block = NAV.slice(NAV.indexOf('const SICHTEN = {'));
  const ende  = block.indexOf('\n};');
  assert.ok(ende > 0, 'SICHTEN nicht gefunden — umbenannt?');
  const namen = [...block.slice(0, ende).matchAll(/^\s{2}(\w+):/gm)].map(m => m[1]);
  assert.deepEqual(namen.sort(), menueEintraege().sort(),
    'Menü und Lader-Tabelle nennen nicht dieselben Sichten. Ein Eintrag ohne ' +
    'Lader öffnet eine Seite, auf der nichts steht — und das sieht aus wie ' +
    '„keine Daten vorhanden".');
});

test('der Reiter „Einstellungen" ist Verwaltersache', () => {
  // Marcos Vorgabe: nur noch, was ein Administrator setzen kann. Deshalb ist
  // der Reiter wie das Monitoring vorgeblendet und wird erst für Admins
  // sichtbar (js/26-sitzung.js).
  assert.match(HTML, /id="ntab-settings"[^>]*data-stil="display:none"/,
    'Der Einstellungs-Reiter steht wieder für alle da — für Nicht-Admins wäre ' +
    'er leer.');
  const core = fs.readFileSync(path.join(ROOT, 'public', 'js', '26-sitzung.js'), 'utf8');
  assert.match(core, /ntab-settings'\);\s*if\s*\(ns\)\s*ns\.style\.display\s*=\s*''/,
    'Niemand blendet den Reiter für Admins wieder ein — dann fehlt er auch dort.');
});

/**
 * Nachtrag vom 17.10.: das Symbol, das zur Laufzeit verschwand
 * Ausführlich: docs/begruendungen/test/menue-sichten.test.js.md#stelle
 *
 * Gegenproben (durchgeführt, Ergebnisse abgeschrieben) — siehe unten an den
 * Fällen selbst.
 */

/**
 * Die Pfade AUSGESCHRIEBEN und nicht über `sprache + '.js'` zusammengesetzt.
 * Ausführlich: docs/begruendungen/test/menue-sichten.test.js.md#sprachdatei
 */
const SPRACHDATEI = {
  de: path.join(ROOT, 'public', 'locales', 'de.js'),
  en: path.join(ROOT, 'public', 'locales', 'en.js'),
};

/** Die Sprachtexte einer Datei als Map. */
function texte(sprache) {
  const datei = SPRACHDATEI[sprache];
  assert.ok(datei, `Keine Sprachdatei für "${sprache}" hinterlegt`);
  const roh = fs.readFileSync(datei, 'utf8');
  const map = new Map();
  for (const m of roh.matchAll(/^\s*'([^']+)':\s*'((?:[^'\\]|\\.)*)'/gm)) map.set(m[1], m[2]);
  return map;
}

/** Schlüssel und Markup-Text der Menüeinträge, in der Reihenfolge des Menüs. */
function eintragsTexte() {
  const auf = HTML.indexOf('<div class="umenu-pop"');
  const zu  = HTML.indexOf('</div>', auf);
  assert.ok(auf > 0 && zu > auf, 'Die Menüklappe ist nicht mehr zu finden — umbenannt?');
  return [...HTML.slice(auf, zu).matchAll(/data-i18n="([^"]+)">([^<]+)</g)]
    .map(m => ({ schluessel: m[1], markup: m[2].trim() }));
}

test('jeder Menüeintrag trägt sein Symbol — NEBEN dem Sprachtext', () => {
  // Seit dem 25.10. kommt das Symbol aus der Symbolfamilie (Sprite in
  // index.html) statt als Emoji aus dem Sprachtext. Die Falle von oben bleibt
  // dieselbe: `data-i18n` ersetzt beim Übersetzen den INHALT seines Elements.
  // Steht es am Knopf, ist das Symbol nach dem Übersetzen weg — es gehört an
  // ein eigenes Element neben dem Symbol.
  const auf = HTML.indexOf('<div class="umenu-pop"');
  const zu  = HTML.indexOf('</div>', auf);
  const knoepfe = [...HTML.slice(auf, zu).matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)];
  // Selbstbeweis: sieben Sichten, zwei Verwalterseiten, Abmelden.
  assert.equal(knoepfe.length, 10,
    `${knoepfe.length} Einträge abgeleitet statt zehn — greift die Ableitung noch?`);
  const symbole = new Set([...HTML.matchAll(/<symbol id="([\w-]+)"/g)].map(m => m[1]));
  const falsch = [];
  for (const [, attr, inhalt] of knoepfe) {
    const name = (/data-i18n="([^"]+)"/.exec(inhalt) || /data-i18n="([^"]+)"/.exec(attr) || [])[1] || attr;
    if (/data-i18n=/.test(attr)) falsch.push(`${name}: data-i18n am Knopf — das Übersetzen löscht das Symbol`);
    const use = /<svg class="ico"[^>]*>\s*<use href="#([\w-]+)"/.exec(inhalt);
    if (!use) falsch.push(`${name}: kein Symbol`);
    else if (!symbole.has(use[1])) falsch.push(`${name}: #${use[1]} fehlt im Sprite`);
  }
  // Gegenprobe (am 25.10. gemessen): data-i18n beim Profil-Eintrag zurück an
  // den Knopf → rot mit „settings.group.profile: data-i18n am Knopf".
  assert.deepEqual(falsch, [], 'Menüeinträge ohne sichtbares Symbol:\n  ' + falsch.join('\n  '));
});

test('das Markup eines Menüeintrags zeigt, was der Sprachtext sagt', () => {
  // Die eigentliche Lehre aus dem Befund: Weichen Markup und Sprachtext
  // voneinander ab, sieht man beim Entwickeln das eine und im Betrieb das
  // andere. Geprüft wird gegen DEUTSCH — die Markup-Texte sind deutsch.
  const de = texte('de');
  const abweichend = [];
  for (const { schluessel, markup } of eintragsTexte()) {
    const wert = de.get(schluessel);
    if (wert !== markup) abweichend.push(`${schluessel}: Markup "${markup}" ≠ Sprachtext "${wert}"`);
  }
  // Gegenprobe (durchgeführt): das 👤 nur im Markup gelassen und aus de.js
  // genommen → dieser Fall rot mit genau dieser Zeile. Das ist der Zustand,
  // den Marco im Bildschirmfoto gesehen hat.
  assert.deepEqual(abweichend, [],
    'Markup und Sprachtext laufen auseinander:\n  ' + abweichend.join('\n  ') +
    '\n\nSichtbar ist der SPRACHTEXT. Der Text im Markup ist nur der Rückfall ' +
    'für den Augenblick vor dem Übersetzen.');
});

test('die Kopfleiste behaelt ihre bewusste Hoehe', () => {
  // Was dieser Fall einmal war, und was aus ihm geworden ist
  // Ausführlich: docs/begruendungen/test/menue-sichten.test.js.md#css-stelle
  const css = fs.readFileSync(path.join(ROOT, 'public', 'styles.css'), 'utf8');
  assert.match(css, /\.umenu\{[^}]*--kopf-hoehe:\s*(max\()?\d+px/,
    'In `.umenu` steht keine Hoehe mehr.');
  assert.match(css, /\.umenu \.ubadge\{height:var\(--kopf-hoehe\)\}/,
    'Der Namensknopf nimmt die Hoehe nicht mehr.');
  // Nicht an `.btn-sm`: die Klasse haengt an 28 Stellen in index.html und in
  // fuenf JS-Dateien. Eine Hoehe dort verschoebe die halbe Oberflaeche.
  // min-height 32 px ist die kompakte Knopfgrösse (zwei Grössen); feste Höhe bleibt verboten.
  assert.doesNotMatch(css, /\.btn-sm\{[^}]*(?<!min-)height:/,
    '`.btn-sm` hat eine feste Hoehe bekommen — diese Klasse traegt die halbe ' +
    'Oberflaeche, die Hoehe gehoert in die Kopfleiste.');
});

test('Abmelden steht in der Klappe und nicht mehr in der Kopfleiste', () => {
  // Marcos Vorgabe vom 17.10.: „Kannst du abmelden ebenfalls in das neue Menu
  // integrieren?"
  //
  // Geprueft wird BEIDES. Nur „steht in der Klappe" waere gruen geblieben,
  // haette ich den Knopf verdoppelt statt verschoben — und zwei Abmeldeknoepfe
  // sieht man im Markup nicht, wohl aber auf dem Bildschirm.
  const kopfAuf = HTML.indexOf('<header');
  const kopfZu  = HTML.indexOf('</header>');
  const kopf    = HTML.slice(kopfAuf, kopfZu);
  const klappeAuf = HTML.indexOf('<div class="umenu-pop"');
  const klappe    = HTML.slice(klappeAuf, HTML.indexOf('</div>', klappeAuf));

  assert.ok(klappe.includes('id="btn-logout"'),
    'Abmelden steht nicht in der Menueklappe.');
  assert.equal((kopf.match(/id="btn-logout"/g) || []).length, 1,
    'Abmelden kommt in der Kopfleiste nicht genau einmal vor — verdoppelt oder verschwunden? '
    + '(Die Klappe liegt INNERHALB des <header>, der eine Treffer ist der in der Klappe.)');
  assert.ok(klappe.includes('umenu-trenner'),
    'Der Trenner vor „Abmelden" fehlt — dann steht die Handlung als achter Punkt '
    + 'in einer Reihe mit sieben Sichtwechseln.');

  // Und 26-sitzung.js haengt seinen Handler weiterhin an diese ID.
  const core = fs.readFileSync(path.join(ROOT, 'public', 'js', '26-sitzung.js'), 'utf8');
  assert.match(core, /G\('btn-logout'\)\.onclick/,
    'Niemand verdrahtet btn-logout mehr — der Eintrag taete dann nichts.');
});
