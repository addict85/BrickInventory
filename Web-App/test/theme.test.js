/**
 * Das global eingestellte Design (global_settings.app_theme) muss auch VOR dem
 * Login gelten — auf Login- und Startup-Screen.
 *
 * Es waren drei unabhängige Ursachen, jede für sich ausreichend, um den
 * Login-Screen im Standarddesign zu lassen:
 *
 *   1. GET /api/settings/theme lag hinter router.use(requireLogin) — der Wert
 *      war vor dem Login gar nicht abrufbar (der Kommentar an der Route sagte
 *      schon immer „von allen Nutzern lesbar").
 *   2. applyTheme() wurde nur aus showApp() aufgerufen, also erst NACH
 *      erfolgreichem Login.
 *   3. #login-screen und #startup-screen hatten background:#fff hartkodiert —
 *      der Startup-Screen sogar als Inline-Style, der jede Stylesheet-Regel
 *      überstimmt.
 *
 * Der Test prüft alle drei, ohne DB und ohne Browser. Ausführen: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
const settings = fs.readFileSync(path.join(ROOT, 'routes', 'settings.ts'), 'utf8');
const styles = fs.readFileSync(path.join(PUB, 'styles.css'), 'utf8');

test('GET /api/settings/theme ist ohne Login erreichbar', () => {
  const route = settings.indexOf("router.get('/theme'");
  // Auf den Zeilenanfang ankern: der Erklärkommentar über der Route erwähnt
  // router.use(requireLogin) ebenfalls, ein blosses indexOf träfe den Kommentar.
  const gate = settings.search(/^router\.use\(requireLogin\);/m);
  assert.ok(route > 0, '/theme-Route nicht gefunden');
  assert.ok(gate > 0, 'requireLogin-Gate nicht gefunden');
  assert.ok(
    route < gate,
    'router.get(\'/theme\') muss VOR router.use(requireLogin) stehen — sonst kann der ' +
    'Login-Screen das global eingestellte Design nicht laden'
  );
});

test('Theme wird vor dem ersten Paint gesetzt', () => {
  const boot = path.join(PUB, 'js', '00-theme-boot.js');
  assert.ok(fs.existsSync(boot), 'js/00-theme-boot.js fehlt');

  const head = html.slice(0, html.indexOf('</head>'));
  assert.match(head, /00-theme-boot\.js/,
    'Das Boot-Skript muss im <head> geladen werden, sonst blitzt das falsche Design auf');

  const src = fs.readFileSync(boot, 'utf8');
  assert.match(src, /setAttribute\(\s*'data-theme'/, 'Boot-Skript setzt kein data-theme');
  // Die Adresse ist mit dem Zusammenlegen der API-Oberflaechen umgezogen:
  // /api/settings/theme -> /api/v1/settings/theme. Geprueft wird der Pfad und
  // nicht nur das Wort "theme", weil genau dieser Aufruf VOR dem ersten Paint
  // laeuft — eine falsche Adresse waere hier ein 404 und ein Aufblitzen des
  // falschen Designs, ohne Fehlermeldung.
  assert.match(src, /\/api\/v1\/settings\/theme/, 'Boot-Skript gleicht nicht gegen den Server ab');
  assert.match(src, /localStorage/, 'Ohne Cache blitzt beim Laden das vorige Design auf');
});

test('applyTheme läuft über den Boot-Helfer (Cache bleibt aktuell)', () => {
  const core = require('./helpers/sources').coreQuelle();
  assert.match(core, /__bimApplyTheme/,
    'applyTheme() muss an js/00-theme-boot.js durchreichen, sonst läuft der ' +
    'localStorage-Cache nach einem Design-Wechsel des Admins aus dem Ruder');
});

test('Login- und Startup-Screen haben keinen hartkodierten Hintergrund', () => {
  for (const id of ['#startup-screen', '#login-screen']) {
    const rule = styles.slice(styles.indexOf(id), styles.indexOf('}', styles.indexOf(id)));
    assert.doesNotMatch(rule, /background:\s*#/,
      `${id} darf keinen festen Hintergrund haben — sonst kommt kein Theme daran vorbei`);
    assert.match(rule, /background:\s*var\(--screen-bg\)/,
      `${id} muss var(--screen-bg) verwenden`);
  }
  assert.match(styles, /--screen-bg:/, '--screen-bg ist in :root nicht definiert');
});

test('Startup-Screen setzt keine Farben mehr per Inline-Style', () => {
  const start = html.indexOf('id="startup-screen"');
  const block = html.slice(start, html.indexOf('id="login-screen"'));
  // Der LEGO-Stein im Logo ist markenfarben und bleibt hartkodiert; alles
  // andere muss über die Design-Variablen laufen.
  const inlineColours = [...block.matchAll(/style="[^"]*?(?:background|color):\s*(#[0-9a-fA-F]{6})/g)]
    .map(m => m[1]);
  assert.deepEqual(inlineColours, [],
    `Inline-Styles überstimmen jede Theme-Regel: ${inlineColours.join(', ')}`);
});

test('fuenf Listen nennen dieselben Designs', () => {
  // ── Warum das eine eigene Pruefung ist ──────────────────────────────────
  //
  // Ein Design steht an FUENF Stellen: als Datei unter public/themes/, als
  // <link> in index.html, in der Whitelist des Servers, in ALLOWED des
  // Boot-Skripts und in der App (PreferencesManager.ERLAUBTE_DESIGNS). Fehlt
  // es an einer davon, faellt das nicht auf, sondern wirkt teilweise: Der
  // Admin kann es waehlen, der Server nimmt es an, und das Boot-Skript
  // verwirft es beim naechsten Start stillschweigend — genau die Sorte
  // Fehler, die man erst im Betrieb sieht.
  //
  // ── Die fuenfte Liste kam dazu, nachdem sie gefehlt hat ─────────────────
  //
  // "noppe" und "hochglanz" wurden ausgeliefert, ohne dass index.html ihre
  // Stylesheets lud. Diese Pruefung war damals gruen: Die Datei lag da, die
  // drei Listen nannten das Design, und der Server lieferte es aus. Im
  // Browser kamen dann NUR die Farben an — die stehen in tokens.css, EINER
  // Datei fuer alle Designs — und keine einzige Struktur. Das Design sah
  // aus wie das Grunddesign mit roten Knoepfen.
  //
  // Der <link> ist damit die fuenfte Stelle, und sie ist die einzige, an der
  // ein Fehlen nicht zum Verwerfen fuehrt, sondern zu einer halben Anzeige.
  const alsDatei = fs.readdirSync(path.join(PUB, 'themes'))
    .filter(f => f.endsWith('.css')).map(f => path.basename(f, '.css')).sort();
  // "classic" hat keine eigene Datei: Es IST das Grunddesign in styles.css.
  const erwartet = ['classic', ...alsDatei].sort();
  assert.ok(alsDatei.length >= 2, `Nur ${alsDatei.length} Design-Datei(en) — greift die Suche noch?`);

  const liste = (src, re, wo) => {
    const m = src.match(re);
    assert.ok(m, `${wo}: die Liste der Designs ist nicht mehr zu finden`);
    return [...m[1].matchAll(/['"]([a-z]+)['"]/g)].map(x => x[1]).sort();
  };
  // Die <link>-Zeilen in index.html. Nicht ueber `liste()`: Dort steht der
  // Dateiname, nicht der Designname in Anfuehrungszeichen.
  const verlinkt = [...html.matchAll(/<link[^>]+href="\/themes\/([a-z]+)\.css/g)]
    .map(m => m[1]).sort();
  assert.deepEqual(verlinkt, alsDatei,
    'index.html laedt nicht genau die Stylesheets, die unter public/themes/ liegen. ' +
    'Fehlt eines, kommen im Browser nur die Farben aus tokens.css an und keine ' +
    'einzige Struktur — das Design sieht dann aus wie das Grunddesign mit anderer ' +
    'Akzentfarbe.');

  const boot = liste(fs.readFileSync(path.join(PUB, 'js', '00-theme-boot.js'), 'utf8'),
    /var ALLOWED = \[([^\]]*)\]/, 'js/00-theme-boot.js');
  const server = liste(fs.readFileSync(path.join(__dirname, '..', 'routes', 'settings.ts'), 'utf8'),
    /if \(!\[([^\]]*)\]\.includes\(theme\)\)/, 'routes/settings.ts');
  const app = liste(fs.readFileSync(path.join(__dirname, '..', '..', 'Android-App', 'app', 'src',
    'main', 'java', 'ch', 'brickinventoryapp', 'data', 'PreferencesManager.kt'), 'utf8'),
    /ERLAUBTE_DESIGNS = setOf\(([^)]*)\)/, 'PreferencesManager.kt');

  assert.deepEqual(boot, erwartet, 'ALLOWED im Boot-Skript weicht von den Dateien ab');
  assert.deepEqual(server, erwartet, 'Die Whitelist des Servers weicht von den Dateien ab');
  assert.deepEqual(app, erwartet, 'ERLAUBTE_DESIGNS der App weicht von den Dateien ab');
});

test('jedes Theme unter public/themes/ deckt die Screens vor dem Login ab', () => {
  const dir = path.join(PUB, 'themes');
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.css'))) {
    const css = fs.readFileSync(path.join(dir, f), 'utf8');
    const name = path.basename(f, '.css');
    assert.match(css, new RegExp(`\\[data-theme="${name}"\\][^{]*#login-screen`),
      `${f} stylt den Login-Screen nicht — das Design würde nach dem Login umspringen`);
    assert.match(css, new RegExp(`--screen-bg\\s*:`),
      `${f} setzt --screen-bg nicht`);
  }
});

test('der Server setzt data-theme selbst — kein Sprung beim ersten Aufruf', () => {
  const render = fs.readFileSync(path.join(ROOT, 'utils', 'indexHtml.ts'), 'utf8');
  assert.match(render, /data-theme="\$\{theme\}"/,
    'renderIndexHtml() muss das Attribut in das <html>-Tag schreiben');
  assert.match(render, /invalidateTheme/,
    'Ohne Invalidierung liefert der Server nach einem Design-Wechsel das alte Design aus');
  assert.match(render, /THEME_TTL_MS/,
    'Der Cache ist prozesslokal; ohne Ablauf ziehen die übrigen Cluster-Worker nie nach');

  const server = require('./helpers/sources').serverAll();
  // Auf den Zeilenanfang ankern: der Erklärkommentar darüber erwähnt
  // app.get('*') ebenfalls, ein blosses indexOf träfe den Kommentar.
  const at = server.search(/^app\.get\('\*'/m);
  assert.ok(at > 0, "SPA-Catch-all nicht gefunden");
  const catchAll = server.slice(at, at + 700);
  // Argument zugelassen: renderIndexHtml() bekommt seit der Aufteilung der
  // Übersetzungen die userId mit, um die passende Sprachdatei einzuhängen
  // (siehe utils/indexHtml.ts). Geprüft wird weiterhin, DASS der Catch-all das
  // gerenderte HTML ausliefert — nicht, mit welchen Argumenten.
  assert.match(catchAll, /renderIndexHtml\([^)]*\)/,
    'Der SPA-Catch-all muss das gerenderte HTML ausliefern');
  assert.match(catchAll, /sendFile/,
    'Bei einem Renderfehler muss die Datei unverändert ausgeliefert werden');

  const settings = fs.readFileSync(path.join(ROOT, 'routes', 'settings.ts'), 'utf8');
  assert.match(settings, /invalidateTheme\(\)/,
    'Das Speichern eines Designs muss den Server-Cache verwerfen');
});

test('das Boot-Skript vertraut einem servergesetzten Wert', () => {
  const boot = fs.readFileSync(path.join(ROOT, 'public', 'js', '00-theme-boot.js'), 'utf8');
  assert.match(boot, /getAttribute\('data-theme'\)/,
    'Das Skript muss erkennen, ob der Server den Wert schon gesetzt hat');
  // Der frühe return ist der Punkt: kein erneutes Anwenden und kein
  // /api/settings/theme-Aufruf, wenn der Wert bereits im HTML steht.
  const guard = boot.slice(boot.indexOf('var served'), boot.indexOf('var cached'));
  assert.match(guard, /return;/,
    'Steht der Wert schon im HTML, darf weder neu angewendet noch abgeglichen werden');
});

test('die Diagrammfarben stimmen mit den Zustands-Plaketten überein', () => {
  // ── Warum das festgehalten wird ──────────────────────────────────────────
  // Salbeigrün steht im Stein-Design überall für „Neu", Sand für „Gebraucht"
  // (.cond-new / .cond-used). Tragen die Diagrammlinien dieselben Farben, muss
  // niemand die Legende lesen — die Zuordnung ist schon gelernt.
  //
  // Läuft eines von beiden künftig auseinander, ist die Wiedererkennung
  // stillschweigend weg: Das Diagramm sieht weiterhin richtig aus, führt aber
  // in die Irre.
  //
  // Kommentare werden entfernt: Der Erklärtext daneben nennt die frühere Farbe
  // (#3d5a80), und ein einfacher Regex-Treffer landete zuerst dort.
  // ── Zwei Dateien, seit die Tokens erzeugt werden ────────────────────────
  // Die WERTE (--chart-new/--chart-used) stehen seit dem Zusammenlegen in
  // public/tokens.css, erzeugt aus shared/design-tokens.json, damit die
  // Android-App dieselben fuehrt. Die PLAKETTEN (.cond-new/.cond-used) sind
  // reine Web-Gestaltung und blieben in themes/brick.css.
  //
  // Die Regel ueberspannt damit beide Dateien — und das ist ihr Punkt: Sie
  // haelt Wert und Plakette zusammen, ganz gleich, wo beide wohnen.
  // Nur der STEIN-Block von tokens.css: Die Datei fuehrt beide Designs
  // untereinander, und ein blosses match() nimmt den ersten Treffer — das
  // waere der klassische Wert, waehrend die Plakette daneben die des
  // Stein-Designs ist. Genau so ist diese Pruefung beim Umbau einmal
  // fehlgeschlagen, und zwar mit der richtigen Meldung.
  const tokens = fs.readFileSync(path.join(PUB, 'tokens.css'), 'utf8');
  const steinTeil = tokens.slice(tokens.indexOf('[data-theme="brick"]'));
  assert.ok(steinTeil, 'tokens.css fuehrt kein Stein-Design mehr');
  const brick = [
    steinTeil,
    fs.readFileSync(path.join(PUB, 'themes', 'brick.css'), 'utf8'),
  ].join('\n').replace(/\/\*[\s\S]*?\*\//g, '');

  const grab = (re, what) => {
    const m = brick.match(re);
    assert.ok(m, `${what} nicht gefunden`);
    return m[1].toLowerCase();
  };
  assert.equal(grab(/--chart-new:\s*(#[0-9a-f]{6})/i, '--chart-new'),
               grab(/\.cond-new\{background:#[0-9a-f]{6};color:(#[0-9a-f]{6})\}/i, '.cond-new'),
               'Neu-Linie und Neu-Plakette müssen dieselbe Farbe haben');
  assert.equal(grab(/--chart-used:\s*(#[0-9a-f]{6})/i, '--chart-used'),
               grab(/\.cond-used\{background:#[0-9a-f]{6};color:(#[0-9a-f]{6})\}/i, '.cond-used'),
               'Gebraucht-Linie und Gebraucht-Plakette müssen dieselbe Farbe haben');

  // Das Standard-Design behält Blau/Bernstein — das Paar bleibt auch bei
  // Rot-Grün-Sehschwäche unterscheidbar, weil es auf der anderen Farbachse liegt.
  const base = fs.readFileSync(path.join(PUB, 'tokens.css'), 'utf8').split('[data-theme=')[0];
  assert.match(base, /--chart-new:\s*#2563eb;/,
    'Der Vorgabewert der Neu-Linie fehlt');
  assert.match(base, /--chart-used:\s*#d97706;/,
    'Der Vorgabewert der Gebraucht-Linie fehlt');
});

test('nur das Boot-Skript kennt die Liste der Designs', () => {
  // ── Der Fehler, den diese Regel verhindert (Nachtrag 168) ────────────────
  //
  // Marco: „Teilweise (nicht bei allen Designs) muss beim Aendern die Seite
  // neu geladen werden."
  //
  // js/01-core.js fuehrte in applyTheme() eine ZWEITE Liste:
  //
  //     if (theme !== 'brick' && theme !== 'classic') return null;
  //
  // geschrieben, als es zwei Designs gab. Inzwischen sind es sechs. Die vier
  // neueren wurden dort abgewiesen, BEVOR der Aufruf das Boot-Skript
  // erreichte — sie wirkten erst beim naechsten Seitenaufruf.
  //
  // Die Pruefung „applyTheme laeuft ueber den Boot-Helfer" daneben war die
  // ganze Zeit gruen: Sie sieht nach, ob `__bimApplyTheme` im Quelltext
  // VORKOMMT, nicht ob der Aufruf dort ankommt. Zwischen Erwaehnung und
  // Erreichbarkeit lag ein `return null`.
  //
  // Deshalb hier die Regel dahinter: Die Liste steht an genau einer Stelle.
  // Die Designs aus den Dateien ableiten, nicht aufzaehlen — sonst haette
  // diese Regel selbst die Liste, gegen die sie gebaut ist.
  const DESIGNS = ['classic', ...fs.readdirSync(path.join(PUB, 'themes'))
    .filter(f => f.endsWith('.css')).map(f => path.basename(f, '.css'))];
  assert.ok(DESIGNS.length >= 3, `Nur ${DESIGNS.length} Designs — greift die Suche noch?`);

  const ordner = path.join(PUB, 'js');
  const dateien = fs.readdirSync(ordner)
    .filter(n => n.endsWith('.js') && n !== 'app.bundle.js' && n !== '00-theme-boot.js');
  assert.ok(dateien.length >= 10, `Nur ${dateien.length} Skripte — greift die Suche noch?`);

  // Kommentare zuerst weg: Die Begruendung oben nennt die Designs im
  // Fliesstext, und die Erklaerung in 01-core.js ebenso. Ohne diesen Schritt
  // meldete die Regel genau den Text, der sie erklaert.
  const ohneKommentare = js => js
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(z => !/^\s*\/\//.test(z)).join('\n');

  const treffer = [];
  for (const name of dateien) {
    const code = ohneKommentare(fs.readFileSync(path.join(ordner, name), 'utf8'));
    const genannt = new Set(DESIGNS.filter(d => new RegExp(`['"\`]${d}['"\`]`).test(code)));
    if (genannt.size >= 2) treffer.push(`${name}: ${[...genannt].sort().join(', ')}`);
  }
  assert.deepEqual(treffer, [],
    'Diese Dateien fuehren eine eigene Liste der Designs. Es gibt genau eine, ' +
    'in js/00-theme-boot.js — jede weitere waechst beim naechsten Design nicht ' +
    'mit, und der Wechsel wirkt dann erst nach einem Neuladen.');
});

/**
 * Ein Design, dessen Reiterleiste UMBRECHEN darf, muss die Reiter auch
 * schmaler machen koennen.
 *
 * ── Marcos Befund ───────────────────────────────────────────────────────────
 *
 * „Monitoring sollte auf der gleichen Zeile sein wie die restlichen Tabs."
 *
 * Die Reiterleiste steht normalerweise in EINER Zeile und scrollt seitlich
 * (styles.css: nav{display:flex;overflow-x:auto}, kein flex-wrap). Genau ein
 * Design setzt flex-wrap und laesst sie stattdessen umbrechen — und dort
 * rutschte der neunte Reiter, den nur ein Verwalter sieht, in eine zweite
 * Zeile. Im Browser gemessen (Chromium): 1144px noetig, 1030px da.
 *
 * Die Regel ist nicht „Design X braucht Regel Y" (das waere eine Aufzaehlung),
 * sondern: WER umbrechen laesst, muss fuer mittlere Fenster verschmaelern.
 * Sonst faellt es beim naechsten Design wieder auf.
 *
 * ── Gegenprobe (durchgefuehrt, Ergebnis im Commit) ─────────────────────────
 *   Den @media-Block in themes/brick.css entfernt → rot.
 */
