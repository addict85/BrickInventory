/**
 * Die Farben, die BEIDE Oberflaechen gleich fuehren muessen, stehen EINMAL.
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 *
 * Beide Oberflaechen sollen gleich aussehen; das ist Marcos stehende Vorgabe.
 * Technisch geht das nicht ueber eine gemeinsame Datei: Das Web liest
 * CSS-Custom-Properties, die App braucht Compose-Farben. Derselbe Wert, zwei
 * Sprachen.
 *
 * Also stand er zweimal da. Nachgezaehlt: 46 Farben in Theme.kt, und genau
 * VIER Zeilen nannten ueberhaupt, woher ihr Wert stammt. Der Rest war eine
 * stille Abschrift — und eine stille Abschrift laeuft irgendwann weg, ohne
 * dass ein Test rot wird. Dieselbe Fehlerklasse, wegen der es
 * shared/setnummer-korpus.json gibt (siehe shared/README.md).
 *
 * Jetzt steht der Wert einmal, in shared/design-tokens.json, und beide Seiten
 * werden daraus erzeugt: public/tokens.css und ui/theme/DesignTokens.kt.
 *
 * ── Was hier NICHT mehr steht, und warum ────────────────────────────────────
 *
 * Die erste Fassung dieser Datei verglich zwoelf Paare "Kotlin-Konstante gegen
 * CSS-Token" einzeln. Diese Pruefung ist mit der Erzeugung UEBERFLUESSIG
 * geworden: Beide Werte kommen jetzt aus derselben Zeile derselben Datei, sie
 * KOENNEN nicht mehr auseinanderlaufen. Eine Zusicherung, die nicht mehr
 * fehlschlagen kann, ist keine Absicherung, sondern Zierrat — und sie
 * verdeckt, wo die echte Gefahr jetzt liegt. Sie ist deshalb ersetzt, nicht
 * ergaenzt.
 *
 * Die echte Gefahr ist neu und liegt woanders:
 *
 *   1. Jemand aendert eine erzeugte Datei von Hand. Dann steht der Wert wieder
 *      zweimal, und beim naechsten `npm run build` ist die Aenderung weg.
 *   2. Jemand definiert einen erzeugten Token in einem handgeschriebenen
 *      Stylesheet NEU. Dann gewinnt dort das handgeschriebene, die App folgt
 *      aber weiter der gemeinsamen Quelle — genau das Auseinanderlaufen, gegen
 *      das der ganze Umbau gebaut ist, nur eine Ebene hoeher.
 *   3. index.html laedt tokens.css nicht mehr. Dann faellt im Web JEDE dieser
 *      Farben aus, und `var(--b600)` liefert nichts.
 *
 * Gegen alle drei steht je eine Pruefung unten. Die vierte Pruefung
 * ("Herkunftsangabe") bleibt aus der ersten Fassung: Sie gilt den Farben, die
 * WEITERHIN von Hand in Theme.kt stehen und kein Gegenstueck im Web haben.
 *
 * ── Was bewusst NICHT gemeinsam ist ─────────────────────────────────────────
 *
 * Compose fuehrt mit background/surface/surfaceVariant drei Ebenen, wo das Web
 * mit --bg/--sur zwei fuehrt; die dritte muss sich unterscheiden, sonst
 * verschwinden Flaechen, die darauf liegen. Und im Stein-Design hat das Web
 * eine "Grundplatte" hinter der Seite, die die App gar nicht hat. Solche Werte
 * gehoeren nicht in die gemeinsame Quelle — shared/README.md sagt es
 * ausdruecklich: Ein Fall, der nur auf einer Seite gelten kann, gehoert nicht
 * dorthin.
 *
 * ── Warum diese Pruefung im WEB-Baum liegt ──────────────────────────────────
 *
 * Sie muss laufen, sobald sich EINE der beiden Seiten aendert. Der
 * Android-Ablauf hat einen Pfadfilter, der Web-Ablauf hat keinen — er laeuft
 * bei jedem Push.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { baueCss, baueKotlin, QUELLE, ZIEL_CSS, ZIEL_KT } =
  require('../scripts/generate-design-tokens.js');

// BAUM, nicht ROOT: In jeder anderen Testdatei dieses Ordners heisst `ROOT`
// die Wurzel der WEB-APP. eigenbruecken.test.js prueft darauf gestuetzt jeden
// `path.join(BAUM, ...)` gegen den Web-Baum — und meldete diese Datei prompt
// als kaputt, weil hier die Wurzel des REPOSITORYS gemeint ist. Derselbe Name
// fuer zwei verschiedene Dinge; der Name wechselt, nicht die Regel.
const BAUM = path.join(__dirname, '..', '..');
const CSS_BASIS = path.join(BAUM, 'Web-App', 'public', 'styles.css');
const CSS_BRICK = path.join(BAUM, 'Web-App', 'public', 'themes', 'brick.css');
const CSS_MOBIL = path.join(BAUM, 'Web-App', 'public', 'mobile.css');
const INDEX = path.join(BAUM, 'Web-App', 'public', 'index.html');
const KT_THEME = path.join(BAUM, 'Android-App', 'app', 'src', 'main', 'java',
  'ch', 'brickinventoryapp', 'ui', 'theme', 'Theme.kt');

const DATEN = JSON.parse(fs.readFileSync(QUELLE, 'utf8'));

/**
 * `--name: #wert` aus einer CSS-Datei lesen und `var(--x)` einmal aufloesen.
 *
 * Kommentare ZUERST weg — sonst liest die Suche die Erklaerung statt der
 * Regel. Genau das ist beim Anlegen passiert: In themes/brick.css stand im
 * Kommentar "Vorher stand hier --chart-used:#3d5a80", und die erste Fassung
 * nahm diesen ALTEN Wert fuer den gueltigen. Dieselbe Falle, wegen der es
 * Quellen.ohneKommentare gibt; CSS-Kommentare schachteln nicht, deshalb
 * genuegt der einfache Schnitt.
 *
 * Die Aufloesung von `var(--x)` braucht es, weil --bg auf var(--s50) zeigt
 * statt auf einen Wert.
 */
