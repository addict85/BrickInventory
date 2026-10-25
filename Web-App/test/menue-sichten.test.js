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
/**
 * index.html OHNE Kommentare.
 *
 * GEMESSEN am 17.10.: Ein Erklaerkommentar INNERHALB der Menueklappe enthielt
 * die Zeichenfolge eines schliessenden div-Tags — und `eintragsTexte()`
 * schneidet die Klappe genau am ersten solchen Tag aus. Der Ausschnitt endete
 * damit im Kommentar, die Pruefung sah sieben Eintraege statt acht und blieb
 * GRUEN. Sie hat nicht falsch gemessen, sondern still weniger, und das ist
 * schlimmer: Ein roter Fall meldet sich, ein verkuerzter nicht.
 *
 * Ironischerweise war es der Kommentar, der vor genau diesem Schnitt warnte.
 *
 * Dieselbe Entscheidung wie in test/bedienelement-name.test.js und
 * test/dom-ids.test.js: Gesucht wird im MARKUP. Was ein Kommentar beschreibt,
 * ist keine Oberflaeche.
 */
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8')
  .replace(/<!--[\s\S]*?-->/g, '');
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

/**
 * Die Pfade AUSGESCHRIEBEN und nicht über `sprache + '.js'` zusammengesetzt.
 *
 * test/eigenbruecken.test.js zählt Pfade mit variablem Segment gegen eine
 * Ratsche und sagt dazu: „Wo es geht, gehört der Pfad ausgeschrieben — ein
 * variables Segment nimmt dieser Prüfung die Sicht." Die Ratsche von 74 auf
 * 75 zu drehen wäre hier das Falsche: Sie rückt nach, wenn das Ausschreiben
 * eine ZWEITE WAHRHEIT schüfe — bei Schleifen über die Migrationsdateien
 * etwa, wo eine ausgeschriebene Liste beim nächsten Zuwachs veraltet.
 *
 * Hier gibt es genau zwei Sprachdateien, und `['de', 'en']` steht ohnehin
 * schon im Fall darunter. Ausgeschrieben kostet nichts und bringt etwas:
 * eigenbruecken prüft die beiden Pfade jetzt WIRKLICH, statt sie nur als
 * uneinsehbar zu zählen.
 *
 * (Gemerkt hat das die Ratsche, nicht ich — sie schlug bei 75 an.)
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
  // ── Was dieser Fall einmal war, und was aus ihm geworden ist ────────────
  //
  // Marcos Vorgabe vom 17.10., frueh: „Der Abmeldebutton sollte gleich gross
  // wie die restlichen Buttons sein oben rechts (gleich hoch)." Nachgerechnet
  // waren es drei Hoehen — ≈31,5 px (Abmelden), 24 px (Namensknopf),
  // ≈20 px (Admin-Plakette). Sie bekamen eine gemeinsame.
  //
  // Am selben Tag, spaeter: „Abmelden" zog in die Klappe und die
  // Admin-Plakette in den Namen. In der Reihe steht nur noch EIN Element.
  //
  // „Gleich hoch" ist damit keine Beziehung mehr, die man pruefen koennte —
  // ein Element ist immer gleich hoch wie es selbst. Der Fall heisst deshalb
  // jetzt anders und sichert, was uebrig bleibt und weiterhin eine
  // Entscheidung ist: Die 28 px stehen als Wert da, der Namensknopf nimmt
  // sie, und sie stehen NICHT an `.btn-sm`.
  //
  // Den Fall einfach zu loeschen waere die andere Moeglichkeit gewesen. Dann
  // haette niemand mehr gemerkt, wenn die Hoehe an `.btn-sm` wandert — und
  // genau das ist die Falle, gegen die er gebaut wurde.
  const css = fs.readFileSync(path.join(ROOT, 'public', 'styles.css'), 'utf8');
  assert.match(css, /\.umenu\{[^}]*--kopf-hoehe:\s*\d+px/,
    'In `.umenu` steht keine Hoehe mehr.');
  assert.match(css, /\.umenu \.ubadge\{height:var\(--kopf-hoehe\)\}/,
    'Der Namensknopf nimmt die Hoehe nicht mehr.');
  // Nicht an `.btn-sm`: die Klasse haengt an 28 Stellen in index.html und in
  // fuenf JS-Dateien. Eine Hoehe dort verschoebe die halbe Oberflaeche.
  assert.doesNotMatch(css, /\.btn-sm\{[^}]*height:/,
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

  // Und 01-core.js haengt seinen Handler weiterhin an diese ID.
  const core = fs.readFileSync(path.join(ROOT, 'public', 'js', '01-core.js'), 'utf8');
  assert.match(core, /G\('btn-logout'\)\.onclick/,
    'Niemand verdrahtet btn-logout mehr — der Eintrag taete dann nichts.');
});