test('wer die Reiterleiste umbrechen laesst, verschmaelert sie auch', () => {
  const ordner = path.join(PUB, 'themes');
  const dateien = fs.readdirSync(ordner).filter(f => f.endsWith('.css'));
  assert.ok(dateien.length >= 4, `Nur ${dateien.length} Designs — greift die Suche noch?`);

  const ohneUmbau = [];
  let mitUmbruch = 0;
  for (const name of dateien) {
    const css = fs.readFileSync(path.join(ordner, name), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    // nav-Regelblock mit flex-wrap: nur dort stellt sich die Frage.
    if (!/nav\s*\{[^}]*flex-wrap\s*:\s*wrap/.test(css)) continue;
    mitUmbruch++;
    // Und dann muss es einen Medienblock geben, der die Reiter kleiner macht.
    const schmal = /@media[^{]+\{[\s\S]*?\.ntab\s*\{[^}]*padding[^}]*\}/.test(css);
    if (!schmal) ohneUmbau.push(name);
  }
  assert.ok(mitUmbruch >= 1,
    'Kein Design laesst die Reiterleiste mehr umbrechen — dann ist diese Regel leer wahr');
  assert.deepEqual(ohneUmbau, [],
    'Diese Designs lassen die Reiterleiste umbrechen, ohne die Reiter fuer ' +
    'mittlere Fenster zu verschmaelern. Genau daran ist Monitoring in eine ' +
    'zweite Zeile gerutscht.');
});
