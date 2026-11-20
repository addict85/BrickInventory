const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// TREE und nicht ROOT: eigenbruecken.test.js loest jedes `path.join(ROOT, …)`
// gegen die WEB-Wurzel auf. Ein zweiter Sinn fuer denselben Namen hat in
// dieser Sitzung schon einmal eine Stunde gekostet.
const TREE = path.join(__dirname, '..', '..');
const css = fs.readFileSync(path.join(TREE, 'Web-App', 'public', 'themes', 'noppe.css'), 'utf8');
const glanz = fs.readFileSync(path.join(TREE, 'Web-App', 'public', 'themes', 'hochglanz.css'), 'utf8');
const quelle = JSON.parse(fs.readFileSync(path.join(TREE, 'shared', 'design-tokens.json'), 'utf8'));

/**
 * Das Design "noppe" — der Klemmbaustein als Bauteil der Oberflaeche. Geprüft
 * wird die Webapp; die App zeichnet dasselbe Design aus shared/design-tokens.json.
 */

test('die Deckelfarben stehen aus DERSELBEN Quelle', () => {
  const steine = quelle.listen.steine.werte;
  assert.ok(
    steine.length === 6,
    `Die Steinliste hat ${steine.length} Eintraege statt sechs — sechs, damit die ` +
      'Wiederholung als Rhythmus lesbar bleibt statt als Zufall.',
  );

  // Keine der sechs Farben darf als Hex-Wert im Stylesheet
  // stehen. Steht sie dort, ist sie abgeschrieben — und eine Abschrift zieht
  // beim naechsten Mal nicht mit.
  for (const hex of steine) {
    assert.ok(
      !css.toLowerCase().includes(hex.toLowerCase()),
      `themes/noppe.css schreibt ${hex} aus, statt var(--stein-N) zu benutzen`,
    );
  }
  assert.match(css, /var\(--stein-0\)/, 'themes/noppe.css benutzt die Steinliste nicht');
});

test('die Steinfarbe laeuft im Takt der Steinliste', () => {
  // Modulo sechs, und zwar an derselben Zahl: Laeuft das Web durch sechs und
  // die App durch vier, zeigt dasselbe Set auf Telefon und Rechner einen
  // anderen Deckel — und niemand kaeme auf die Idee, das fuer einen Fehler zu
  // halten, weil die Farbe ja nichts bedeutet. …
  const webTick = new Set([...css.matchAll(/nth-child\(6n\+?(\d*)\)/g)].map(m => m[1])).size;
  assert.equal(
    webTick,
    5,
    `themes/noppe.css zaehlt an ${webTick} verschiedenen Positionen durch, erwartet fuenf ` +
      '(--stein-0 steht als Vorgabe schon in der Grundregel)',
  );
});

test('Rahmen und Versatzschatten stehen auf demselben Ton', () => {
  // Kunststoff wirft keine Wolke, er liegt auf: Der Schatten ist derselbe Ton
  // wie der Rahmen, nur versetzt. Waeren es zwei Toene, saehe die Kante aus
  // wie ein Druckfehler.
  const schatten = [...css.matchAll(/--sh\d:([^;]+);/g)].map(m => m[1].trim());
  assert.ok(schatten.length >= 3, `Nur ${schatten.length} Schattenstufen — greift die Suche noch?`);
  for (const s of schatten) {
    assert.match(
      s,
      /var\(--ink\)/,
      `Die Schattenstufe "${s}" benutzt nicht die Tinte. Zwei Toene fuer ` +
        'Rahmen und Schatten sehen aus wie ein Druckfehler.',
    );
    assert.ok(!/blur|rgba/.test(s), `Die Schattenstufe "${s}" ist weich. Dieses Design kennt nur harte Kanten.`);
  }
});

test('die Steinfarbe bleibt Takt und wird nie Auskunft', () => {});

