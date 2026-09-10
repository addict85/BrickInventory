/**
 * Die App schreibt die Farben der Webapp ab — diese Pruefung haelt sie fest.
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 *
 * Beide Oberflaechen sollen gleich aussehen; das ist Marcos stehende Vorgabe.
 * Technisch geht das nicht ueber eine gemeinsame Datei: Das Web liest
 * CSS-Custom-Properties (`--b600` in public/styles.css), die App braucht
 * Compose-Farben (`Color(0xFF2563EB)` in ui/theme/Theme.kt). Derselbe Wert,
 * zwei Sprachen.
 *
 * Also steht er zweimal da. Nachgezaehlt: 46 Farben in Theme.kt, und genau
 * VIER Zeilen nennen ueberhaupt, woher ihr Wert stammt. Der Rest ist eine
 * stille Abschrift — und eine stille Abschrift laeuft irgendwann weg, ohne
 * dass ein Test rot wird. Genau dieselbe Fehlerklasse, wegen der es
 * shared/setnummer-korpus.json gibt (siehe shared/README.md).
 *
 * Beim Anlegen dieser Pruefung stimmten alle zwoelf Marken- und
 * Diagrammpaare noch ueberein. Sie ist also keine Reparatur, sondern die
 * Absicherung eines Zustands, den bisher nur Sorgfalt getragen hat.
 *
 * ── Was hier NICHT geprueft wird, und warum ─────────────────────────────────
 *
 * Nicht jede Farbe der App hat ein Gegenstueck im Web, und das ist richtig so:
 *
 *   * Compose fuehrt mit `background`, `surface` und `surfaceVariant` DREI
 *     Ebenen, wo das Web mit `--bg` und `--sur` zwei fuehrt. Die dritte muss
 *     sich von den anderen unterscheiden, sonst verschwinden Flaechen, die
 *     darauf liegen (etwa die Platzhalter-Kacheln des Katalogs). Sie kann
 *     deshalb nicht einfach denselben Wert tragen.
 *   * Im Stein-Design hat das Web eine "Grundplatte" hinter der Seite, die
 *     die App gar nicht hat.
 *
 * Geprueft wird deshalb, was gleich sein MUSS: die Markenfarben und die
 * Diagrammfarben. Die Markenfarbe ist das, was beide Oberflaechen als
 * dieselbe Anwendung erkennbar macht; die Diagrammfarben tragen in beiden
 * dieselbe Bedeutung (Neu gegen Gebraucht), und wer sie wiedererkennt, muss
 * die Legende nicht lesen — so steht es in themes/brick.css begruendet.
 *
 * ── Warum diese Pruefung im WEB-Baum liegt ──────────────────────────────────
 *
 * Sie muss laufen, sobald sich EINE der beiden Seiten aendert. Der
 * Android-Arbeitsablauf hat einen Pfadfilter (Android-App/**, shared/**), der
 * Web-Ablauf hat keinen — er laeuft bei jedem Push. Hier liegt sie also
 * richtig, und zwar nur hier: Zwei Fassungen derselben Regel laufen
 * auseinander.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const CSS_BASIS = path.join(ROOT, 'Web-App', 'public', 'styles.css');
const CSS_BRICK = path.join(ROOT, 'Web-App', 'public', 'themes', 'brick.css');
const KT_THEME = path.join(ROOT, 'Android-App', 'app', 'src', 'main', 'java',
  'ch', 'brickinventoryapp', 'ui', 'theme', 'Theme.kt');

/**
 * `--name: #wert` aus einer CSS-Datei lesen und `var(--x)` einmal aufloesen.
 *
 * Die Aufloesung braucht es, weil `--bg` im Grunddesign auf `var(--s50)`
 * zeigt statt auf einen Wert. Ohne sie faende die Pruefung dort nichts und
 * bliebe still gruen.
 */
