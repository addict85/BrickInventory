/**
 * Statischer XSS-Regressionstest für public/js/.
 */
const { istAppModul } = require('../scripts/build-frontend');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const JS_DIR = path.join(__dirname, '..', 'public', 'js');
const FILES = fs.readdirSync(JS_DIR).filter(f => istAppModul(f)).sort();

// Die Helfer selbst, nicht nachgebaut: escapen.js ist DOM-frei und lädt in Node.
const helfer = import(require('node:url').pathToFileURL(path.join(JS_DIR, 'escapen.js')).href);
const loadHelpers = () => helfer;

test('esc() neutralisiert alle HTML-Metazeichen inkl. Apostroph', async () => {
  const { esc } = await loadHelpers();
  assert.equal(esc('<script>'), '&lt;script&gt;');
  assert.equal(esc('a"b'), 'a&quot;b');
  assert.equal(esc("a'b"), 'a&#39;b');
  assert.equal(esc('a&b'), 'a&amp;b');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

// Gegenprobe (08.11.2026): „\\“ und Steuerzeichen im Regex von sichereUrl() entfernt → rot: „/\\host“ kam durch.
test('sichereUrl() lässt nur gleiche Herkunft, http(s) und Bild-Daten durch', async () => {
  const { sichereUrl } = await loadHelpers();
  for (const gut of ['/img/a.png', '/', 'https://cdn.example/a.png', 'http://x/y', 'data:image/png;base64,AAAA', ' /pfad '])
    assert.equal(sichereUrl(gut), gut.trim(), `„${gut}“ fälschlich verworfen`);
  for (const schlecht of ['//evil.example/x', '/\\evil.example/x', '/\\\\evil.example', '/\t/evil.example', '/\n/evil.example',
    'javascript:alert(1)', 'https:\\\\evil.example', 'ftp://x', 'evil.example', '', null, undefined])
    assert.equal(sichereUrl(schlecht), '', `„${schlecht}“ kam durch`);
});

test('escJs() bricht nicht aus onclick="fn(\'…\')" aus', async () => {
  const { escJs } = await loadHelpers();
  // Der klassische Ausbruch: Apostroph schliesst den JS-String, danach Code.
  const payload = "');alert(1);//";
  const out = escJs(payload);
  assert.ok(!/(^|[^\\])'/.test(out), `Apostroph nicht escaped: ${out}`);
  assert.ok(!out.includes('<'), 'Winkelklammer nicht escaped');
  // Backslash muss verdoppelt werden, sonst entwertet er das folgende \'
  assert.equal(escJs('a\\'), 'a\\\\');
});

test('escUrl() lässt nur relative Pfade und http(s) durch', async () => {
  const { escUrl } = await loadHelpers();
  assert.equal(escUrl('https://cdn.rebrickable.com/x.jpg'), 'https://cdn.rebrickable.com/x.jpg');
  assert.equal(escUrl('/data/part_images/x.jpg'), '/data/part_images/x.jpg');
  assert.equal(escUrl('javascript:alert(1)'), '');
  assert.equal(escUrl('  JaVaScRiPt:alert(1)'), '');
  assert.equal(escUrl('//evil.tld/x.jpg'), '', 'protokollrelative URL muss raus');
  assert.equal(escUrl(''), '');
  // Attribut-Ausbruch über ein Anführungszeichen in der URL
  assert.ok(!escUrl('https://a/" onerror="alert(1)').includes('"'));
});

test('escHex() akzeptiert ausschliesslich 6 Hex-Ziffern', async () => {
  const { escHex } = await loadHelpers();
  assert.equal(escHex('FF0000'), '#FF0000');
  assert.equal(escHex('#00ff00'), '#00ff00');
  assert.equal(escHex('red;background:url(x)'), 'var(--s300)');
  assert.equal(escHex(null, 'var(--s50)'), 'var(--s50)');
});

// ── Statische Sink-Prüfung ──────────────────────────────────────────────────
const SAFE = /^\s*(esc|escJs|escUrl|sichereUrl|escHex|escHtml|encodeURIComponent|t)\s*\(/;
const DATA_FIELD = /(set_number|part_number|bl_part_number|fig_number|bl_fig_number|part_name|fig_name|color_name|category_name|image_url|image_local|note|username|theme|last_error)\b/;

function interpolations(attrValue) {
  return [...attrValue.matchAll(/\$\{([^{}]*)\}/g)].map(m => m[1]);
}

test('kein src/href/data-orig mit ungeprüfter URL', () => {
  const bad = [];
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(JS_DIR, f), 'utf8');
    for (const m of src.matchAll(/\b(src|href|data-orig)="([^"#]*\$\{[^"]*)"/g)) {
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

test('esc/escJs/escUrl/escHex sind genau einmal definiert', () => {
  // Alle Maskierer liegen in escapen.js (DOM-frei, auch der BrickLink-Export
  // lädt es). Zwei Fassungen desselben Maskierers liefen schon einmal auseinander.
  const zuhause = { esc: 'escapen.js', escJs: 'escapen.js',
                    escUrl: 'escapen.js', escHex: 'escapen.js' };
  for (const [name, datei] of Object.entries(zuhause)) {
    const defs = FILES.filter(f =>
      new RegExp(`function\\s+${name}\\s*\\(`).test(fs.readFileSync(path.join(JS_DIR, f), 'utf8')));
    assert.deepEqual(defs, [datei],
      `${name}() muss genau einmal deklariert sein (in ${datei}) — sonst haengt ` +
      'das Escaping an der Ladereihenfolge, und zwei Fassungen laufen ' +
      'auseinander. Genau das hat test/wunschliste-xml.test.js schon einmal ' +
      'gemeldet: Die App maskierte, die Webapp nicht.');
  }
});

test('Übersetzungen für reinen Text laufen über tRaw(), nicht über t()', () => {
  // Woher dieser Test kommt
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
  // Woher dieser Test kommt
  const bad = [];
  const FELD = /\w+\.(?:error|message)\b/g;
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(JS_DIR, f), 'utf8');
    let ab = 0;
    src.split('\n').forEach((line, i) => {
      const zeileAb = ab; ab += line.length + 1;
      if (/^\s*(\/\/|\*)/.test(line)) return;
      if (!/<\w/.test(line)) return;                       // kein HTML-Kontext
      for (const m of line.matchAll(/\$\{([^}]*)\}/g)) {
        // In html`` maskiert die Vorlage selbst — ausser der Wert geht durch ungeprueft().
        const vor = src.lastIndexOf('`', zeileAb + (m.index ?? 0));
        if (src.slice(vor - 4, vor) === 'html' && !/ungeprueft\(/.test(m[1])) continue;
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
