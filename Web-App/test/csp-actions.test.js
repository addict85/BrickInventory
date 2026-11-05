/**
 * Inline-Handler entfernen, damit `script-src 'unsafe-inline'` aus der CSP
 * verschwinden kann (Punkt 2 der Optimierungsliste).
 * Ausführlich: docs/begruendungen/test/csp-actions.test.js.md#kopf
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUB  = path.join(__dirname, '..', 'public');
const HTML = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
const ACT  = fs.readFileSync(path.join(PUB, 'js', '11-actions.js'), 'utf8');
const JS_FILES = fs.readdirSync(path.join(PUB, 'js')).filter(f => /^\d\d-.*\.js$/.test(f));

const HANDLER_RE = /\bon(click|change|input|blur|keydown|error|load|mouseenter|mouseleave|submit)\s*=\s*"/g;

test('nirgends mehr Inline-Handler — weder in index.html noch in den Templates', () => {
  // Wichtig: (?<!data-) schliesst data-onerror aus, und das Muster verlangt ="
  // — el.onclick = fn in JavaScript ist CSP-konform und darf bleiben.
  const RE = /(?<!data-)\bon(click|change|input|blur|keydown|error|load|submit|mouseenter|mouseleave)=\\?"/g;
  // Kommentare entfernen: Die Dokumentation in 11-actions.js zitiert die alten
  // Handler ("War: onclick=…") und würde die Prüfung sonst selbst auslösen.
  const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');
  const found = [];
  for (const [name, src] of [['index.html', HTML],
       ...JS_FILES.concat(['11-actions.js']).map(f => [f, fs.readFileSync(path.join(PUB, 'js', f), 'utf8')])]) {
    for (const m of strip(src).matchAll(RE)) found.push(`${name}: ${m[0]}`);
  }
  assert.deepEqual(found, [],
    `Noch ${found.length} Inline-Handler — mit denen wäre die geschlossene CSP ein Ausfall`);
});

test("die CSP erlaubt kein 'unsafe-inline' für script-src mehr", () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.ts'), 'utf8');
  const line = server.split('\n').find(l => l.includes('script-src') && !l.trim().startsWith('//'));
  assert.ok(line, 'script-src-Direktive nicht gefunden');
  assert.doesNotMatch(line, /unsafe-inline/,
    'Ohne das Schliessen der CSP hat die ganze Umstellung keinen Sicherheitsgewinn');
  assert.doesNotMatch(line, /unsafe-eval/, "'unsafe-eval' wäre dasselbe Problem in Grün");
});

test('kein style-Attribut und kein <style> im Markup — ausser dem Startgerüst, das die CSP per Hash erlaubt', () => {
  // Gegenprobe: ein data-stil in index.html wieder als style= → rot.
  const strip = t => t.replace(/<!--[\s\S]*?-->/g, '').replace(/<style id="startstil">[\s\S]*?<\/style>/, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');
  const found = [];
  for (const [name, src] of [['index.html', HTML], ['logviewer.js', fs.readFileSync(path.join(PUB, 'js', 'logviewer.js'), 'utf8')],
       ...JS_FILES.map(f => [f, fs.readFileSync(path.join(PUB, 'js', f), 'utf8')])]) {
    for (const m of strip(src).matchAll(/(?<![-\w])style=\\?["']|<style[\s>]/g)) found.push(`${name}: ${m[0]}`);
    // Ein Wert mit ${…} steht nicht auf der Freigabeliste und bliebe wirkungslos;
    // nur die Bausteine reichen den stil-Parameter ihres Aufrufers weiter.
    for (const m of src.matchAll(/data-stil="([^"]*\$\{[^"]*)"/g))
      if (!/^\$\{(esc\()?o\.(stil|zeilenStil|wertStil)\)?\}$/.test(m[1])) found.push(`${name}: data-stil="${m[1]}"`);
  }
  assert.deepEqual(found, []);
});

test('img-src erlaubt keine fremden Hosts mehr', () => {  // ── Woher dieser Test kommt ─────────────────────────────────────────────
  // img-src trug ein pauschales `https:` mit der Begründung, Set-Bilder kämen
  // direkt von den CDNs. Seit hardened-69 stimmt das nicht mehr: imgUrl()
  // schickt jede absolute Adresse durch /api/img-proxy, und alle Bilder
  // verlangen Anmeldung. Die Erlaubnis blieb nur stehen — und ein …
  // Ausführlich: docs/begruendungen/test/csp-actions.test.js.md#server
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.ts'), 'utf8');
  const line = server.split('\n').find(l => l.includes('"img-src') && !l.trim().startsWith('//'));
  assert.ok(line, 'img-src-Direktive nicht gefunden');
  assert.doesNotMatch(line, /https:/,
    'Bilder laufen ausschliesslich über den eigenen Server (/api/img-proxy, /images/*)');
});

test('der Dispatcher kommt ohne eval aus', () => {
  // Kommentare weg: Der Erklärtext nennt "kein eval, kein new Function" und
  // würde die Prüfung sonst selbst auslösen.
  const code = ACT.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /\beval\s*\(|new Function/,
    "Ein eval() würde 'unsafe-eval' verlangen und damit dasselbe Problem erzeugen");
  // Die typeof-Prüfung ist mit der Registry nach js/00-registry.js gewandert
  // (resolveAction) — der Dispatcher ruft sie nur noch auf.
  const REG = fs.readFileSync(path.join(PUB, 'js', '00-registry.js'), 'utf8');
  assert.match(REG, /typeof fn === 'function'/, 'Der Name muss aufgelöst und geprüft werden');
  assert.match(ACT, /console\.warn\('\[actions\] unbekannter Handler:'/,
    'Ein Tippfehler im Handlernamen muss auffallen, nicht stumm nichts tun');
});

test('jeder in index.html referenzierte Handler existiert', () => {
  const names = new Set();
  for (const m of HTML.matchAll(/data-(?:click|change|input|blur|keydown)="([^"]+)"/g)) names.add(m[1]);
  assert.ok(names.size > 0, 'keine data-Handler gefunden — wurde überhaupt konvertiert?');

  const all = JS_FILES.map(f => fs.readFileSync(path.join(PUB, 'js', f), 'utf8')).join('\n');
  const missing = [...names].filter(n =>
    !new RegExp(`function\\s+${n}\\s*\\(|(?:const|let|var)\\s+${n}\\s*=|window\\.${n}\\s*=`).test(all));
  assert.deepEqual(missing, [],
    `Diese Handler werden referenziert, sind aber nirgends definiert: ${missing.join(', ')}`);
});

test('Bildfehler laufen über den Capture-Handler', () => {
  // error und load steigen nicht auf — ohne capture:true bliebe der Fallback aus.
  assert.match(ACT, /addEventListener\('error',[\s\S]*?\}, true\)/,
    'error braucht die Capture-Phase');
  assert.match(ACT, /el\.dataset\.fallbackDone/,
    'Ohne Merker kann der Fallback in eine Schleife laufen, wenn auch das Ersatzbild fehlt');
});

test('Hover-Effekte liegen im Stylesheet', () => {
  const css = fs.readFileSync(path.join(PUB, 'styles.css'), 'utf8');
  assert.match(css, /\.hover-row:hover/,
    'Die früheren onmouseenter/onmouseleave-Attribute brauchen eine CSS-Entsprechung');
});

test('der Dispatcher ist eingebunden', () => {
  // 11-actions.js hat kein eigenes <script>-Tag mehr — es steckt im gebündelten
  // js/app.bundle.js. Ohne den Dispatcher wäre die App unbedienbar (alle
  // Interaktionen laufen seit der CSP-Umstellung über data-click/data-change),
  // deshalb wird geprüft, dass er Teil des Bündels IST und dass das Bündel …
  // Ausführlich: docs/begruendungen/test/csp-actions.test.js.md#entry
  const entry = fs.readFileSync(path.join(PUB, 'js', 'main.js'), 'utf8');
  assert.match(entry, /'\.\/11-actions\.js'/,
    '11-actions.js wird von js/main.js nicht importiert — der Dispatcher würde fehlen');
  assert.match(HTML, /app\.bundle\.js/, 'Das Frontend-Bündel fehlt in index.html');
});

test('jeder in Vorlagen referenzierte Handler ist bei der Registry angemeldet', () => {
  // Was sich geändert hat
  // Ausführlich: docs/begruendungen/test/csp-actions.test.js.md#strip
  const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  const names = new Set();
  for (const f of JS_FILES) {
    const src = strip(fs.readFileSync(path.join(PUB, 'js', f), 'utf8'));
    for (const m of src.matchAll(/data-(?:click|change|input|blur|keydown)="([A-Za-z_$][\w$]*)"/g))
      names.add(m[1]);
  }

  // Angemeldete Namen aus allen registerActions({…})-Aufrufen einsammeln.
  const registered = new Set();
  for (const f of fs.readdirSync(path.join(PUB, 'js'))) {
    if (!f.endsWith('.js') || f === 'app.bundle.js') continue;
    const src = strip(fs.readFileSync(path.join(PUB, 'js', f), 'utf8'));
    for (const m of src.matchAll(/registerActions\(\{([\s\S]*?)\}\);/g))
      for (const part of m[1].split(',')) {
        const key = part.trim().split(':')[0].trim();
        if (key) registered.add(key);
      }
  }

  // logviewer.js läuft in einem eigenen Popup-Fenster und löst seine vier
  // Handler über eine eigene Tabelle auf (test/logviewer-oberflaeche.test.js).
  const logviewer = strip(fs.readFileSync(path.join(PUB, 'js', 'logviewer.js'), 'utf8'));

  const missing = [...names].filter(n =>
    !registered.has(n) &&
    !new RegExp(`function\\s+${n}\\s*\\(|window\\.${n}\\s*=`).test(logviewer));
  assert.deepEqual(missing, [],
    `Nicht angemeldet — diese Knöpfe täten beim Klick nichts: ${missing.join(', ')}`);
});

test('der Dispatcher reicht mehrere Argumente und den Feldwert durch', () => {
  assert.match(ACT, /data-arg3/, 'Mehrere Argumente müssen unterstützt sein');
  assert.match(ACT, /el\.dataset\.val === '1'/,
    'Handler, die früher this.value gelesen haben, brauchen data-val');
  assert.match(ACT, /fn\.apply\(el, args\)/, 'this muss das auslösende Element bleiben');
});

test('Bildfehler kennen die Modi aus den Templates', () => {
  // Zwei Modi gibt es noch: den Platzhalter (bildTag in 01-bilder.js) und
  // „keep" für den Zoom. Was er im Bild bewirkt, prüft test/bilder-platzhalter.test.js.
  const js = path.join(__dirname, '..', 'public', 'js');
  const quellen = HTML + fs.readdirSync(js).filter(f => /^\d\d-.*\.js$/.test(f))
    .map(f => fs.readFileSync(path.join(js, f), 'utf8')).join('\n');
  const modi = new Set([...quellen.matchAll(/data-onerror="([a-z]+)"/g)].map(m => m[1]));
  assert.ok(modi.size >= 2, 'Keine Modi gefunden — greift die Suche noch?');
  assert.deepEqual([...modi].sort(), ['keep', 'platzhalter']);
  assert.match(ACT, /dataset\.onerror === 'keep'/, 'data-onerror="keep" wird nicht behandelt');
  assert.match(ACT, /bildPlatzhalter\(el\)/, 'Der Platzhalter wird nicht gesetzt');
});

test('index.html enthält kein Inline-<script> mehr', () => {
  // Eigene Fehlerklasse: Die Handler-Umstellung hat nur on*="…"-Attribute
  // erfasst. Ein <script>-Block ohne src wird von der geschlossenen CSP
  // ebenso blockiert — hier stand die PDF.js-Initialisierung.
  const blocks = [...HTML.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map(m => m[1].trim()).filter(Boolean);
  assert.deepEqual(blocks.map(b => b.slice(0, 60)), [],
    'Inline-<script> wird von script-src ohne unsafe-inline blockiert');
});

test('der PDF.js-Worker ist von der CSP gedeckt', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.ts'), 'utf8');
  assert.match(server, /"worker-src 'self' blob:"/,
    'Ohne worker-src fällt der Worker auf default-src zurück und würde blockiert');
});

test('das Log-Fenster lädt sein Skript als Datei, nicht inline', () => {
  // Ein per window.open + document.write gefülltes Fenster erbt die CSP des
  // Öffners. Seit script-src ohne 'unsafe-inline' wurde das frühere
  // Inline-<script> blockiert — Level-Umschalter, Neu laden und Auto
  // reagierten auf nichts, nur die Dauer liess sich noch ändern (ein <select>
  // zeigt seinen Wert ohne JavaScript).
  const core = require('./helpers/sources').coreQuelle();
  const win = core.slice(core.indexOf('function openLogViewer'),
                         core.indexOf('function openLogViewer') + 9000);
  assert.doesNotMatch(win, /'<script>'/, 'Inline-<script> wird von der CSP blockiert');
  assert.match(win, /logviewer\.js/, 'Externes Skript fehlt');
  for (const attr of ['data-base', 'data-i18n']) {
    assert.ok(win.includes(attr), `${attr} fehlt — das Skript kommt sonst nicht an seine Daten`);
  }
  // Die Sitzung meldet das Fenster an; ein Token aus localStorage legt die Webapp nicht mehr ab.
  assert.doesNotMatch(win, /localStorage|data-auth/, 'Altlast authToken aus localStorage');
  assert.match(win, /escHtmlAttr\(/, 'Attributwerte müssen abgesichert werden');
  assert.ok(fs.existsSync(path.join(PUB, 'js', 'logviewer.js')), 'logviewer.js fehlt');
});

test('ein einzelner Bildfehler blendet die Kachel nicht dauerhaft aus', () => {
  // Gemessen: ETIMEDOUT beim CDN-Abruf. Der Rückfall entfernte danach das src
  // oder blendete das Bild aus, und fallbackDone verhinderte jeden weiteren
  // Versuch — obwohl das Bild in Ordnung war.
  assert.match(ACT, /if \(!el\.dataset\.retried && el\.src\)/, 'Kein erneuter Versuch');
  // Die Absicht statt des Wortlauts
  // Ausführlich: docs/begruendungen/test/csp-actions.test.js.md#versuch
  const versuch = ACT.match(/setTimeout\(\(\) => \{([^}]*)\}, 1000\)/);
  assert.ok(versuch, 'Der zweite Versuch nach einer Sekunde fehlt');
  assert.match(versuch[1], /el\.removeAttribute\('src'\)/,
    "Der zweite Versuch muss das Attribut abraeumen — `el.src = ''` zeigt auf die Seite");
  assert.match(versuch[1], /el\.src = src/,
    'Der zweite Versuch muss dieselbe Adresse erneut anfordern');
  // Und erst danach greift der bisherige Rückfall
  const iRetry = ACT.indexOf('el.dataset.retried');
  const iDone  = ACT.indexOf('el.dataset.fallbackDone = ');
  assert.ok(iRetry > 0 && iRetry < iDone, 'Der Wiederholversuch muss vor dem Aufgeben stehen');
});

test('Löschknöpfe auf Kacheln tragen einen Papierkorb, kein ✕', () => {
  const core = require('./helpers/sources').coreQuelle();
  assert.match(core, /const TRASH_ICON_SVG/, 'Symbol fehlt');
  // currentColor: derselbe Pfad dient weiss auf rotem Grund (.delbtn) und rot
  // auf hellem Grund (.bd) — keine zweite Fassung nötig.
  assert.match(core, /stroke="currentColor"/, 'Das Symbol muss die Farbe erben');

  // Die Regel statt der Anzahl
  // Ausführlich: docs/begruendungen/test/csp-actions.test.js.md#ausnahme
  const AUSNAHME = new Set(['delInstr']);
  let ausnahmenGesehen = 0;

  // Der Selbstbeweis zählt über ALLE Dateien, nicht je Datei
  // Ausführlich: docs/begruendungen/test/csp-actions.test.js.md#knoepfegesamt
  let knoepfeGesamt = 0;
  for (const file of ['02-gallery.js', '03-parts.js', '06-minifigs.js', '07-set-detail.js']) {
    const src = fs.readFileSync(path.join(PUB, 'js', file), 'utf8');
    // `del\w*` und nicht `delete\w*`: Die Galerie-Kachel ruft `delSetStop`.
    // Mit dem engeren Muster fand die Suche dort NICHTS — und der Selbstbeweis
    // hat genau das gemeldet, statt gruen durchzulaufen.
    const knoepfe = [...src.matchAll(/<button[^>]*data-click="del\w*"[\s\S]{0,400}?<\/button>/g)]
      .map(m => m[0]);
    knoepfeGesamt += knoepfe.length;
    let gefunden = 0;
    for (const k of knoepfe) {
      const name = (k.match(/data-click="(del\w*)"/) || [])[1];
      if (AUSNAHME.has(name)) { gefunden++; continue; }
      assert.match(k, /\$\{TRASH_ICON_SVG\}/,
        `${file}: ein Löschknopf ohne Papierkorb-Symbol — ` +
        `dieselbe Aktion soll überall gleich aussehen:\n${k.slice(0, 160)}`);
    }
    ausnahmenGesehen += gefunden;
  }
  assert.ok(knoepfeGesamt >= 1, 'Kein einziger Löschknopf gefunden — Muster veraltet?');

  // Eine Zeile, die niemand mehr braucht, ist eine Erlaubnis, die niemand
  // prueft — dieselbe Regel wie in den anderen Waechtern dieses Baums.
  assert.equal(ausnahmenGesehen, AUSNAHME.size,
    `${ausnahmenGesehen} von ${AUSNAHME.size} Ausnahmen gefunden — eine davon ` +
    'beschreibt keinen Knopf mehr und gehoert gestrichen.');

  // Die betroffenen Knöpfe dürfen kein ✕ mehr enthalten
  const gallery = fs.readFileSync(path.join(PUB, 'js', '02-gallery.js'), 'utf8');
  assert.doesNotMatch(gallery, /class="delbtn"[^>]*>✕/, 'Set-Kachel zeigt noch ✕');

  // Der Papierkorb auf der Kachel ist ein Mausweg und für Hilfstechnik
  // verborgen (sonst steckte ein Knopf im Knopf); Löschen per Tastatur geht
  // über den Detail-Dialog. Ein title sagt der Maus, was er tut.
  assert.match(gallery, /<span class="delbtn" data-click="delSetStop"(?:\$\{echt\(\)\})? aria-hidden="true"[^>]*title=/, 'Set-Kachel: Papierkorb nicht verborgen');
  const figs = fs.readFileSync(path.join(PUB, 'js', '06-minifigs.js'), 'utf8');
  assert.match(figs, /<span class="delbtn" data-click="deleteManualFigStop"(?:\$\{echt\(\)\})? aria-hidden="true"[^>]*title=/,
    'Minifiguren-Kachel: Papierkorb nicht verborgen');

  // Einheitliches Muster über alle drei Tabellen: .ca als Hover-Behälter mit
  // .delbtn darin. Vorher war der Minifiguren-Knopf ein "btn bd" mit eigenem
  // Inline-Style und dauerhaft sichtbar, Teile hatten gar keinen.
  // Ausführlich: docs/begruendungen/test/csp-actions.test.js.md#for-stelle
  for (const [file, expected] of [['02-gallery.js', 1], ['03-parts.js', 1], ['06-minifigs.js', 2]]) {
    const src = fs.readFileSync(path.join(PUB, 'js', file), 'utf8');
    const n = (src.match(/<div class="ca"><(?:button|span) class="delbtn"/g) || []).length;
    assert.equal(n, expected, `${file}: ${n} statt ${expected} Kachel-Löschknöpfe im .ca/.delbtn-Muster`);
  }

  // Der Hover gilt für Set- UND manuelle Kacheln, und ohne Zeigegerät bleibt
  // der Knopf sichtbar — sonst wäre Löschen per Touch nicht erreichbar.
  const css = fs.readFileSync(path.join(PUB, 'styles.css'), 'utf8');
  // .mk-zeile steht seit dem 24.09. mit darin: Die Merklisten-Zeile trägt
  // denselben Papierkorb oben rechts und braucht dieselbe Einblendung.
  assert.match(css, /\.sc:hover \.ca, \.man-tile:hover \.ca, \.mk-zeile:hover \.ca\{opacity:1\}/,
    'Manuelle Kacheln oder die Merklisten-Zeile zeigen den Löschknopf nicht beim Überfahren');
  assert.match(css, /@media \(hover: none\)\{ \.ca\{opacity:1\} \}/,
    'Ohne Zeigegerät bliebe der Löschknopf unerreichbar');

  const i18n = require('./helpers/sources').i18nAll();
  assert.match(i18n, /'figs\.delete':\s*'Minifigur löschen'/, 'DE-Beschriftung fehlt');
  assert.match(i18n, /'figs\.delete':\s*'Delete minifigure'/, 'EN-Beschriftung fehlt');
});

test('der Löschknopf hat je Design eine eigene Fassung', () => {
  // Was dieser Test NICHT mehr prüft
  // Ausführlich: docs/begruendungen/test/csp-actions.test.js.md#css-stelle
  const css   = fs.readFileSync(path.join(PUB, 'styles.css'), 'utf8');
  const brick = fs.readFileSync(path.join(PUB, 'themes', 'brick.css'), 'utf8');

  const del = css.slice(css.indexOf('.delbtn{'), css.indexOf('.delbtn svg'));

  // 1) Eigene Fassung je Design
  assert.ok(del.length > 0, 'styles.css hat keine .delbtn-Regel');
  assert.match(brick, /\[data-theme="brick"\] \.sc \.delbtn\{/,
    'Das Stein-Design braucht eine eigene Fassung — sonst sitzt der helle Knopf auf der dunklen Leiste');
  assert.match(brick, /\[data-theme="brick"\] \.sc \.delbtn:hover\{/,
    'Auch der Hover braucht im Stein-Design eine eigene Fassung');

  // 2) Fokusring
  assert.match(del, /\.delbtn:focus-visible\{outline/,
    'Ohne Fokusring ist der Knopf per Tastatur unsichtbar');

  // 3) Token statt Literal — welcher Token, ist dem Test egal
  for (const [name, src] of [['styles.css', del], ['brick.css', brick]]) {
    assert.doesNotMatch(src, /#ef4444/, `${name}: --r500 benutzen statt Literal`);
    assert.doesNotMatch(src, /rgba\(239,\s*68,\s*68/, `${name}: --r500 benutzen statt Literal`);
  }
});

test('die Oberfläche lädt von keinem fremden Host mehr', () => {
  // Woher dieser Test kommt
  // Ausführlich: docs/begruendungen/test/csp-actions.test.js.md#html
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  // Nur LADENDE Elemente. <a href="https://rebrickable.com/api/"> ist ein
  // Verweis, den der Benutzer anklickt — er holt nichts nach und gehört in
  // die Einstellungen, wo erklärt wird, woher der API-Schlüssel kommt.
  const extern = [...html.matchAll(/<(?:link|script|img|iframe|source)\b[^>]*?(?:href|src)="(https?:\/\/[^"]+)"/g)]
    .map(m => m[1]);
  assert.deepEqual(extern, [],
    `index.html lädt von fremden Hosts: ${extern.join(', ')}`);

  // Und die CSP macht es verbindlich: kein Fremdhost in einer der Direktiven.
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.ts'), 'utf8');
  const csp = server.slice(server.indexOf("'Content-Security-Policy'"),
                           server.indexOf("frame-ancestors"))
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  const hosts = [...csp.matchAll(/https:\/\/[^\s"']+/g)].map(m => m[0]);
  assert.deepEqual(hosts, [],
    `Die CSP erlaubt noch fremde Hosts: ${hosts.join(', ')}`);
});

test('die Schriftdateien liegen wirklich im Baum', () => {
  // Eine fonts.css, deren woff2 fehlen, ist schlimmer als der alte Zustand:
  // Der Browser wartet erst auf einen 404 und fällt dann auf Systemschriften
  // zurück — sichtbar erst im Betrieb, nicht im Typecheck.
  const dir = path.join(__dirname, '..', 'public', 'vendor', 'fonts');
  const css = fs.readFileSync(path.join(dir, 'fonts.css'), 'utf8');
  const refs = [...css.matchAll(/url\(\.\/([^)]+)\)/g)].map(m => m[1]);
  assert.ok(refs.length >= 2, 'fonts.css verweist auf keine Dateien');
  for (const rel of refs) {
    assert.ok(fs.existsSync(path.join(dir, rel)), `Schriftdatei fehlt: ${rel}`);
  }
  // Die Lizenztexte gehören dazu (SIL OFL) — wie bei vendor/qrcode.
  const lizenzen = fs.readdirSync(dir).filter(f => f.startsWith('LICENSE'));
  assert.ok(lizenzen.length >= 2, 'Die Schriftlizenzen fehlen neben den Dateien');
});

test('externe Links öffnen ohne Zugriff auf das Öffnerfenster', () => {
  // Ein target="_blank" ohne rel="noopener" gibt der geöffneten Seite über
  // window.opener Zugriff auf das eigene Fenster — sie kann es umleiten
  // (Tabnabbing). Moderne Browser setzen noopener bei _blank inzwischen von
  // selbst; ältere und eingebettete WebViews nicht, und der Code setzte es an …
  // Ausführlich: docs/begruendungen/test/csp-actions.test.js.md#html-2
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const ohne = [...html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)]
    .map(m => m[0]).filter(tag => !/rel="[^"]*noopener/.test(tag));
  assert.deepEqual(ohne, [], `target="_blank" ohne rel="noopener": ${ohne.join(' | ')}`);
});