test('die Tabelle bleibt leise', () => {
  // Das Laute gehoert an die Raender — Kopfleiste, Knoepfe, Plaketten —, nicht
  // zwischen die Zahlen. Ein Bestand ist nichts, was man einmal anschaut.
  const tabelle = css.slice(css.indexOf('table td'));
  assert.ok(tabelle.length > 0, 'Die Tabellenregel ist nicht mehr zu finden');
  assert.ok(
    !/border-bottom:2\.5px solid var\(--ink\)/.test(tabelle),
    'Die Tabellenzeilen haben die Tintenkante bekommen. Das ist dann ein ' + 'Gitter und kein Text.',
  );
});

test('das Design fuehrt seine Schrift', () => {
  assert.match(
    css,
    /--font:'Nunito'/,
    'themes/noppe.css stellt die Schrift nicht um — dann ist das Design im Web ' + 'nur eine Farbvariante',
  );
  const fonts = fs.readFileSync(path.join(TREE, 'Web-App', 'public', 'vendor', 'fonts', 'fonts.css'), 'utf8');
  assert.match(
    fonts,
    /font-family: 'Nunito'/,
    'Die Schrift ist nicht selbst gehostet. Von einem Fremdhost bekaeme eine ' +
      'Installation im Offline-Betrieb sie gar nicht — genau der Grund, aus dem ' +
      'die anderen beiden Familien hier liegen.',
  );
});

test('hochglanz erbt die Palette, statt sie abzuschreiben', () => {
  assert.equal(
    quelle.designs.hochglanz.erbt,
    'noppe',
    'hochglanz fuehrt eine eigene Palette. Es ist dieselbe wie die von noppe — ' +
      'eine Abschrift zieht beim naechsten Mal nicht mit.',
  );
  // Und der Generator muss daraus wirklich Werte machen, sonst faellt das
  // Design auf das Grunddesign zurueck und ist blau statt rot.
  const tokens = fs.readFileSync(path.join(TREE, 'Web-App', 'public', 'tokens.css'), 'utf8');
  const block = tokens.slice(tokens.indexOf('[data-theme="hochglanz"]'));
  assert.match(
    block.slice(0, 400),
    /--b600: #d91f26;/,
    'tokens.css traegt fuer hochglanz keine aufgeloeste Palette — dann greift :root, und ' +
      'das Design waere blau statt rot',
  );
});