function tokenTabelle(datei) {
  const src = fs.readFileSync(datei, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const roh = {};
  for (const m of src.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|var\(--[a-z0-9-]+\))/g)) {
    roh[m[1]] = m[2].toLowerCase();   // die LETZTE Zuweisung gilt, wie im Browser
  }
  const fertig = {};
  for (const [name, wert] of Object.entries(roh)) {
    const zeiger = wert.match(/^var\(--([a-z0-9-]+)\)$/);
    fertig[name] = zeiger ? (roh[zeiger[1]] || wert) : wert;
  }
  return fertig;
}

test('die erzeugten Dateien stimmen mit shared/design-tokens.json ueberein', () => {
  // Beide Erzeugnisse liegen mit im Baum — sie MUESSEN das, weil der
  // Android-Build kein Node kennt und DesignTokens.kt sonst gar nicht haette.
  // Damit sie trotzdem nicht von Hand gepflegt werden, wird hier dieselbe
  // Rechnung nochmals angestellt und verglichen.
  for (const [datei, erwartet] of [[ZIEL_CSS, baueCss(DATEN)], [ZIEL_KT, baueKotlin(DATEN)]]) {
    const ist = fs.readFileSync(datei, 'utf8');
    assert.equal(ist, erwartet,
      `${path.relative(BAUM, datei)} weicht von shared/design-tokens.json ab.\n` +
      `Entweder wurde die Datei von Hand geaendert — dann gehoert der Wert in ` +
      `die JSON —, oder es fehlt ein Lauf von "npm run design:tokens".`);
  }
});

test('kein handgeschriebenes Stylesheet definiert einen erzeugten Token neu', () => {
  // ── Die Gefahr, die dieser Umbau NEU schafft ────────────────────────────
  //
  // Definiert styles.css wieder ein eigenes --b600, gewinnt dort das
  // handgeschriebene (gleiche Spezifitaet, spaeter geladen). Die App folgt
  // aber weiter der gemeinsamen Quelle. Ergebnis: dasselbe Auseinanderlaufen
  // wie vorher, nur eine Ebene hoeher und schlechter zu sehen.
  const erzeugt = new Set(Object.values(DATEN.designs).flatMap(t => Object.keys(t)));
  assert.ok(erzeugt.size >= 10, `Nur ${erzeugt.size} erzeugte Tokens — greift die Suche noch?`);

  const doppelt = [];
  for (const datei of [CSS_BASIS, CSS_BRICK, CSS_MOBIL]) {
    const src = fs.readFileSync(datei, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of src.matchAll(/--([a-z0-9-]+)\s*:/g)) {
      if (erzeugt.has(m[1])) doppelt.push(`${path.basename(datei)}: --${m[1]}`);
    }
  }
  assert.deepEqual(doppelt, [],
    'Diese Tokens werden erzeugt UND von Hand gesetzt:\n  ' + doppelt.join('\n  ') +
    '\nDamit gilt im Web der handgeschriebene Wert und in der App der erzeugte. ' +
    'Der Wert gehoert nach shared/design-tokens.json.');
});

