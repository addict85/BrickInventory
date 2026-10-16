/**
 * Jede Sicht hinter dem Menü ist erreichbar — und jeder Eintrag führt irgendwohin.
 *
 * ── Woher diese Prüfung kommt ───────────────────────────────────────────────
 *
 * Marcos Vorgabe vom 16.10.: „Gerne den Reiter Einstellungen mit den Punkten
 * belassen die nur der Administrator setzen kann, und die restlichen Seiten
 * oben Rechts hinter dem Benutzernamen als Aufklappbares Menu mit 3 -
 * anzeigen."
 *
 * Damit gibt es in der Webapp zum ersten Mal Flächen, die KEIN Reiter
 * erreicht. Genau diese Sorte ist in der Android-App schon einmal unsichtbar
 * geworden: `Screen.Settings` stand dort im Navigationsgraphen und kam im
 * ganzen Baum genau einmal vor — in seiner eigenen Registrierung. Marco fand
 * die Einstellungen nicht, weil es keinen Weg dorthin gab; seither hält
 * ErreichbareRoutenTest das fest.
 *
 * Hier ist die Lage dieselbe, nur in HTML: Eine `.tab`-Fläche ohne Eintrag im
 * Menü ist unsichtbar, ein Eintrag ohne Fläche tut beim Klick nichts, und ein
 * Eintrag ohne Lader zeigt eine leere Seite. Keines davon meldet der Browser.
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
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const NAV  = fs.readFileSync(path.join(ROOT, 'public', 'js', '02-gallery.js'), 'utf8');

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
  // `const SICHTEN = { … };` in js/02-gallery.js — die Zuordnung Name → Lader.
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
  // sichtbar (js/01-core.js).
  assert.match(HTML, /id="ntab-settings"[^>]*style="display:none"/,
    'Der Einstellungs-Reiter steht wieder für alle da — für Nicht-Admins wäre ' +
    'er leer.');
  const core = fs.readFileSync(path.join(ROOT, 'public', 'js', '01-core.js'), 'utf8');
  assert.match(core, /ntab-settings'\);\s*if\s*\(ns\)\s*ns\.style\.display\s*=\s*''/,
    'Niemand blendet den Reiter für Admins wieder ein — dann fehlt er auch dort.');
});

/**
 * ── Nachtrag vom 17.10.: das Symbol, das zur Laufzeit verschwand ────────────
 *
 * Marcos Meldung, mit Bildschirmfoto: „Bitte bei Profil-Einstellungen auch
 * noch ein Icon verwenden."
 *
 * Im Markup stand es längst:
 *
 *     <button … data-i18n="settings.group.profile">👤 Profil-Einstellungen</button>
 *
 * Nur zählt der Text im Markup nichts: `data-i18n` ERSETZT den Inhalt beim
 * Übersetzen durch den Sprachtext, und `settings.group.profile` lautete
 * schlicht „Profil-Einstellungen". Alle sechs Nachbareinträge tragen ihr
 * Symbol IM Sprachtext ('🎟️ Gutscheine', '🔔 Preisalarme', …) — dieser eine
 * nicht. Sichtbar war also nie, was dasteht.
 *
 * Dieselbe Falle wie bei `G('ubadge').textContent` (siehe
 * test/benutzername-menueknopf.test.js): Ein Markup, das beim Laden richtig
 * aussieht und beim ersten Zugriff überschrieben wird.
 *
 * i18n.test.js fängt das NICHT — es vergleicht Deutsch gegen Englisch, nicht
 * Markup gegen Sprachtext. Beide Sprachen waren hier einträchtig symbollos.
 *
 * Gegenproben (durchgeführt, Ergebnisse abgeschrieben) — siehe unten an den
 * Fällen selbst.
 */

/** Die Sprachtexte einer Datei als Map. */
function texte(sprache) {
  const roh = fs.readFileSync(path.join(ROOT, 'public', 'locales', sprache + '.js'), 'utf8');
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

test('jeder Menüeintrag trägt sein Symbol im SPRACHTEXT', () => {
  const eintraege = eintragsTexte();
  // Selbstbeweis: GEMESSEN sind es sieben. Findet die Ableitung nichts, wäre
  // die Schleife darunter still grün.
  assert.equal(eintraege.length, 7,
    `${eintraege.length} Einträge abgeleitet statt sieben — greift die Ableitung noch?`);

  // Ein Symbol ist hier: ein Zeichen jenseits von ASCII am Anfang des Textes.
  // „Ü" aus „Übersicht" wäre eines — deshalb zusätzlich die Bedingung, dass
  // ein Leerzeichen folgt und danach noch Text kommt.
  const ohne = [];
  for (const { schluessel } of eintraege) {
    for (const sprache of ['de', 'en']) {
      const wert = texte(sprache).get(schluessel);
      assert.ok(wert, `${schluessel} fehlt in locales/${sprache}.js`);
      if (!/^[^\u0000-\u007F]+️?\s+\S/u.test(wert)) ohne.push(`${sprache}:${schluessel} = "${wert}"`);
    }
  }
  // Gegenprobe (durchgeführt): das 👤 wieder aus de.js entfernt → dieser Fall
  // rot und nennt `de:settings.group.profile`.
  assert.deepEqual(ohne, [],
    'Diese Menüeinträge tragen kein Symbol im Sprachtext:\n  ' + ohne.join('\n  ') +
    '\n\nDas Symbol im Markup zählt NICHT — `data-i18n` ersetzt den Inhalt ' +
    'beim Übersetzen. Es gehört in locales/de.js und locales/en.js.');
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

test('die Bedienelemente der Kopfleiste sind gleich hoch', () => {
  // Marcos Vorgabe: „Der Abmeldebutton sollte gleich gross wie die restlichen
  // Buttons sein oben rechts (gleich hoch)." Nachgerechnet waren es drei
  // Höhen: ≈31,5 px (Abmelden), 24 px (Namensknopf), ≈20 px (Admin).
  const css = fs.readFileSync(path.join(ROOT, 'public', 'styles.css'), 'utf8');
  assert.match(css, /\.umenu\{[^}]*--kopf-hoehe:\s*\d+px/,
    'In `.umenu` steht keine gemeinsame Höhe mehr.');
  for (const teil of ['.umenu .ubadge', '.umenu .abadge', '.umenu .btn']) {
    assert.ok(css.includes(teil),
      `${teil} bekommt die gemeinsame Höhe nicht mehr — dann steht dieses ` +
      'Element wieder auf eigener Höhe in der Reihe.');
  }
  assert.match(css, /\.umenu \.ubadge,\s*\n\s*\.umenu \.abadge,\s*\n\s*\.umenu \.btn\{height:var\(--kopf-hoehe\)\}/,
    'Die drei teilen sich die Höhe nicht mehr über dieselbe Regel.');
  // Und NICHT an `.btn-sm`: die Klasse hängt an 28 Stellen in index.html und
  // in fünf JS-Dateien. Eine Höhe dort verschöbe die halbe Oberfläche.
  assert.doesNotMatch(css, /\.btn-sm\{[^}]*height:/,
    '`.btn-sm` hat eine feste Höhe bekommen — diese Klasse trägt die halbe ' +
    'Oberfläche, die Höhe gehört in die Kopfleiste.');
});
