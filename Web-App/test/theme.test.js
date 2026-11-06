/**
 * Das global eingestellte Design (global_settings.app_theme) muss auch VOR dem
 * Login gelten — auf Login- und Startup-Screen.
 * Ausführlich: docs/begruendungen/test/theme.test.js.md#kopf
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
const settings = fs.readFileSync(path.join(ROOT, 'routes/api_v1/settings.ts'), 'utf8');
const styles = fs.readFileSync(path.join(PUB, 'styles.css'), 'utf8');

test('GET /api/settings/theme ist ohne Login erreichbar', () => {
  const route = settings.indexOf("router.get('/settings/theme'");
  // Auf den Zeilenanfang ankern: der Erklärkommentar über der Route erwähnt
  // router.use(requireLogin) ebenfalls, ein blosses indexOf träfe den Kommentar.
  const gate = settings.search(/^router\.use\('\/settings', requireLogin\);/m);
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

  // Vor Start-, Anmelde- und App-Markup; davor steht nur das neutrale Startgerüst.
  const vorher = html.slice(0, html.indexOf('id="startup-screen"'));
  assert.match(vorher, /<script src="\/js\/00-theme-boot\.js/,
    'Das Boot-Skript muss vor Anmeldung und App geladen werden, sonst blitzt das falsche Design auf');

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
  // Warum das eine eigene Pruefung ist
  // Ausführlich: docs/begruendungen/test/theme.test.js.md#alsdatei
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
  const server = liste(fs.readFileSync(path.join(__dirname, '..', 'src/infra/vertrag/globaleRegeln.ts'), 'utf8'),
    /const DESIGNS: readonly string\[\] = \[([^\]]*)\]/, 'src/infra/vertrag/globaleRegeln.ts');
  const app = liste(fs.readFileSync(path.join(__dirname, '..', '..', 'Android-App', 'core-data', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'data', 'GeraeteAblage.kt'), 'utf8'),
    /ERLAUBTE_DESIGNS = setOf\(([^)]*)\)/, 'GeraeteAblage.kt');

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
  const render = fs.readFileSync(path.join(ROOT, 'src/konto/indexHtml.ts'), 'utf8');
  assert.match(render, /data-theme="\$\{theme\}"/,
    'renderIndexHtml() muss das Attribut in das <html>-Tag schreiben');
  assert.match(render, /invalidateTheme/,
    'Ohne Invalidierung liefert der Server nach einem Design-Wechsel das alte Design aus');
  assert.match(render, /THEME_TTL_MS/,
    'Der Cache ist prozesslokal; ohne Ablauf ziehen die übrigen Cluster-Worker nie nach');

  const server = require('./helpers/sources').serverAll();
  // Auf den Zeilenanfang ankern: der Erklärkommentar darüber erwähnt den
  // Catch-all ebenfalls, ein blosses indexOf träfe den Kommentar.
  //
  // Seit Express 5 (05.10.) heisst das Muster '/{*splat}' und nicht mehr '*'.
  // Die geschweiften Klammern sind nicht Geschmack: Ohne sie trifft die Regel
  // die nackte Wurzel '/' nicht mehr — gemessen gegen express 5.2.1.
  const at = server.search(/^\s*app\.get\('\/\{\*splat\}'/m);
  assert.ok(at > 0, "SPA-Catch-all nicht gefunden");
  const catchAll = server.slice(at, at + 700);
  // Argument zugelassen: renderIndexHtml() bekommt seit der Aufteilung der
  // Übersetzungen die userId mit, um die passende Sprachdatei einzuhängen
  // (siehe src/konto/indexHtml.ts). Geprüft wird weiterhin, DASS der Catch-all das
  // gerenderte HTML ausliefert — nicht, mit welchen Argumenten.
  // Der Catch-all ruft sendeStartseite() (src/konto/indexHtml.ts): rendern, im Fehlerfall die Datei.
  assert.match(catchAll, /sendeStartseite\(/, 'Der SPA-Catch-all muss das gerenderte HTML ausliefern');
  const start = render.slice(render.indexOf('function sendeStartseite('));
  assert.match(start.slice(0, 600), /renderIndexHtml\([^)]*\)/,
    'Der SPA-Catch-all muss das gerenderte HTML ausliefern');
  assert.match(start.slice(0, 600), /sendFile/,
    'Bei einem Renderfehler muss die Datei unverändert ausgeliefert werden');

  const settings = fs.readFileSync(path.join(ROOT, 'routes/api_v1/settings.ts'), 'utf8');
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
  // Warum das festgehalten wird
  // Ausführlich: docs/begruendungen/test/theme.test.js.md#tokens
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
  // Der Fehler, den diese Regel verhindert
  // Ausführlich: docs/begruendungen/test/theme.test.js.md#designs
  const DESIGNS = ['classic', ...fs.readdirSync(path.join(PUB, 'themes'))
    .filter(f => f.endsWith('.css')).map(f => path.basename(f, '.css'))];
  assert.ok(DESIGNS.length >= 3, `Nur ${DESIGNS.length} Designs — greift die Suche noch?`);

  const ordner = path.join(PUB, 'js');
  const dateien = fs.readdirSync(ordner)
    .filter(n => n.endsWith('.js') && n !== 'app.bundle.js' && n !== '00-theme-boot.js');
  assert.ok(dateien.length >= 10, `Nur ${dateien.length} Skripte — greift die Suche noch?`);

  // Kommentare zuerst weg: Die Begruendung oben nennt die Designs im
  // Fliesstext, und die Erklaerung in 01-konto.js ebenso. Ohne diesen Schritt
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
 * Ein Design, dessen Reiterleiste umbrechen darf, verschmälert die Reiter
 * UNBEDINGT — nicht hinter einer Medienabfrage.
 * Ausführlich: docs/begruendungen/test/theme.test.js.md#wer-die-reiterleiste-umbrechen-laesst-ve
 *
 * ── Gegenprobe (durchgeführt, Ergebnis im Commit) ──────────────────────────
 *   Die zwei Zeilen in themes/brick.css wieder in @media gepackt → rot.
 */