test('index.html laedt die erzeugten Tokens', () => {
  // Ohne diese Zeile liefert jedes var(--b600) im Web nichts — und zwar still:
  // Die Seite baut sich auf, nur farblos.
  const html = fs.readFileSync(INDEX, 'utf8');
  const stelle = html.indexOf('/tokens.css');
  assert.ok(stelle > 0, 'index.html laedt /tokens.css nicht — im Web fehlt dann ' +
    'jede gemeinsame Farbe, ohne dass irgendwo ein Fehler erscheint.');
  // Und zwar VOR styles.css: Die Tokens sind die Grundlage, alles andere baut
  // darauf auf. (Fuer die Aufloesung von var() waere die Reihenfolge egal —
  // fuer den Menschen, der die Datei liest, nicht.)
  assert.ok(stelle < html.indexOf('/styles.css'),
    'tokens.css wird nach styles.css geladen — die Grundlage gehoert nach oben.');
});

test('jede Herkunftsangabe in Theme.kt stimmt', () => {
  // ── Was hier noch geprueft wird ─────────────────────────────────────────
  //
  // In Theme.kt stehen weiterhin Farben von Hand: die, die kein Gegenstueck im
  // Web haben (siehe Kopf dieser Datei). Nennt eine davon ein CSS-Token als
  // Herkunft, muss die Angabe stimmen. Diese Pruefung erfindet nichts — sie
  // liest die Behauptung aus der Datei.
  //
  // Sie hat beim Anlegen sofort etwas gefunden. Dort stand
  //
  //     background = Color(0xFFF1F5F9),  // --s50 equivalent
  //
  // waehrend --s50 den Wert #f8fafc traegt; #f1f5f9 ist --s100. Der Kommentar
  // widersprach seinem eigenen Wert. Richtig war der WERT — warum, steht an
  // der Zeile selbst.
  const KT = fs.readFileSync(KT_THEME, 'utf8');
  const BASIS = tokenTabelle(CSS_BASIS);
  // Das Stein-Design ueberschreibt nur einen TEIL der Tokens; alles andere
  // erbt es aus :root. Und beide Designs erben jetzt die erzeugten aus
  // tokens.css — ohne die waere die Tabelle unvollstaendig.
  const ERZEUGT = tokenTabelle(ZIEL_CSS);
  const TABELLE = {
    classic: { ...BASIS, ...ERZEUGT },
    brick: { ...BASIS, ...ERZEUGT, ...tokenTabelle(CSS_BRICK) },
  };
  // tokenTabelle() liest tokens.css als EINE Datei, die beide Designs
  // enthaelt — die spaetere (brick) Zuweisung gewinnt dabei. Fuer "classic"
  // muss deshalb der :root-Teil allein gelesen werden.
  const nurRoot = fs.readFileSync(ZIEL_CSS, 'utf8').split('[data-theme=')[0];
  for (const m of nurRoot.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})/g)) {
    TABELLE.classic[m[1]] = m[2].toLowerCase();
  }

  const marke = KT.indexOf('// ── Stein-Design');
  assert.ok(marke > 0, 'Die Abschnittsmarke des Stein-Designs fehlt — ohne sie ' +
    'kann diese Pruefung Klassisch und Stein nicht unterscheiden.');

  const behauptungen = [];
  let pos = 0;
  for (const z of KT.split('\n')) {
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
  assert.ok(behauptungen.length >= 1,
    'Keine einzige Herkunftsangabe gefunden — greift die Suche noch? Vor dem ' +
    'Anpassen dieser Zahl nachsehen, ob die Angaben wirklich verschwunden sind.');

  const falsch = [];
  for (const b of behauptungen) {
    const web = TABELLE[b.design][b.token];
    if (!web) { falsch.push(`--${b.token} gibt es im Design "${b.design}" nicht: ${b.zeile}`); continue; }
    if (web !== b.wert) falsch.push(`${b.zeile}  →  --${b.token} ist ${web}, hier steht ${b.wert}`);
  }
  assert.deepEqual(falsch, [],
    'Diese Zeilen in Theme.kt behaupten eine Herkunft, die nicht stimmt:\n  ' +
    falsch.join('\n  ') +
    '\nEntweder ist der Wert falsch abgeschrieben, oder der Kommentar nennt das ' +
    'falsche Token. Ein Kommentar, der seinem Wert widerspricht, ist schlimmer ' +
    'als keiner.');
});
