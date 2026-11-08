/**
 * Der Dispatcher (js/11-actions.js) und die Bildfehler in jsdom am Bündel aus
 * main.js, das zusätzlich die Registry auf window legt: Jeder Handlername aus
 * Markup und Vorlagen ist zur Laufzeit angemeldet, ein Klick reicht Argumente,
 * Feldwert und `this` durch, ein Bildfehler wird einmal wiederholt, bevor der
 * Rückfall greift, und das Protokollfenster lädt sein Skript als Datei.
 *
 * Gegenproben (08.11.2026 gemessen, je einzeln, danach zurückgesetzt):
 *   A  `closePwModal,` aus registerActions() in 11-actions.js gestrichen → rot:
 *      „jeder Handler aus Markup und Vorlagen ist angemeldet“
 *   B  in handle() die Schleife über data-arg… nach data-arg2 abgebrochen
 *      (Liste ohne data-arg3) → rot: „ein Klick reicht Argumente …“
 *   C  `fn.apply(el, args)` → `fn(...args)` → rot: „ein Klick reicht … this“
 *   D  das `true` (Capture) am error-Hörer entfernt → rot: „ein Bildfehler
 *      wird einmal wiederholt …“ und „der Zoom behält …“ (error steigt nicht auf)
 *   E  der Zweig `if (!el.dataset.retried && el.src)` entfernt → rot: „ein
 *      Bildfehler wird einmal wiederholt …“
 *   F  der Zweig für data-onerror="keep" entfernt → rot: „der Zoom behält …“
 *   G  in openLogViewer wieder `'<script>' + …` statt logviewer.js → rot:
 *      „das Protokollfenster lädt sein Skript als Datei“
 *   H  `import './11-actions.js';` aus main.js gestrichen → rot: alle Fälle hier
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { baueTestbuendel } = require('./helpers/buendel');

process.env.TEST_BUENDEL = baueTestbuendel(
  'aktionen-dispatcher',
  "import { actionNames, registerActions } from './00-registry.js';\n" +
    'window.__registry = { actionNames, registerActions };\n',
);
const { oeffneOberflaeche, warte, takt } = require('./helpers/oberflaeche');

const PUB = path.join(__dirname, '..', 'public');

/** Handlernamen im Markup und in den Vorlagen (Struktur); ob sie angemeldet sind, sagt die Laufzeit. */
function namenImMarkup() {
  const quellen = [
    fs.readFileSync(path.join(PUB, 'index.html'), 'utf8'),
    ...fs
      .readdirSync(path.join(PUB, 'js'))
      .filter(f => /^\d\d-.*\.js$/.test(f) && f !== '00-registry.js')
      .map(f =>
        fs
          .readFileSync(path.join(PUB, 'js', f), 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:])\/\/[^\n]*/g, '$1'),
      ),
  ];
  const namen = new Set();
  for (const s of quellen)
    for (const m of s.matchAll(/data-(?:click|change|input|blur|keydown)="([A-Za-z_$][\w$]*)"/g)) namen.add(m[1]);
  // Der Log-Betrachter läuft im eigenen Fenster mit eigener Tabelle (logviewer-oberflaeche.test.js).
  for (const n of ['loadLogs', 'renderLogs', 'toggleAuto', 'toggleLevel']) namen.delete(n);
  return [...namen].sort();
}

test('jeder Handler aus Markup und Vorlagen ist angemeldet', async () => {
  const { w } = await oeffneOberflaeche();
  try {
    const namen = namenImMarkup();
    assert.ok(namen.length > 100, `nur ${namen.length} Namen gefunden — greift die Suche noch?`);
    const angemeldet = new Set(w.__registry.actionNames());
    assert.deepEqual(
      namen.filter(n => !angemeldet.has(n)),
      [],
      'Nicht angemeldet — diese Knöpfe täten beim Klick nichts',
    );
  } finally {
    w.close();
  }
});

test('ein Klick reicht Argumente, Feldwert und this durch', async () => {
  const { w, d } = await oeffneOberflaeche();
  try {
    const gesehen = [];
    w.__registry.registerActions({
      probeAktion(...args) {
        gesehen.push({ dies: this, args });
      },
    });
    const wirt = d.createElement('div');
    wirt.innerHTML =
      '<button id="p1" data-click="probeAktion" data-arg="1" data-arg2="b" data-arg3="c">x</button>' +
      '<input id="p2" data-click="probeAktion" data-arg="k" data-val="1" value="42">' +
      '<button id="p3" data-click="gibtEsNicht">x</button>';
    d.body.append(wirt);
    d.getElementById('p1').click();
    d.getElementById('p2').click();
    const warnungen = [];
    w.console.warn = (...a) => warnungen.push(a.join(' '));
    d.getElementById('p3').click();
    assert.equal(gesehen.length, 2);
    assert.equal(gesehen[0].dies, d.getElementById('p1'), 'this ist das auslösende Element');
    // data-arg kommt immer als Zeichenkette an; das Ereignis steht zuletzt.
    assert.deepEqual(gesehen[0].args.slice(0, 3), ['1', 'b', 'c']);
    assert.equal(gesehen[0].args[3]?.type, 'click');
    assert.deepEqual(gesehen[1].args.slice(0, 2), ['k', '42'], 'data-val="1" reicht den Feldwert');
    assert.ok(
      warnungen.some(t => t.includes('unbekannter Handler') && t.includes('gibtEsNicht')),
      'Ein Tippfehler im Handlernamen muss auffallen',
    );
  } finally {
    w.close();
  }
});

