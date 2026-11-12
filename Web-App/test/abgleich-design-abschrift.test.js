/**
 * Die Farben, die BEIDE Oberflaechen gleich fuehren muessen, stehen EINMAL.
 */
// Abgleich Web↔App: läuft in web-ci auch bei Änderungen unter Android-App/ (paths-Filter).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { baueCss, baueKotlin, baueKotlinDunkel, QUELLE, ZIEL_CSS, ZIEL_KT, ZIEL_DUNKEL_KT } =
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
const KT_THEME = path.join(
  __dirname,
  '..',
  '..',
  'Android-App',
  'core-ui',
  'src',
  'main',
  'java',
  'ch',
  'brickinventoryapp',
  'ui',
  'theme',
  'Theme.kt',
);

const DATEN = JSON.parse(fs.readFileSync(QUELLE, 'utf8'));

/**
 * `--name: #wert` aus einer CSS-Datei lesen und `var(--x)` einmal aufloesen.
 */
function tokenTabelle(datei) {
  // Die dunklen Varianten (seit 29.10.) sind eine zweite Belegung derselben
  // Namen; gelesen wird hier die helle.
  const src = fs
    .readFileSync(datei, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\[data-dunkel\][^{]*\{[^}]*\}/g, '');
  const roh = {};
  for (const m of src.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|var\(--[a-z0-9-]+\))/g)) {
    roh[m[1]] = m[2].toLowerCase(); // die LETZTE Zuweisung gilt, wie im Browser
  }
  const fertig = {};
  for (const [name, wert] of Object.entries(roh)) {
    const zeiger = wert.match(/^var\(--([a-z0-9-]+)\)$/);
    fertig[name] = zeiger ? roh[zeiger[1]] || wert : wert;
  }
  return fertig;
}

test('die erzeugten Dateien stimmen mit shared/design-tokens.json ueberein', () => {
  // Beide Erzeugnisse liegen mit im Baum — sie MUESSEN das, weil der
  // Android-Build kein Node kennt und DesignTokens.kt sonst gar nicht haette.
  // Damit sie trotzdem nicht von Hand gepflegt werden, wird hier dieselbe
  // Rechnung nochmals angestellt und verglichen. …
  //
  // Gegenprobe (30.10., gemessen): dort "txt" von Hand auf #e6e9ee → rot.
  for (const [datei, erwartet] of [
    [ZIEL_CSS, baueCss(DATEN)],
    [ZIEL_KT, baueKotlin(DATEN)],
    [ZIEL_DUNKEL_KT, baueKotlinDunkel(DATEN)],
  ]) {
    const ist = fs.readFileSync(datei, 'utf8');
    assert.equal(
      ist,
      erwartet,
      `${path.relative(BAUM, datei)} weicht von shared/design-tokens.json ab.\n` +
        `Entweder wurde die Datei von Hand geaendert — dann gehoert der Wert in ` +
        `die JSON —, oder es fehlt ein Lauf von "npm run design:tokens".`,
    );
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
    // Die dunklen Varianten (seit 29.10.) sind eine zweite Belegung derselben
    // Namen; gelesen wird hier die helle.
    const src = fs
      .readFileSync(datei, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\[data-dunkel\][^{]*\{[^}]*\}/g, '');
    for (const m of src.matchAll(/--([a-z0-9-]+)\s*:/g)) {
      if (erzeugt.has(m[1])) doppelt.push(`${path.basename(datei)}: --${m[1]}`);
    }
  }
  assert.deepEqual(
    doppelt,
    [],
    'Diese Tokens werden erzeugt UND von Hand gesetzt:\n  ' +
      doppelt.join('\n  ') +
      '\nDamit gilt im Web der handgeschriebene Wert und in der App der erzeugte. ' +
      'Der Wert gehoert nach shared/design-tokens.json.',
  );
});

