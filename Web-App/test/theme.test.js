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
  const brick = fs.readFileSync(path.join(PUB, 'themes', 'brick.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  const grab = (re, what) => {
    const m = brick.match(re);
    assert.ok(m, `${what} nicht gefunden`);
    return m[1].toLowerCase();
  };
  assert.equal(grab(/--chart-new:(#[0-9a-f]{6})/i, '--chart-new'),
               grab(/\.cond-new\{background:#[0-9a-f]{6};color:(#[0-9a-f]{6})\}/i, '.cond-new'),
               'Neu-Linie und Neu-Plakette müssen dieselbe Farbe haben');
  assert.equal(grab(/--chart-used:(#[0-9a-f]{6})/i, '--chart-used'),
               grab(/\.cond-used\{background:#[0-9a-f]{6};color:(#[0-9a-f]{6})\}/i, '.cond-used'),
               'Gebraucht-Linie und Gebraucht-Plakette müssen dieselbe Farbe haben');

  // Das Standard-Design behält Blau/Bernstein — das Paar bleibt auch bei
  // Rot-Grün-Sehschwäche unterscheidbar, weil es auf der anderen Farbachse liegt.
  const base = fs.readFileSync(path.join(PUB, 'styles.css'), 'utf8');
  assert.match(base, /--chart-new:#2563eb;--chart-used:#d97706;/,
    'Die Vorgabewerte für die Diagrammfarben fehlen');
});