/** Ein Bild, das nicht lädt: error steigt nicht auf, der Dispatcher hört in der Capture-Phase. */
const fehlschlag = (w, img) => img.dispatchEvent(new w.Event('error'));

test('ein Bildfehler wird einmal wiederholt, bevor der Rückfall greift', async () => {
  const { w, d } = await oeffneOberflaeche();
  try {
    const wirt = d.createElement('div');
    wirt.innerHTML = '<img id="b1" alt="" src="/images/sets/1-1.jpg" data-orig="/images/sets/1-1-gross.jpg">';
    d.body.append(wirt);
    const img = d.getElementById('b1');
    const gesetzt = [];
    const echt = Object.getOwnPropertyDescriptor(w.HTMLImageElement.prototype, 'src');
    Object.defineProperty(img, 'src', {
      get() {
        return echt.get.call(this);
      },
      set(v) {
        gesetzt.push(v);
        echt.set.call(this, v);
      },
    });
    fehlschlag(w, img);
    assert.equal(img.dataset.retried, '1', 'Kein zweiter Versuch vorgemerkt');
    assert.ok(img.getAttribute('src'), 'Das Bild ist nach dem ersten Fehler schon weg');
    // Nach einer Sekunde dieselbe Adresse noch einmal, über ein frisch gesetztes Attribut.
    assert.ok(await warte(() => gesetzt.length > 0, 3000), 'Der zweite Versuch kommt nicht');
    assert.equal(gesetzt[0], 'http://localhost/images/sets/1-1.jpg');
    // Erst der zweite Fehler greift zum Rückfall: die volle Auflösung aus data-orig.
    fehlschlag(w, img);
    assert.equal(img.getAttribute('src'), '/images/sets/1-1-gross.jpg');
  } finally {
    w.close();
  }
});

test('der Zoom behält seine Adresse, wenn das Bild nicht lädt', async () => {
  const { w, d } = await oeffneOberflaeche();
  try {
    const img = d.getElementById('lightbox-img');
    assert.equal(img.dataset.onerror, 'keep');
    img.dataset.retried = '1';
    img.setAttribute('src', '/images/sets/2-1.jpg');
    const warnungen = [];
    w.console.warn = (...a) => warnungen.push(a.join(' '));
    fehlschlag(w, img);
    fehlschlag(w, img);
    assert.equal(img.getAttribute('src'), '/images/sets/2-1.jpg', 'Der Zoom zeigt sonst ein leeres Overlay');
    assert.equal(img.dataset.fallbackDone, undefined);
    assert.ok(
      warnungen.some(t => t.includes('[img]') && t.includes('/images/sets/2-1.jpg')),
      'Die Konsole nennt die Adresse',
    );
  } finally {
    w.close();
  }
});

test('das Protokollfenster lädt sein Skript als Datei', async () => {
  const { w, d } = await oeffneOberflaeche();
  try {
    let geschrieben = '';
    w.open = () => ({
      document: {
        open() {},
        write(s) {
          geschrieben += s;
        },
        close() {},
      },
    });
    d.querySelector('[data-click="openLogViewer"]').click();
    await takt(0);
    assert.ok(geschrieben.length > 500, 'Das Fenster bekommt kein Markup');
    const { JSDOM } = require(path.join(__dirname, '..', 'node_modules', 'jsdom'));
    const fenster = new JSDOM(geschrieben).window.document;
    const skripte = [...fenster.querySelectorAll('script')];
    assert.deepEqual(
      skripte.filter(s => !s.src).map(s => s.textContent.slice(0, 40)),
      [],
      'Inline-<script> blockiert die CSP, die das Fenster vom Öffner erbt',
    );
    assert.ok(
      skripte.some(s => /\/js\/logviewer\.js/.test(s.src)),
      'logviewer.js fehlt',
    );
    // Die Daten stehen im Attribut, abgesichert: Das JSON mit seinen Anführungszeichen kommt heil an.
    assert.equal(fenster.body.dataset.base, 'http://localhost');
    assert.equal(typeof JSON.parse(fenster.body.dataset.i18n)['log.entries'], 'string');
    assert.equal(fenster.body.hasAttribute('data-auth'), false, 'Die Sitzung meldet das Fenster an, kein Token');
  } finally {
    w.close();
  }
});
