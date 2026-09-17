const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// BAUM und nicht ROOT: eigenbruecken.test.js loest jedes `path.join(ROOT, …)`
// gegen die WEB-Wurzel auf. Ein zweiter Sinn fuer denselben Namen hat in
// dieser Sitzung schon einmal eine Stunde gekostet.
const BAUM = path.join(__dirname, '..', '..');
const css = fs.readFileSync(path.join(BAUM, 'Web-App', 'public', 'themes', 'noppe.css'), 'utf8');
const theme = fs.readFileSync(path.join(BAUM, 'Android-App', 'app', 'src', 'main', 'java',
  'ch', 'brickinventoryapp', 'ui', 'theme', 'Theme.kt'), 'utf8');
const quelle = JSON.parse(fs.readFileSync(path.join(BAUM, 'shared', 'design-tokens.json'), 'utf8'));

/**
 * Das Design "noppe" — der Klemmbaustein als Bauteil der Oberflaeche.
 *
 * ── Warum diese Pruefung eigen ist ─────────────────────────────────────────
 *
 * Marcos Vorgabe zu diesem Projekt steht ueber allem: zwei Apps, dieselben
 * Funktionen, EINHEITLICHE Ansichten. Bei den bisherigen Designs traegt
 * shared/design-tokens.json die Farben, und design-abschrift.test.js haelt die
 * beiden erzeugten Dateien daran fest.
 *
 * "noppe" bringt zwei Dinge mit, die es vorher nicht gab und die genau
 * deshalb auseinanderlaufen koennen:
 *
 *   • sechs DECKELFARBEN, die die Kachelwand durchzaehlt, und
 *   • eine TINTE, auf der Rahmen, Schatten und Text gemeinsam stehen.
 *
 * Beides sind Listen bzw. ein Ton, die man in jeder Oberflaeche „mal eben"
 * hinschreiben koennte. Genau das soll hier auffallen.
 */

