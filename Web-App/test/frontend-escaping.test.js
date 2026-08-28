/**
 * Statischer XSS-Regressionstest für public/js/.
 *
 * Hintergrund: Die Listen- und Detailansichten werden per innerHTML aus
 * Template-Literalen gebaut. Solange das so ist, ist jedes Datenfeld, das
 * ungeescaped in ein Attribut oder in einen JS-String im Attribut wandert, ein
 * Stored-XSS-Vektor — und genau das war an ~20 Stellen der Fall (Bild-URLs
 * manueller Teile, Set-Nummern in onclick, Farb- und Teilenamen).
 *
 * Dieser Test prüft ohne DB und ohne Browser:
 *   1. Die Escaping-Helfer verhalten sich in ihrem jeweiligen Kontext korrekt.
 *   2. Es gibt keine neuen ungeschützten Sinks in den Frontend-Dateien.
 *
 * Punkt 2 ist der eigentliche Wert: Der Fix von heute hält nur, wenn die
 * nächste Zeile `src="${x}"` beim Testlauf rot wird statt in Produktion.
 *
 * Ausführen: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const JS_DIR = path.join(__dirname, '..', 'public', 'js');
const FILES = fs.readdirSync(JS_DIR).filter(f => /^\d\d-.*\.js$/.test(f)).sort();

// ── Helfer aus 01-core.js in einer Sandbox laden ────────────────────────────
function loadHelpers() {
  // Seit der Umstellung auf ES-Module tragen die Deklarationen ein
  // vorangestelltes `export`. Das wird für die Sandbox entfernt — dort läuft
  // der Ausschnitt als klassisches Skript, und `export` wäre ein Syntaxfehler.
  const src = require('./helpers/sources').coreQuelle()
    .replace(/^export /gm, '');
  const block = src.slice(src.indexOf('function esc(s)'), src.indexOf('const escHtml'));
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(block + '\n;({ esc, escJs, escUrl, escHex })', ctx);
  return vm.runInContext('({ esc, escJs, escUrl, escHex })', ctx);
}

test('esc() neutralisiert alle HTML-Metazeichen inkl. Apostroph', () => {
  const { esc } = loadHelpers();
  assert.equal(esc('<script>'), '&lt;script&gt;');
  assert.equal(esc('a"b'), 'a&quot;b');
  assert.equal(esc("a'b"), 'a&#39;b');
  assert.equal(esc('a&b'), 'a&amp;b');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('escJs() bricht nicht aus onclick="fn(\'…\')" aus', () => {
  const { escJs } = loadHelpers();
  // Der klassische Ausbruch: Apostroph schliesst den JS-String, danach Code.
  const payload = "');alert(1);//";
  const out = escJs(payload);
  assert.ok(!/(^|[^\\])'/.test(out), `Apostroph nicht escaped: ${out}`);
  assert.ok(!out.includes('<'), 'Winkelklammer nicht escaped');
  // Backslash muss verdoppelt werden, sonst entwertet er das folgende \'
  assert.equal(escJs('a\\'), 'a\\\\');
});

test('escUrl() lässt nur relative Pfade und http(s) durch', () => {
  const { escUrl } = loadHelpers();
  assert.equal(escUrl('https://cdn.rebrickable.com/x.jpg'), 'https://cdn.rebrickable.com/x.jpg');
  assert.equal(escUrl('/data/part_images/x.jpg'), '/data/part_images/x.jpg');
  assert.equal(escUrl('javascript:alert(1)'), '');
  assert.equal(escUrl('  JaVaScRiPt:alert(1)'), '');
  assert.equal(escUrl('//evil.tld/x.jpg'), '', 'protokollrelative URL muss raus');
  assert.equal(escUrl(''), '');
  // Attribut-Ausbruch über ein Anführungszeichen in der URL
  assert.ok(!escUrl('https://a/" onerror="alert(1)').includes('"'));
});

test('escHex() akzeptiert ausschliesslich 6 Hex-Ziffern', () => {
  const { escHex } = loadHelpers();
  assert.equal(escHex('FF0000'), '#FF0000');
  assert.equal(escHex('#00ff00'), '#00ff00');
  assert.equal(escHex('red;background:url(x)'), 'var(--s300)');
  assert.equal(escHex(null, 'var(--s50)'), 'var(--s50)');
});

// ── Statische Sink-Prüfung ──────────────────────────────────────────────────
const SAFE = /^\s*(esc|escJs|escUrl|escHex|escHtml|encodeURIComponent|t)\s*\(/;
const DATA_FIELD = /(set_number|part_number|bl_part_number|fig_number|bl_fig_number|part_name|fig_name|color_name|category_name|image_url|image_local|note|username|theme|last_error)\b/;

function interpolations(attrValue) {
  return [...attrValue.matchAll(/\$\{([^{}]*)\}/g)].map(m => m[1]);
}

test('kein src/href/data-orig mit ungeprüfter URL', () => {
  const bad = [];
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(JS_DIR, f), 'utf8');
    for (const m of src.matchAll(/\b(src|href|data-orig)="([^"]*\$\{[^"]*)"/g)) {
      for (const expr of interpolations(m[2])) {
        if (!SAFE.test(expr)) bad.push(`${f}: ${m[1]}="…\${${expr}}…"`);
      }
    }
  }
  assert.deepEqual(bad, [], 'URL-Attribute müssen durch escUrl()');
});

test('kein onXxx-Handler mit ungeprüftem Datenfeld', () => {
  const bad = [];
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(JS_DIR, f), 'utf8');
    for (const m of src.matchAll(/\bon[a-z]+="([^"]*\$\{[^"]*)"/g)) {
      for (const expr of interpolations(m[1])) {
        if (DATA_FIELD.test(expr) && !SAFE.test(expr)) bad.push(`${f}: on…="…\${${expr}}…"`);
      }
    }
  }
  assert.deepEqual(bad, [], 'Werte in Inline-Handlern müssen durch escJs()');
});

test('esc/escJs/escUrl/escHex sind genau einmal definiert (in 01-core.js)', () => {
  for (const name of ['esc', 'escJs', 'escUrl', 'escHex']) {
    const defs = FILES.filter(f =>
      new RegExp(`function\\s+${name}\\s*\\(`).test(fs.readFileSync(path.join(JS_DIR, f), 'utf8')));
    assert.deepEqual(defs, ['01-core.js'],
      `${name}() muss zentral in 01-core.js liegen — sonst hängt das Escaping an der Ladereihenfolge der <script>-Tags`);
  }
});

test('Übersetzungen für reinen Text laufen über tRaw(), nicht über t()', () => {
  // ── Woher dieser Test kommt ──────────────────────────────────────────────
  // t() maskiert die eingesetzten Werte, weil das Ergebnis meist in innerHTML
  // landet. Geht es dagegen nach textContent, erscheint die Maskierung
  // WÖRTLICH: Aus der Schweizer Tausendertrennung 9'325 wurde im Katalog
  // sichtbar "9&#39;325 Sets im Katalog".
  //
  // Die Regel lautet deshalb: HTML-Ziel → t(), Textziel → tRaw().
  //
  // Bewusst auch dort angewandt, wo gerade keine Variable übergeben wird —
  // ohne Variablen sind beide identisch, aber so bricht die Stelle nicht
  // erneut, sobald jemand einen Wert ergänzt.
  const jsDir = path.join(__dirname, '..', 'public', 'js');
  const offenders = [];
  for (const f of fs.readdirSync(jsDir)) {
    if (!f.endsWith('.js') || f === 'app.bundle.js') continue;
    fs.readFileSync(path.join(jsDir, f), 'utf8').split('\n').forEach((l, i) => {
      if (/^\s*(\/\/|\*)/.test(l)) return;
      // Zuweisung an ein Textziel oder Aufruf einer Funktion, die textContent setzt
      if (/(\.(?:textContent|value|placeholder|title|alt|label)\s*=\s*|alert\(|confirm\(|toast\(|confirmDelete\()\s*t\(/.test(l)) {
        offenders.push(`${f}:${i + 1}`);
      }
    });
  }
  assert.deepEqual(offenders, [],
    `t() statt tRaw() an einem Textziel — die Maskierung würde sichtbar: ${offenders.join(', ')}`);
});

test('serverseitige Fehlermeldungen laufen im HTML-Kontext durch esc()', () => {
  // ── Woher dieser Test kommt (Nachtrag 30) ────────────────────────────────
  // Die Finanztabelle setzte den Fehlertext eines Sets roh in innerHTML:
  //     `<td …>${s.error ? s.error : fmtN(total, cur)}</td>`
  // Diese Meldung kommt nicht aus dem eigenen Haus: clients/bricklink.ts baut
  // sie bei einer Nicht-JSON-Antwort aus dem ANTWORTKÖRPER —
  //     `BrickLink non-JSON (HTTP ${status}): ${body.substring(0, 200)}`
  // Liefert BrickLink (oder ein Proxy, ein Portal, eine CDN-Fehlerseite) HTML
  // statt JSON, landen dessen erste 200 Zeichen unmaskiert im DOM. Mit
  // `<img src=x onerror=…>` in diesen 200 Zeichen ist das ein aktiver Handler
  // in der Seite des Nutzers — die Kette wurde nachgestellt, bevor sie
  // gemeldet wurde.
  //
  // Die Regeln oben decken Attribut- und Handler-Kontexte ab. Diese hier
  // deckt den TEXTkontext ab, und zwar nur für Felder, deren Inhalt von aussen
  // kommen kann (.error/.message).
  //
  // Bewusst NICHT gemeldet werden:
  //   • Zeilen ohne HTML-Tag — dort geht der Wert an textContent oder in eine
  //     Variable, die an ihrer Einsetzstelle maskiert wird (nachgeprüft für
  //     addCsvLog in 02-gallery.js und priceStatusBadge in 04-finance.js)
  //   • Vorkommen in BEDINGUNGSstellung (`s.error ? … : …`) — dort entscheidet
  //     der Wert nur, ausgegeben wird er nicht
  //   • Zeichenkettenliterale wie t('settings.error') — Übersetzungsschlüssel
  const bad = [];
  const FELD = /\w+\.(?:error|message)\b/g;
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(JS_DIR, f), 'utf8');
    src.split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      if (!/<\w/.test(line)) return;                       // kein HTML-Kontext
      for (const m of line.matchAll(/\$\{([^}]*)\}/g)) {
        // Zeichenkettenliterale entfernen, damit Übersetzungsschlüssel
        // ('…error') nicht als Datenfeld gelten.
        const ausdruck = m[1].replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "''");
        for (const treffer of ausdruck.matchAll(FELD)) {
          const danach = ausdruck.slice(treffer.index + treffer[0].length).trimStart();
          if (danach.startsWith('?')) continue;             // Bedingungsstellung
          const davor = ausdruck.slice(0, treffer.index);
          if (/\besc\s*\($/.test(davor)) continue;          // bereits maskiert
          bad.push(`${f}:${i + 1}: \${${m[1]}}`);
        }
      }
    });
  }
  assert.deepEqual(bad, [],
    `Fehlermeldungen im HTML-Kontext müssen durch esc() — sie können Text fremder Dienste enthalten: ${bad.join(', ')}`);
});