test('wer die Reiterleiste umbrechen lässt, verschmälert sie unbedingt', () => {
  const ordner = path.join(PUB, 'themes');
  const dateien = fs.readdirSync(ordner).filter(f => f.endsWith('.css'));
  assert.ok(dateien.length >= 4, `Nur ${dateien.length} Designs — greift die Suche noch?`);

  const fehler = [];
  let betroffen = 0;
  for (const name of dateien) {
    const css = fs.readFileSync(path.join(ordner, name), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    // Nur Designs, die BEIDES tun: umbrechen lassen und den Inhalt deckeln.
    if (!/nav\s*\{[^}]*flex-wrap\s*:\s*wrap/.test(css)) continue;
    if (!/#app\s*\{[^}]*max-width/.test(css)) continue;
    betroffen++;

    // Jeder @media-Block, der die Reiter-Polsterung setzt, ist der Fehler.
    for (const m of css.matchAll(/@media[^{]+\{([\s\S]*?)\n\}/g)) {
      if (/\.ntab\s*\{[^}]*padding/.test(m[1])) {
        fehler.push(`${name}: ${m[0].slice(0, m[0].indexOf('{')).trim()}`);
      }
    }
  }
  assert.ok(betroffen >= 1,
    'Kein Design lässt die Reiterleiste umbrechen UND deckelt den Inhalt — ' +
    'dann ist diese Regel leer wahr');
  assert.deepEqual(fehler, [],
    'Hier hängt die Breite der Reiter an der FENSTERbreite, obwohl sie in ' +
    'einem gedeckelten Behälter stehen. Auf einem breiten Bildschirm greift ' +
    'die Abfrage nicht — und genau dort brach die Leiste um.');
});
