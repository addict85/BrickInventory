const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// BAUM und nicht ROOT: eigenbruecken.test.js loest jedes `path.join(ROOT, …)`
// gegen die WEB-Wurzel auf. Ein zweiter Sinn fuer denselben Namen hat in
// dieser Sitzung schon einmal eine Stunde gekostet.
const BAUM = path.join(__dirname, '..', '..');
const css = fs.readFileSync(path.join(BAUM, 'Web-App', 'public', 'themes', 'noppe.css'), 'utf8');
const glanz = fs.readFileSync(path.join(BAUM, 'Web-App', 'public', 'themes', 'hochglanz.css'), 'utf8');
const decor = fs.readFileSync(path.join(BAUM, 'Android-App', 'app', 'src', 'main', 'java',
  'ch', 'brickinventoryapp', 'ui', 'theme', 'BrickDecor.kt'), 'utf8');
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
  // Die UNTERSCHIEDLICHEN Positionen zaehlen, nicht die Treffer: Seit
  // "hochglanz" nennt jede Regel in noppe.css zwei Designs, und damit steht
  // jedes nth-child zweimal da. Ein Zaehlen der Treffer haette das gemeldet,
  // obwohl sich am Takt nichts geaendert hat — genau der Fehlalarm, gegen den
  // CatalogUsesLocalImagesTest eine Runde vorher geschaerft wurde.
  const webTakt = new Set([...css.matchAll(/nth-child\(6n\+?(\d*)\)/g)].map(m => m[1])).size;
  assert.equal(webTakt, 5,
    `themes/noppe.css zaehlt an ${webTakt} verschiedenen Positionen durch, erwartet fuenf ` +
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
  // Beide Designs, EIN Zweig: "hochglanz" ist "noppe" in einem anderen
  // Material und hat deshalb dieselben Verlaufsfarben. Stuende es in einem
  // eigenen Zweig, waere das die erste Stelle, an der die beiden auseinander
  // laufen koennten.
  assert.match(theme, /"noppe", "hochglanz" -> ChartColors\(ChartNewNoppe, ChartUsedNoppe/,
    'Die Verlaufsfarben des Designs fehlen oder gelten nicht mehr fuer beide — ' +
    'dann erbt eines davon die des Grunddesigns');
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

// ────────────────────────────────────────────────────────────────────────────
// "hochglanz" — dasselbe Design in einem anderen Material (Nachtrag 162)
//
// Marcos Wunsch: „so wie eine hochglanzproschuerr". Es ist NICHT ein sechstes
// Design neben "noppe", sondern "noppe" mit Lack: dieselbe Anatomie, dieselbe
// Palette, dazu Schichten, die kein Farbwert sind.
//
// Genau daran kann es scheitern: Ein zweites Stylesheet mit denselben achtzig
// Zeilen, eine zweite Farbtabelle, ein zweiter Deckel-Baustein — und beim
// naechsten Nachbessern zieht eine Haelfte nicht mit. Dagegen sind diese
// Pruefungen gebaut.
// ────────────────────────────────────────────────────────────────────────────

test('hochglanz erbt die Palette, statt sie abzuschreiben', () => {
  assert.equal(quelle.designs.hochglanz.erbt, 'noppe',
    'hochglanz fuehrt eine eigene Palette. Es ist dieselbe wie die von noppe — ' +
    'eine Abschrift zieht beim naechsten Mal nicht mit.');
  // Und der Generator muss daraus wirklich Werte machen, sonst faellt das
  // Design auf das Grunddesign zurueck und ist blau statt rot.
  const tokens = fs.readFileSync(path.join(BAUM, 'Web-App', 'public', 'tokens.css'), 'utf8');
  const block = tokens.slice(tokens.indexOf('[data-theme="hochglanz"]'));
  assert.match(block.slice(0, 400), /--b600: #d91f26;/,
    'tokens.css traegt fuer hochglanz keine aufgeloeste Palette — dann greift :root, und ' +
    'das Design waere blau statt rot');
});

test('hochglanz traegt nur die Schichten, nicht die Anatomie', () => {
  // Jede Regel in noppe.css gilt fuer BEIDE Designs — das ist die gemeinsame
  // Grundlage. hochglanz.css darf sie nicht ein zweites Mal aufstellen.
  const noppeRegeln = [...css.matchAll(/\[data-theme="noppe"\][^{]*\{/g)].length;
  assert.ok(noppeRegeln >= 10, `Nur ${noppeRegeln} Regeln in noppe.css — greift die Suche noch?`);
  assert.ok(!/\[data-theme="noppe"\]/.test(glanz),
    'hochglanz.css nennt noppe — die gemeinsamen Regeln gehoeren in noppe.css, einmal');

  // Die Anatomie darf hier nicht noch einmal stehen. Diese vier Eigenschaften
  // bestimmen sie; taucht eine davon hier auf, ist die Datei kein Aufsatz mehr,
  // sondern ein zweites Design.
  for (const eigenschaft of ['--rad:', '--font:', 'border-radius:14px', 'padding-top:26px']) {
    assert.ok(!glanz.includes(eigenschaft),
      `hochglanz.css setzt ${eigenschaft} — das ist Anatomie und steht in noppe.css`);
  }
});

test('der harte Versatzschatten ueberlebt den Lack', () => {
  // Die Kante traegt, auch wenn sie glaenzt. Faellt sie weg, ist es eine
  // andere Anatomie und nicht dasselbe Design in einem anderen Material.
  const karte = glanz.slice(glanz.indexOf('[data-theme="hochglanz"] .card'));
  assert.match(karte, /0 4px 0 var\(--ink\)/,
    'Der harte Versatzschatten ist im Lack verschwunden. Dann glaenzt etwas ' +
    'anderes als noppe, und es ist nicht mehr dasselbe Design.');
});

test('der Lichtstreifen liegt nicht ueber der ganzen Kachel', () => {
  // ── Der Fehler, den diese Zusicherung verhindert ──────────────────────────
  //
  // Die erste Fassung legte den Streifen ueber die ganze Karte. Ein weisser
  // Schleier ueber weissem Text ist aber kein Glanz, sondern Grau: Die Kacheln
  // sahen blasser aus als OHNE Glanz, und der Setname litt mit. Sichtbar wurde
  // das erst im Browser, nicht an den Werten.
  const streifen = '118deg';
  assert.ok(glanz.includes(streifen), 'Der Lichtstreifen fehlt ganz');
  // Er darf auf dem Bildfeld (.sci) liegen, nicht auf der Kachel (.sc) selbst.
  for (const regel of glanz.split('}')) {
    if (!regel.includes(streifen)) continue;
    const kopf = regel.slice(0, regel.indexOf('{'));
    assert.ok(/\.sci\b/.test(kopf) && !/\.sc\s*[,{]/.test(kopf),
      `Der Lichtstreifen steht in einer Regel fuer "${kopf.trim()}". Er gehoert ` +
      'auf das Bildfeld (.sci) — ueber weissem Text ist er Grau, nicht Glanz.');
  }
  // Und in der App dieselbe Regel, als Erklaerung am Pinsel selbst.
  assert.match(decor, /val LichtStreifen = Brush\.linearGradient/,
    'Der Lichtstreifen fehlt in der App — dann glaenzt dasselbe Design nur im Web');
});

test('beide Oberflaechen bauen den Glanz aus denselben Haltepunkten', () => {
  // Der Lichtabfall ist in CSS ein linear-gradient und in Compose ein
  // Brush.verticalGradient. Verschiedene Sprachen, dieselben vier Haltepunkte —
  // laufen sie auseinander, sieht dasselbe Design auf Telefon und Rechner
  // anders aus, und niemand sucht den Grund in einer Zahl.
  const ausCss = [...glanz.matchAll(/rgba\((?:255,255,255|0,0,0),\.(\d+)\) (\d+)%/g)]
    .map(m => `${m[2]}/${m[1]}`);
  assert.ok(ausCss.length >= 4, `Nur ${ausCss.length} Haltepunkte im CSS — greift die Suche noch?`);
  for (const [anteil, deckkraft] of [['0.00f', '0.55f'], ['0.42f', '0.12f'],
                                     ['0.62f', '0.10f'], ['1.00f', '0.20f']]) {
    assert.ok(decor.includes(`${anteil} to Color.`) && decor.includes(`alpha = ${deckkraft}`),
      `Der Haltepunkt ${anteil}/${deckkraft} fehlt in BrickDecor.kt — der ` +
      'Lichtabfall waere dann in der App ein anderer als im Web');
  }
});

test('der Deckel ist EIN Baustein, nicht zwei', () => {
  // Es ist derselbe Deckel in einem anderen Material. Ein zweiter Baustein
  // daneben liefe beim naechsten Nachbessern auseinander — deshalb ein
  // Parameter.
  assert.match(decor, /glanz: Boolean = false/,
    'BrickStudCap kennt den Glanz nicht mehr als Parameter');
  assert.ok(!/fun \w*GlanzStudCap|fun BrickStudCapGlanz/.test(decor),
    'Es gibt einen zweiten Deckel-Baustein fuer den Glanz. Einer reicht, mit Parameter.');
});

// ────────────────────────────────────────────────────────────────────────────
// Die Form der Noppe (Nachtrag 163)
//
// Marco: „Die Noppen sehen noch komisch aus." Sie waren ein
// repeating-linear-gradient — ein Verlauf kennt keine runden Ecken, und das
// `border-radius` daneben rundete den BALKEN statt der einzelnen Noppe. In der
// laufenden App standen deshalb scharfkantige Striche, obwohl im Entwurf
// Noppen mit runder Oberkante stehen.
//
// Der Ersatz ist eine Maske: Sie traegt die FORM, der Hintergrund die FARBE.
// Damit bleibt die Farbe in den Token — und die Form an genau einer Stelle.
// ────────────────────────────────────────────────────────────────────────────

/** Die beiden Regeln, die eine Noppenreihe zeichnen. */
const noppenReihen = () => css.split('}')
  .filter(r => /header::before|\.sc::after/.test(r.slice(0, r.indexOf('{') + 1)));

test('die Noppen haben eine runde Oberkante, keine Verlaufskante', () => {
  const reihen = noppenReihen();
  // Selbstbeweis: GEMESSEN sind es zwei — die Kopfleiste und der Kacheldeckel.
  assert.equal(reihen.length, 2,
    `${reihen.length} Noppenreihen gefunden statt zwei — greift die Suche noch?`);

  for (const reihe of reihen) {
    const kopf = reihe.slice(0, reihe.indexOf('{')).trim();
    assert.ok(reihe.includes('var(--noppen-form)'),
      `"${kopf}" benutzt die Noppenform nicht`);
    assert.ok(!/repeating-linear-gradient/.test(reihe),
      `"${kopf}" zeichnet die Noppen wieder als Verlauf. Ein Verlauf kann keine ` +
      'runden Ecken — genau daran sahen sie aus wie Striche.');
    assert.ok(!/border-radius/.test(reihe),
      `"${kopf}" rundet mit border-radius. Das rundet den BALKEN, nicht die ` +
      'einzelne Noppe — der Unterschied war in der laufenden App zu sehen.');
  }
});

test('Leiste und Deckel teilen sich EINE Noppenform', () => {
  // Zwei Formen liefen beim naechsten Nachbessern auseinander: Die eine Reihe
  // bekaeme runde Noppen, die andere behielte ihre alten — und beides steht
  // auf demselben Bildschirm untereinander.
  const erklaerungen = [...css.matchAll(/--noppen-form:/g)].length;
  assert.equal(erklaerungen, 1,
    `Die Noppenform steht ${erklaerungen}-mal in noppe.css. Einmal reicht; die ` +
    'zweite Reihe nimmt dieselbe Form in einem anderen Takt (mask-size).');
  assert.match(css, /--noppen-form:url\("data:image\/svg\+xml,/,
    'Die Noppenform ist keine Maske mehr');
});

test('der Glanz liegt im Takt der Maske', () => {
  // ── Die Stelle, an der es still falsch wird ──────────────────────────────
  //
  // hochglanz.css legt je Noppe einen radialen Verlauf darueber. Der
  // wiederholt sich ueber `background-size`, die Form ueber `mask-size` in
  // noppe.css. Das sind ZWEI Zahlen fuer denselben Takt: Laufen sie
  // auseinander, wandert der Lichtpunkt von Noppe zu Noppe aus der Mitte —
  // und im Quelltext sieht jede der beiden Zahlen fuer sich richtig aus.
  const maskenTakte = [...css.matchAll(/\bmask-size:(\d+)px \d+px/g)].map(m => m[1]);
  const glanzTakte = [...glanz.matchAll(/\bbackground-size:(\d+)px \d+px/g)].map(m => m[1]);
  // Selbstbeweis: GEMESSEN sind es vier Masken-Takte (je Reihe einmal mit und
  // einmal ohne -webkit-) und zwei Glanz-Takte.
  assert.deepEqual([...new Set(maskenTakte)].sort(), ['22', '24'],
    `Die Masken-Takte sind ${maskenTakte.join(', ')} — greift die Suche noch?`);
  assert.deepEqual([...new Set(glanzTakte)].sort(), ['22', '24'],
    `Der Glanz wiederholt sich im Takt ${glanzTakte.join(', ')}, die Maske aber ` +
    `im Takt ${[...new Set(maskenTakte)].join(', ')}. Dann sitzt der Lichtpunkt ` +
    'nicht mehr auf der Noppe.');
});

test('die Noppe hat in beiden Oberflaechen dieselbe Form', () => {
  // Marcos Vorgabe sind einheitliche Ansichten. Hier stand ein Kreis in der
  // App neben einer Noppe im Web — das sind zwei Designs, nicht eines.
  assert.match(decor, /RoundedCornerShape\(topStart = 4\.dp, topEnd = 4\.dp\)/,
    'BrickDecor.kt zeichnet die Noppe nicht mehr als Rechteck mit runder ' +
    'Oberkante (Radius 4 wie die Maske im Web)');
  assert.ok(!/CircleShape/.test(decor),
    'Die Noppe ist in der App wieder ein Kreis. Im Web ist sie ein Rechteck ' +
    'mit runder Oberkante — dann zeigen Telefon und Rechner dasselbe Design ' +
    'in zwei Formen.');
});
