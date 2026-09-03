/**
 * Inline-Handler entfernen, damit `script-src 'unsafe-inline'` aus der CSP
 * verschwinden kann (Punkt 2 der Optimierungsliste).
 *
 * Solange irgendwo `onclick="…"` im Markup steht, muss der Browser
 * Inline-Skript erlauben — und damit fehlt genau die Verteidigungslinie, die
 * bei einer übersehenen XSS-Lücke greifen würde.
 *
 * Statt 140 Handler einzeln in addEventListener zu übersetzen, gibt es einen
 * delegierten Dispatcher (js/11-actions.js) mit data-click/data-change und
 * optionalen data-arg. Nebeneffekt: Der escJs-Kontext verschwindet, weil ein
 * Wert in einem data-Attribut nie als Code gelesen wird.
 *
 * Ausführen: npm test
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

test('img-src erlaubt keine fremden Hosts mehr', () => {  // ── Woher dieser Test kommt ─────────────────────────────────────────────
  // img-src trug ein pauschales `https:` mit der Begründung, Set-Bilder kämen
  // direkt von den CDNs. Seit hardened-69 stimmt das nicht mehr: imgUrl()
  // schickt jede absolute Adresse durch /api/img-proxy, und alle Bilder
  // verlangen Anmeldung. Die Erlaubnis blieb nur stehen — und ein
  // eingeschleustes <img src="https://fremd/?daten"> ist eine Anfrage nach
  // draussen, auch ohne ausführbares Skript. Genau den Kanal schliesst
  // connect-src 'self' auf der anderen Seite.
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
  // deshalb wird geprüft, dass er Teil des Bündels IST und dass das Bündel
  // geladen wird.
  // Seit der Umstellung auf ES-Module gibt es keine Dateiliste mehr, sondern
  // einen Modulgraphen: js/main.js importiert den Dispatcher, esbuild zieht
  // ihn darüber ins Bündel.
  const entry = fs.readFileSync(path.join(PUB, 'js', 'main.js'), 'utf8');
  assert.match(entry, /'\.\/11-actions\.js'/,
    '11-actions.js wird von js/main.js nicht importiert — der Dispatcher würde fehlen');
  assert.match(HTML, /app\.bundle\.js/, 'Das Frontend-Bündel fehlt in index.html');
});

test('jeder in Vorlagen referenzierte Handler ist bei der Registry angemeldet', () => {
  // ── Was sich geändert hat ────────────────────────────────────────────────
  // Vorher prüfte dieser Test, ob der Handlername IRGENDWO als Funktion
  // definiert ist. Das war die richtige Frage, solange der Dispatcher über
  // window[name] auflöste — definiert hiess dann automatisch erreichbar.
  //
  // Mit ES-Modulen stimmt das nicht mehr: Eine Funktion kann sauber definiert
  // und trotzdem unerreichbar sein, wenn ihr Modul sie nicht bei der Registry
  // anmeldet (js/00-registry.js). Geprüft wird deshalb jetzt die Anmeldung.
  //
  // Kommentare werden vor dem Sammeln entfernt: Der Erklärtext in
  // 00-registry.js nennt selbst ein data-click-Beispiel und würde sonst als
  // fehlender Handler gemeldet.
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

  // logviewer.js läuft als klassisches Skript in einem eigenen Popup-Fenster
  // und meldet sich nicht an — für seine vier Handler gilt weiterhin die
  // window-Auflösung (Rückfall in resolveAction).
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
  for (const mode of ['hide', 'clear']) {
    assert.match(ACT, new RegExp(`case '${mode}'`), `data-onerror="${mode}" wird nicht behandelt`);
  }
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
  for (const attr of ['data-auth', 'data-base', 'data-i18n']) {
    assert.ok(win.includes(attr), `${attr} fehlt — das Skript kommt sonst nicht an seine Daten`);
  }
  assert.match(win, /escHtmlAttr\(/, 'Attributwerte müssen abgesichert werden');
  assert.ok(fs.existsSync(path.join(PUB, 'js', 'logviewer.js')), 'logviewer.js fehlt');
});

test('ein einzelner Bildfehler blendet die Kachel nicht dauerhaft aus', () => {
  // Gemessen: ETIMEDOUT beim CDN-Abruf. Der Rückfall entfernte danach das src
  // oder blendete das Bild aus, und fallbackDone verhinderte jeden weiteren
  // Versuch — obwohl das Bild in Ordnung war.
  assert.match(ACT, /if \(!el\.dataset\.retried && el\.src\)/, 'Kein erneuter Versuch');
  assert.match(ACT, /setTimeout\(\(\) => \{ el\.src = ''; el\.src = src; \}, 1000\)/,
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

  // ── Die Regel statt der Anzahl ────────────────────────────────────────────
  //
  // Hier standen feste Zahlen („02-gallery.js: 1, 06-minifigs.js: 4"), und die
  // Begründung darüber erzählte die Geschichte ihrer Änderungen: erst zwei,
  // dann drei, dann vier. Eine Zahl, die bei jedem Umbau nachgezogen werden
  // muss, prüft die Absicht nicht — sie prüft den letzten Stand.
  //
  // Zuletzt schlug sie an, weil ein Löschknopf in der Figuren-TABELLE
  // entfernt wurde: Er hing an `f.source==='manual'`, und diese Liste lädt
  // ausschliesslich `source=set` — der Knopf war unerreichbar. Ein richtiger
  // Schritt, der einen roten Test erzeugte.
  //
  // Geprüft wird jetzt, worum es geht: JEDER Löschknopf auf einer Kachel oder
  // in einer Tabellenzeile trägt den Papierkorb.
  //
  // Die eine Ausnahme, mit Grund: `delInstr` entfernt einen Anleitungs-LINK
  // aus einer Liste im Set-Detail — ein kleines, graues ✕ neben dem Eintrag,
  // keine Kachelaktion. „Aus der Liste nehmen" und „diesen Eintrag löschen"
  // sind verschiedene Dinge, und der Titel dieses Tests spricht von Kacheln.
  // Wer das ändern will, entscheidet über die Darstellung — nicht über eine
  // Regel, die hier durchgesetzt wird.
  const AUSNAHME = new Set(['delInstr']);
  let ausnahmenGesehen = 0;

  for (const file of ['02-gallery.js', '06-minifigs.js']) {
    const src = fs.readFileSync(path.join(PUB, 'js', file), 'utf8');
    // `del\w*` und nicht `delete\w*`: Die Galerie-Kachel ruft `delSetStop`.
    // Mit dem engeren Muster fand die Suche dort NICHTS — und der Selbstbeweis
    // darunter hat genau das gemeldet, statt gruen durchzulaufen.
    const knoepfe = [...src.matchAll(/<button[^>]*data-click="del\w*"[\s\S]{0,400}?<\/button>/g)]
      .map(m => m[0]);
    // Selbstbeweis: Findet das Muster keinen Knopf, wäre die Schleife leer und
    // der Test grün, ohne etwas geprüft zu haben.
    assert.ok(knoepfe.length >= 1, `${file}: kein Löschknopf gefunden — Muster veraltet?`);
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

  // Eine Zeile, die niemand mehr braucht, ist eine Erlaubnis, die niemand
  // prueft — dieselbe Regel wie in den anderen Waechtern dieses Baums.
  assert.equal(ausnahmenGesehen, AUSNAHME.size,
    `${ausnahmenGesehen} von ${AUSNAHME.size} Ausnahmen gefunden — eine davon ` +
    'beschreibt keinen Knopf mehr und gehoert gestrichen.');

  // Die betroffenen Knöpfe dürfen kein ✕ mehr enthalten
  const gallery = fs.readFileSync(path.join(PUB, 'js', '02-gallery.js'), 'utf8');
  assert.doesNotMatch(gallery, /class="delbtn"[^>]*>✕/, 'Set-Kachel zeigt noch ✕');
  const figs = fs.readFileSync(path.join(PUB, 'js', '06-minifigs.js'), 'utf8');
  assert.doesNotMatch(figs, /data-click="deleteManualFig(Stop)?"[^>]*>✕/, 'Minifiguren zeigen noch ✕');

  // Ohne Text braucht der Knopf eine Beschriftung für Hilfstechnik
  assert.match(gallery, /aria-label="\$\{esc\(t\('detail\.delete'\)\)\}"/, 'Set-Knopf ohne aria-label');
  assert.match(figs, /aria-label="\$\{esc\(t\('figs\.delete'\)\)\}"/, 'Minifiguren-Knopf ohne aria-label');

  // Einheitliches Muster über alle drei Tabellen: .ca als Hover-Behälter mit
  // .delbtn darin. Vorher war der Minifiguren-Knopf ein "btn bd" mit eigenem
  // Inline-Style und dauerhaft sichtbar, Teile hatten gar keinen.
  for (const [file, expected] of [['02-gallery.js', 1], ['06-minifigs.js', 3]]) {
    const src = fs.readFileSync(path.join(PUB, 'js', file), 'utf8');
    const n = (src.match(/<div class="ca"><button class="delbtn"/g) || []).length;
    assert.equal(n, expected, `${file}: ${n} statt ${expected} Kachel-Löschknöpfe im .ca/.delbtn-Muster`);
  }

  // Der Hover gilt für Set- UND manuelle Kacheln, und ohne Zeigegerät bleibt
  // der Knopf sichtbar — sonst wäre Löschen per Touch nicht erreichbar.
  const css = fs.readFileSync(path.join(PUB, 'styles.css'), 'utf8');
  assert.match(css, /\.sc:hover \.ca, \.man-tile:hover \.ca\{opacity:1\}/,
    'Manuelle Kacheln zeigen den Löschknopf nicht beim Überfahren');
  assert.match(css, /@media \(hover: none\)\{ \.ca\{opacity:1\} \}/,
    'Ohne Zeigegerät bliebe der Löschknopf unerreichbar');

  const i18n = require('./helpers/sources').i18nAll();
  assert.match(i18n, /'figs\.delete':\s*'Minifigur löschen'/, 'DE-Beschriftung fehlt');
  assert.match(i18n, /'figs\.delete':\s*'Delete minifigure'/, 'EN-Beschriftung fehlt');
});

test('der Löschknopf hat je Design eine eigene Fassung', () => {
  // ── Was dieser Test NICHT mehr prüft ──────────────────────────────────────
  // Vorher standen hier konkrete Farbwerte: welchen Token der Hover nimmt, dass
  // der Ruhezustand nicht rot sein darf, dass im Stein-Design beim Überfahren
  // genau var(--b600) erscheint. Das ist Gestaltung, keine Zusicherung — ein
  // Test, der die Hover-Farbe festnagelt, verhindert nur, dass man sie ändert,
  // und schlägt dann fehl, obwohl nichts kaputt ist. Genau das war der Fall.
  //
  // ── Was er weiter prüft ───────────────────────────────────────────────────
  // Drei Dinge, die keine Geschmacksfragen sind und die alle aus echten
  // Fehlern stammen:
  //   1. Jedes Design hat eine eigene Fassung. Fehlt der Stein-Block, sitzt der
  //      helle Standard-Knopf auf der dunklen Noppenleiste und verschwindet.
  //   2. Es gibt einen Fokusring. Ohne ihn ist der Knopf per Tastatur
  //      unsichtbar — Barrierefreiheit, nicht Optik.
  //   3. Farben kommen aus Tokens, nicht als Literal. Sonst zieht die nächste
  //      Designänderung an diesem Knopf vorbei.
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
  // ── Woher dieser Test kommt ─────────────────────────────────────────────
  // index.html lud Plus Jakarta Sans und JetBrains Mono von Google — die
  // letzte Fremdquelle, nachdem qrcodejs genau deswegen nach public/vendor/
  // gezogen ist. Drei Gründe, das zu beenden: eine LAN-/Offline-Installation
  // bekam die Schriften gar nicht, jeder Seitenaufruf meldete IP und
  // User-Agent an einen Dritten, und die CSP musste zwei fremde Hosts offen
  // halten. Die Dateien liegen jetzt unter public/vendor/fonts/.
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
  // selbst; ältere und eingebettete WebViews nicht, und der Code setzte es an
  // allen anderen Stellen bereits. Die beiden Links zu rebrickable/brickset in
  // den Einstellungen waren die Ausnahme.
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const ohne = [...html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)]
    .map(m => m[0]).filter(tag => !/rel="[^"]*noopener/.test(tag));
  assert.deepEqual(ohne, [], `target="_blank" ohne rel="noopener": ${ohne.join(' | ')}`);
});