function tokenTabelle(datei) {
  // Kommentare ZUERST weg — sonst liest die Suche die Erklaerung statt der
  // Regel. Genau das ist hier beim Anlegen passiert: In themes/brick.css
  // steht im Kommentar
  //
  //     Vorher stand hier --chart-used:#3d5a80 (die Primaerfarbe des Designs)
  //
  // und die erste Fassung dieser Funktion nahm diesen ALTEN Wert fuer den
  // gueltigen. Die Pruefung meldete daraufhin eine Abweichung, die es gar
  // nicht gab. Dieselbe Falle, wegen der es Quellen.ohneKommentare gibt;
  // CSS-Kommentare koennen sich nicht schachteln, deshalb genuegt hier der
  // einfache Schnitt.
  const src = fs.readFileSync(datei, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const roh = {};
  for (const m of src.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|var\(--[a-z0-9-]+\))/g)) {
    // Die LETZTE Zuweisung gilt — so rechnet auch der Browser.
    roh[m[1]] = m[2].toLowerCase();
  }
  const fertig = {};
  for (const [name, wert] of Object.entries(roh)) {
    const zeiger = wert.match(/^var\(--([a-z0-9-]+)\)$/);
    fertig[name] = zeiger ? (roh[zeiger[1]] || wert) : wert;
  }
  return fertig;
}

const BASIS = tokenTabelle(CSS_BASIS);
// Das Stein-Design ueberschreibt nur EINEN TEIL der Tokens; alles andere erbt
// es aus :root. Der Rueckfall bildet genau das ab — ohne ihn wuerde ein
// geerbtes Token hier als "gibt es nicht" gelten.
const BRICK = { ...BASIS, ...tokenTabelle(CSS_BRICK) };
const TABELLE = { classic: BASIS, brick: BRICK };

const KT = fs.readFileSync(KT_THEME, 'utf8');

/** `val Name = Color(0xFFRRGGBB)` → '#rrggbb' */
function ktFarbe(name) {
  const m = KT.match(new RegExp(`\\bval\\s+${name}\\s*=\\s*Color\\(0x(?:FF)?([0-9A-Fa-f]{6})\\)`));
  return m ? '#' + m[1].toLowerCase() : null;
}

/**
 * Die Paare, die in BEIDEN Oberflaechen denselben Wert tragen muessen.
 *
 * Hier steht die ZUORDNUNG, nicht der Wert — beide Werte werden aus ihrem
 * jeweiligen Baum gelesen. Eine Liste von Werten waere eine dritte Wahrheit
 * und damit genau das Problem, gegen das diese Pruefung gebaut ist.
 */
const PAARE = [
  // Markenfarben: Was beide Oberflaechen als dieselbe Anwendung erkennbar macht.
  ['classic', 'BrandBlue', 'b600'],
  ['classic', 'BrandBlueDark', 'b700'],
  ['classic', 'BrandBlueLight', 'b50'],
  ['classic', 'BrandBlue50', 'b100'],
  ['brick', 'SlateBlue', 'b600'],
  ['brick', 'SlateBlueDark', 'b700'],
  ['brick', 'SlateBlueLight', 'b100'],
  ['brick', 'Petrol', 'brick-petrol'],
  // Diagrammfarben: Sie tragen in beiden Oberflaechen dieselbe BEDEUTUNG
  // (Neu gegen Gebraucht). Laufen sie auseinander, heisst dasselbe Blau in
  // der App etwas anderes als im Web.
  ['classic', 'ChartNewClassic', 'chart-new'],
  ['classic', 'ChartUsedClassic', 'chart-used'],
  ['brick', 'ChartNewBrick', 'chart-new'],
  ['brick', 'ChartUsedBrick', 'chart-used'],
];

test('Marke und Diagramm tragen in App und Webapp denselben Wert', () => {
  const abweichungen = [];
  for (const [design, ktName, token] of PAARE) {
    const web = TABELLE[design][token];
    const app = ktFarbe(ktName);
    // Selbstnachweis, beide Richtungen: Ein Paar, dessen eine Seite gar nicht
    // gefunden wird, prueft nichts — und faellt ohne diese Zeilen still durch.
    assert.ok(web, `--${token} gibt es im Design "${design}" nicht (mehr). ` +
      `Wurde es umbenannt, muss diese Zuordnung nachgezogen werden.`);
    assert.ok(app, `val ${ktName} steht nicht mehr in Theme.kt. ` +
      `Wurde es umbenannt, muss diese Zuordnung nachgezogen werden.`);
    if (web !== app) abweichungen.push(`${design}: ${ktName}=${app} gegen --${token}=${web}`);
  }
  assert.deepEqual(abweichungen, [],
    'Die App zeigt andere Farben als die Webapp:\n  ' + abweichungen.join('\n  ') +
    '\nBeide Oberflaechen sollen gleich aussehen. Wurde der Wert im Web ' +
    'geaendert, gehoert er auch nach Theme.kt (und umgekehrt).');
});