test('hochglanz traegt nur die Schichten, nicht die Anatomie', () => {
  // Jede Regel in noppe.css gilt fuer BEIDE Designs — das ist die gemeinsame
  // Grundlage. hochglanz.css darf sie nicht ein zweites Mal aufstellen.
  const studRules = [...css.matchAll(/\[data-theme="noppe"\][^{]*\{/g)].length;
  assert.ok(studRules >= 10, `Nur ${studRules} Regeln in noppe.css — greift die Suche noch?`);
  assert.ok(
    !/\[data-theme="noppe"\]/.test(glanz),
    'hochglanz.css nennt noppe — die gemeinsamen Regeln gehoeren in noppe.css, einmal',
  );

  // Die Anatomie darf hier nicht noch einmal stehen. Diese vier Eigenschaften
  // bestimmen sie; taucht eine davon hier auf, ist die Datei kein Aufsatz mehr,
  // sondern ein zweites Design.
  for (const property of ['--rad:', '--font:', 'border-radius:14px', 'padding-top:26px']) {
    assert.ok(!glanz.includes(property), `hochglanz.css setzt ${property} — das ist Anatomie und steht in noppe.css`);
  }
});

test('der harte Versatzschatten ueberlebt den Lack', () => {
  // Die Kante traegt, auch wenn sie glaenzt. Faellt sie weg, ist es eine
  // andere Anatomie und nicht dasselbe Design in einem anderen Material.
  const karte = glanz.slice(glanz.indexOf('[data-theme="hochglanz"] .card'));
  assert.match(
    karte,
    /0 4px 0 var\(--ink\)/,
    'Der harte Versatzschatten ist im Lack verschwunden. Dann glaenzt etwas ' +
      'anderes als noppe, und es ist nicht mehr dasselbe Design.',
  );
});

test('der Lichtstreifen liegt nicht ueber der ganzen Kachel', () => {
  // Ein weisser Schleier über weissem Text ist kein Glanz, sondern Grau.
  const strip = '118deg';
  assert.ok(glanz.includes(strip), 'Der Lichtstreifen fehlt ganz');
  // Er darf auf dem Bildfeld (.sci) liegen, nicht auf der Kachel (.sc) selbst.
  for (const regel of glanz.split('}')) {
    if (!regel.includes(strip)) continue;
    const kopf = regel.slice(0, regel.indexOf('{'));
    assert.ok(
      /\.sci\b/.test(kopf) && !/\.sc\s*[,{]/.test(kopf),
      `Der Lichtstreifen steht in einer Regel fuer "${kopf.trim()}". Er gehoert ` +
        'auf das Bildfeld (.sci) — ueber weissem Text ist er Grau, nicht Glanz.',
    );
  }
});

test('der Glanz steht auf festen Haltepunkten', () => {
  // Der Lichtabfall ist in CSS ein linear-gradient und in Compose ein
  // Brush.verticalGradient. Verschiedene Sprachen, dieselben vier Haltepunkte —
  // laufen sie auseinander, sieht dasselbe Design auf Telefon und Rechner
  // anders aus, und niemand sucht den Grund in einer Zahl.
  const fromCss = [...glanz.matchAll(/rgba\((?:255,255,255|0,0,0),\.(\d+)\) (\d+)%/g)].map(m => `${m[2]}/${m[1]}`);
  assert.ok(fromCss.length >= 4, `Nur ${fromCss.length} Haltepunkte im CSS — greift die Suche noch?`);
});

test('der Deckel ist EIN Baustein, nicht zwei', () => {});

/** Die beiden Regeln, die eine Noppenreihe zeichnen. */
const studsRows = () => css.split('}').filter(r => /header::before|\.sc::after/.test(r.slice(0, r.indexOf('{') + 1)));

test('die Noppen haben eine runde Oberkante, keine Verlaufskante', () => {
  const reihen = studsRows();
  // Selbstbeweis: GEMESSEN sind es zwei — die Kopfleiste und der Kacheldeckel.
  assert.equal(reihen.length, 2, `${reihen.length} Noppenreihen gefunden statt zwei — greift die Suche noch?`);

  for (const reihe of reihen) {
    const kopf = reihe.slice(0, reihe.indexOf('{')).trim();
    assert.ok(reihe.includes('var(--noppen-form)'), `"${kopf}" benutzt die Noppenform nicht`);
    assert.ok(
      !/repeating-linear-gradient/.test(reihe),
      `"${kopf}" zeichnet die Noppen wieder als Verlauf. Ein Verlauf kann keine ` +
        'runden Ecken — genau daran sahen sie aus wie Striche.',
    );
    assert.ok(
      !/border-radius/.test(reihe),
      `"${kopf}" rundet mit border-radius. Das rundet den BALKEN, nicht die ` +
        'einzelne Noppe — der Unterschied war in der laufenden App zu sehen.',
    );
  }
});

test('Leiste und Deckel teilen sich EINE Noppenform', () => {
  // Zwei Formen liefen beim naechsten Nachbessern auseinander: Die eine Reihe
  // bekaeme runde Noppen, die andere behielte ihre alten — und beides steht
  // auf demselben Bildschirm untereinander.
  const grund = fs.readFileSync(path.join(TREE, 'Web-App', 'public', 'styles.css'), 'utf8');
  const explanations = [...(css + grund).matchAll(/--noppen-form:/g)].length;
  assert.equal(
    explanations,
    1,
    `Die Noppenform steht ${explanations}-mal im Baum. Einmal reicht; jede ` +
      'weitere Reihe nimmt dieselbe Form in einem anderen Takt (mask-size).',
  );
  assert.match(grund, /--noppen-form:url\("data:image\/svg\+xml,/, 'Die Noppenform ist keine Maske mehr');
});

test('der Glanz liegt im Takt der Maske', () => {
  // Die Stelle, an der es still falsch wird
  const masksTicks = [...css.matchAll(/\bmask-size:(\d+)px \d+px/g)].map(m => m[1]);
  const glossTicks = [...glanz.matchAll(/\bbackground-size:(\d+)px \d+px/g)].map(m => m[1]);
  // Selbstbeweis: GEMESSEN sind es vier Masken-Takte (je Reihe einmal mit und
  // einmal ohne -webkit-) und zwei Glanz-Takte.
  assert.deepEqual(
    [...new Set(masksTicks)].sort(),
    ['22', '24'],
    `Die Masken-Takte sind ${masksTicks.join(', ')} — greift die Suche noch?`,
  );
  assert.deepEqual(
    [...new Set(glossTicks)].sort(),
    ['22', '24'],
    `Der Glanz wiederholt sich im Takt ${glossTicks.join(', ')}, die Maske aber ` +
      `im Takt ${[...new Set(masksTicks)].join(', ')}. Dann sitzt der Lichtpunkt ` +
      'nicht mehr auf der Noppe.',
  );
});

test('die Deckelfarbe loescht den Lack nicht', () => {
  // Der Fehler, den diese Zusicherung verhindert
  const colorRules = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('}')
    .filter(r => /--stein-\d/.test(r));
  // Selbstbeweis: GEMESSEN sind es sechs — die Grundregel und fuenf Positionen.
  assert.equal(
    colorRules.length,
    6,
    `${colorRules.length} Regeln mit einer Deckelfarbe statt sechs — greift die Suche noch?`,
  );

  const shortForm = colorRules
    .filter(r => /(?:^|[;{\s])background:\s*var\(--stein-/.test(r))
    .map(r => r.slice(0, r.indexOf('{')).trim().split(',')[0]);
  assert.deepEqual(
    shortForm,
    [],
    'Diese Regeln setzen die Deckelfarbe mit der Kurzform `background:`. Sie ' +
      'loescht damit den `background-image` des Lacks — und weil :nth-child wie ' +
      'eine Klasse zaehlt, gewinnt sie gegen hochglanz.css. `background-color:` ' +
      'setzt nur die Farbe und laesst den Lack stehen.',
  );
});

const stein = fs.readFileSync(path.join(TREE, 'Web-App', 'public', 'themes', 'brick.css'), 'utf8');
const grundCss = fs.readFileSync(path.join(TREE, 'Web-App', 'public', 'styles.css'), 'utf8');

test('die Noppenform gehoert allen Designs, nicht einem', () => {
  // Sie stand in themes/noppe.css. Solange nur ein Design Noppen zeichnete,
  // war das richtig; seit es zwei sind, ist es die Stelle, an der sie
  // auseinanderlaufen.
  assert.match(
    grundCss,
    /--noppen-form:url\("data:image\/svg\+xml,/,
    'Die Noppenform steht nicht mehr in styles.css unter :root',
  );
  assert.ok(
    !/--noppen-form:/.test(css),
    'themes/noppe.css fuehrt wieder eine eigene Noppenform — dann hat das ' +
      'Stein-Design seine eigene, und genau so ist der Unterschied entstanden.',
  );
  assert.match(stein, /var\(--noppen-form\)/, 'Das Stein-Design benutzt die gemeinsame Noppenform nicht');
  // Nur die REIHE, nicht jeder Kreis: Die Griffe der Jahres-Schieberegler sind
  // runde Knoepfe mit einem Glanzpunkt (`circle at 35% 32%`) und sollen das
  // bleiben. Eine Noppenreihe erkennt man an der Verankerung in Pixeln —
  // `circle at 8px center`, alle 16px wiederholt. Die erste Fassung verbot
  // beides und haette zwei richtige Regeln mitgerissen.
  const reihen = [...stein.matchAll(/radial-gradient\(circle at \d+px center/g)];
  assert.deepEqual(
    reihen.map(m => m[0]),
    [],
    'Das Stein-Design zeichnet eine Noppenreihe wieder als Kreise. Von vorn ist ' +
      'eine Noppe ein Rechteck mit runder Oberkante — das war der Grund, aus dem ' +
      'die Kante wie „ein Balken mit Punkten" aussah.',
  );
});