test('index.html laedt die erzeugten Tokens', () => {
  // Ohne diese Zeile liefert jedes var(--b600) im Web nichts — und zwar still:
  // Die Seite baut sich auf, nur farblos.
  const html = fs.readFileSync(INDEX, 'utf8');
  const stelle = html.indexOf('/tokens.css');
  assert.ok(
    stelle > 0,
    'index.html laedt /tokens.css nicht — im Web fehlt dann ' +
      'jede gemeinsame Farbe, ohne dass irgendwo ein Fehler erscheint.',
  );
  // Und zwar VOR styles.css: Die Tokens sind die Grundlage, alles andere baut
  // darauf auf. (Fuer die Aufloesung von var() waere die Reihenfolge egal —
  // fuer den Menschen, der die Datei liest, nicht.)
  assert.ok(
    stelle < html.indexOf('/styles.css'),
    'tokens.css wird nach styles.css geladen — die Grundlage gehoert nach oben.',
  );
});

test('jede Herkunftsangabe in Theme.kt stimmt', () => {
  // Was hier noch geprueft wird
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
  assert.ok(
    marke > 0,
    'Die Abschnittsmarke des Stein-Designs fehlt — ohne sie ' +
      'kann diese Pruefung Klassisch und Stein nicht unterscheiden.',
  );

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
    const wert = hex ? '#' + hex[1].toLowerCase() : farbe ? '#' + farbe[1].toLowerCase() : null;
    if (!wert) continue; // blosse Erwaehnung im Fliesstext, keine Behauptung
    behauptungen.push({ design, token: token[1], wert, zeile: z.trim() });
  }

  // Selbstnachweis: Findet die Suche nichts, meldet sie auch nichts.
  assert.ok(
    behauptungen.length >= 1,
    'Keine einzige Herkunftsangabe gefunden — greift die Suche noch? Vor dem ' +
      'Anpassen dieser Zahl nachsehen, ob die Angaben wirklich verschwunden sind.',
  );

  const falsch = [];
  for (const b of behauptungen) {
    const web = TABELLE[b.design][b.token];
    if (!web) {
      falsch.push(`--${b.token} gibt es im Design "${b.design}" nicht: ${b.zeile}`);
      continue;
    }
    if (web !== b.wert) falsch.push(`${b.zeile}  →  --${b.token} ist ${web}, hier steht ${b.wert}`);
  }
  assert.deepEqual(
    falsch,
    [],
    'Diese Zeilen in Theme.kt behaupten eine Herkunft, die nicht stimmt:\n  ' +
      falsch.join('\n  ') +
      '\nEntweder ist der Wert falsch abgeschrieben, oder der Kommentar nennt das ' +
      'falsche Token. Ein Kommentar, der seinem Wert widerspricht, ist schlimmer ' +
      'als keiner.',
  );
});

// Der Bau (`npm run build`) ruft den Erzeuger auf; in einem Checkout ohne
// Android-App (Docker-Bau, Teil-Klon) darf er daran nicht scheitern.
// Gegenprobe (02.11.2026 gemessen): die Ordnerprüfung im Erzeuger entfernt →
// rot (ENOENT beim Schreiben von DesignTokens.kt, Exit 1).
test('ohne Android-App schreibt der Erzeuger nur das Web-CSS', () => {
  const { spawnSync } = require('node:child_process');
  const os = require('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tokens-'));
  try {
    fs.mkdirSync(path.join(tmp, 'shared'));
    fs.mkdirSync(path.join(tmp, 'Web-App', 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'Web-App', 'public'));
    fs.copyFileSync(QUELLE, path.join(tmp, 'shared', 'design-tokens.json'));
    const skript = path.join(tmp, 'Web-App', 'scripts', 'generate-design-tokens.js');
    fs.copyFileSync(path.join(__dirname, '..', 'scripts', 'generate-design-tokens.js'), skript);
    const r = spawnSync(process.execPath, [skript], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.readFileSync(path.join(tmp, 'Web-App', 'public', 'tokens.css'), 'utf8'), baueCss(DATEN));
    assert.deepEqual(fs.readdirSync(tmp).sort(), ['Web-App', 'shared'], 'der Erzeuger legt den Android-Ordner an');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