test('jede Herkunftsangabe in Theme.kt stimmt', () => {
  // ── Warum das eine eigene Pruefung ist ──────────────────────────────────
  //
  // Die Liste oben sagt, was gleich sein MUSS. Diese hier sagt: Was der
  // Quelltext ueber sich selbst BEHAUPTET, muss wahr sein. Sie erfindet
  // nichts — sie liest die Behauptung aus der Datei.
  //
  // Sie ist nicht ueberfluessig neben der Liste: Sie erfasst auch Zeilen, die
  // dort nicht stehen, und sie hat beim Anlegen sofort etwas gefunden. In
  // Zeile 36 stand
  //
  //     background = Color(0xFFF1F5F9),  // --s50 equivalent
  //
  // waehrend --s50 den Wert #f8fafc traegt; #f1f5f9 ist --s100. Der Kommentar
  // widersprach seinem eigenen Wert. Richtig ist hier der WERT, nicht der
  // Kommentar — warum, steht an der Zeile selbst.
  //
  // Welches Design gilt, entscheidet der Abschnitt: Alles ab der Ueberschrift
  // des Stein-Designs gehoert zu "brick".
  const marke = KT.indexOf('// ── Stein-Design');
  assert.ok(marke > 0, 'Die Abschnittsmarke des Stein-Designs fehlt — ' +
    'ohne sie kann diese Pruefung Klassisch und Stein nicht unterscheiden.');

  const behauptungen = [];
  const zeilen = KT.split('\n');
  let pos = 0;
  for (const z of zeilen) {
    const design = pos < marke ? 'classic' : 'brick';
    pos += z.length + 1;
    const token = z.match(/--([a-z0-9-]+)/);
    if (!token) continue;
    // Form A: Farbe und Token auf derselben Zeile.
    const farbe = z.match(/Color\(0x(?:FF)?([0-9A-Fa-f]{6})\)/);
    // Form B: der Kommentar nennt Wert UND Token ("#2563eb = --b600").
    const hex = z.match(/#([0-9a-fA-F]{6})\s*=\s*--/);
    const wert = hex ? '#' + hex[1].toLowerCase()
      : farbe ? '#' + farbe[1].toLowerCase() : null;
    if (!wert) continue;   // blosse Erwaehnung im Fliesstext, keine Behauptung
    behauptungen.push({ design, token: token[1], wert, zeile: z.trim() });
  }

  // Selbstnachweis: Findet die Suche nichts, meldet sie auch nichts.
  assert.ok(behauptungen.length >= 3,
    `Nur ${behauptungen.length} Herkunftsangaben gefunden — die Suche greift ` +
    `nicht mehr. Vor dem Anpassen dieser Zahl nachsehen, ob die Angaben ` +
    `wirklich verschwunden sind.`);

  const falsch = [];
  for (const b of behauptungen) {
    const web = TABELLE[b.design][b.token];
    if (!web) { falsch.push(`--${b.token} gibt es im Design "${b.design}" nicht: ${b.zeile}`); continue; }
    if (web !== b.wert) falsch.push(`${b.zeile}  →  --${b.token} ist ${web}, hier steht ${b.wert}`);
  }
  assert.deepEqual(falsch, [],
    'Diese Zeilen in Theme.kt behaupten eine Herkunft, die nicht stimmt:\n  ' +
    falsch.join('\n  ') +
    '\nEntweder ist der Wert falsch abgeschrieben, oder der Kommentar nennt ' +
    'das falsche Token. Ein Kommentar, der seinem Wert widerspricht, ist ' +
    'schlimmer als keiner.');
});