test('die Deckelfarben stehen in beiden Oberflaechen aus DERSELBEN Quelle', () => {
  const steine = quelle.listen.steine.werte;
  assert.ok(steine.length === 6,
    `Die Steinliste hat ${steine.length} Eintraege statt sechs — sechs, damit die ` +
    'Wiederholung als Rhythmus lesbar bleibt statt als Zufall.');

  // Keine der sechs Farben darf als Hex-Wert in einer der beiden Oberflaechen
  // stehen. Steht sie dort, ist sie abgeschrieben — und eine Abschrift zieht
  // beim naechsten Mal nicht mit.
  for (const hex of steine) {
    assert.ok(!css.toLowerCase().includes(hex.toLowerCase()),
      `themes/noppe.css schreibt ${hex} aus, statt var(--stein-N) zu benutzen`);
    assert.ok(!theme.toUpperCase().includes(hex.replace('#', '').toUpperCase()),
      `Theme.kt schreibt ${hex} aus, statt SteinFarben zu benutzen`);
  }
  assert.match(css, /var\(--stein-0\)/, 'themes/noppe.css benutzt die Steinliste nicht');
  assert.match(theme, /SteinFarben\[/, 'Theme.kt benutzt die Steinliste nicht');
});

test('die Steinfarbe laeuft in beiden Oberflaechen im selben Takt', () => {
  // Modulo sechs, und zwar an derselben Zahl: Laeuft das Web durch sechs und
  // die App durch vier, zeigt dasselbe Set auf Telefon und Rechner einen
  // anderen Deckel — und niemand kaeme auf die Idee, das fuer einen Fehler zu
  // halten, weil die Farbe ja nichts bedeutet.
  const webTakt = [...css.matchAll(/nth-child\(6n\+?(\d*)\)/g)].length;
  assert.equal(webTakt, 5,
    `themes/noppe.css zaehlt an ${webTakt} Stellen durch, erwartet fuenf ` +
    '(--stein-0 steht als Vorgabe schon in der Grundregel)');
  assert.match(theme, /position % SteinFarben\.size/,
    'Theme.kt rechnet die Deckelfarbe nicht mehr modulo der Listenlaenge');
});

test('Rahmen und Versatzschatten stehen auf demselben Ton', () => {
  // Kunststoff wirft keine Wolke, er liegt auf: Der Schatten ist derselbe Ton
  // wie der Rahmen, nur versetzt. Waeren es zwei Toene, saehe die Kante aus
  // wie ein Druckfehler.
  const schatten = [...css.matchAll(/--sh\d:([^;]+);/g)].map(m => m[1].trim());
  assert.ok(schatten.length >= 3, `Nur ${schatten.length} Schattenstufen — greift die Suche noch?`);
  for (const s of schatten) {
    assert.match(s, /var\(--ink\)/,
      `Die Schattenstufe "${s}" benutzt nicht die Tinte. Zwei Toene fuer ` +
      'Rahmen und Schatten sehen aus wie ein Druckfehler.');
    assert.ok(!/blur|rgba/.test(s),
      `Die Schattenstufe "${s}" ist weich. Dieses Design kennt nur harte Kanten.`);
  }
  assert.match(theme, /outline\s*=\s*NoppeTinte/,
    'Theme.kt setzt outline nicht auf die Tinte — in diesem Design traegt der ' +
    'Rahmen, nicht der Schatten');
});

test('die Steinfarbe bleibt Takt und wird nie Auskunft', () => {
  // ── Der Haken dieses Designs, als Regel ─────────────────────────────────
  //
  // Im Design "farbfaecher" IST die Farbe das Thema. Hier bedeutet sie
  // nichts. Solange beide nebeneinander waehlbar sind, darf die Steinfarbe
  // niemals an eine Eigenschaft des Sets geknuepft werden — sonst gibt es
  // zwei Designs, in denen dieselbe Sache Gegensaetzliches heisst.
  assert.ok(!/steinTon\((?!position)/.test(theme.replace(/\s+/g, '')),
    'steinTon() bekommt etwas anderes als die Position — dann bedeutet die ' +
    'Deckelfarbe doch etwas, und sie widerspricht dem Farbfaecher');
  // Der Zustand bleibt beim Zustand: Neu blau, Gebraucht orange.
  assert.match(theme, /"noppe" -> ChartColors\(ChartNewNoppe, ChartUsedNoppe/,
    'Die Verlaufsfarben des Designs fehlen — dann erbt es die des Grunddesigns');
});

test('die Tabelle bleibt leise', () => {
  // Das Laute gehoert an die Raender — Kopfleiste, Knoepfe, Plaketten —, nicht
  // zwischen die Zahlen. Ein Bestand ist nichts, was man einmal anschaut.
  const tabelle = css.slice(css.indexOf('table td'));
  assert.ok(tabelle.length > 0, 'Die Tabellenregel ist nicht mehr zu finden');
  assert.ok(!/border-bottom:2\.5px solid var\(--ink\)/.test(tabelle),
    'Die Tabellenzeilen haben die Tintenkante bekommen. Das ist dann ein ' +
    'Gitter und kein Text.');
});

test('beide Oberflaechen fuehren dieselbe Schrift', () => {
  assert.match(css, /--font:'Nunito'/,
    'themes/noppe.css stellt die Schrift nicht um — dann ist das Design im Web ' +
    'nur eine Farbvariante');
  const fonts = fs.readFileSync(path.join(BAUM, 'Web-App', 'public', 'vendor', 'fonts', 'fonts.css'), 'utf8');
  assert.match(fonts, /font-family: 'Nunito'/,
    'Die Schrift ist nicht selbst gehostet. Von einem Fremdhost bekaeme eine ' +
    'Installation im Offline-Betrieb sie gar nicht — genau der Grund, aus dem ' +
    'die anderen beiden Familien hier liegen.');
  // Ausgeschrieben und nicht in einer Schleife zusammengesetzt: Ein variables
  // Segment im Pfad nimmt baumbruecken.test.js die Sicht darauf, welche
  // Dateien diese Pruefung ueberhaupt anfasst — sie hat das gemeldet.
  const fehlt = [
    path.join(BAUM, 'Android-App', 'app', 'src', 'main', 'res', 'font', 'nunito_regular.ttf'),
    path.join(BAUM, 'Android-App', 'app', 'src', 'main', 'res', 'font', 'nunito_bold.ttf'),
    path.join(BAUM, 'Android-App', 'app', 'src', 'main', 'res', 'font', 'nunito_black.ttf'),
  ].filter(f => !fs.existsSync(f)).map(f => path.basename(f));
  assert.deepEqual(fehlt, [],
    `Diese Schnitte fehlen unter res/font/: ${fehlt.join(', ')} — dann zeigt die ` +
    'App dasselbe Design in einer anderen Schrift als das Web');
  assert.match(theme, /NunitoFamilie/, 'Theme.kt benutzt die Schrift nicht');
});
