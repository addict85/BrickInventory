/**
 * Der Preisalarm wird beim TIPPEN gespeichert — aber nur einmal.
 *
 * ── Die Gegenprobe läuft MIT ────────────────────────────────────────────────
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const jsdom = require(path.join(ROOT, 'node_modules', 'jsdom'));
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const { BUENDEL, stelleBuendelSicher } = require('./helpers/buendel');
stelleBuendelSicher();
const BUNDLE = fs.readFileSync(BUENDEL, 'utf8');
const ADMIN = fs.readFileSync(path.join(ROOT, 'public', 'js', 'detailfelder.js'), 'utf8');

/**
 * Die drei Bedienelemente des Alarms — AUS DEM ECHTEN QUELLTEXT geschnitten.
 *
 * Genau das stand hier zuerst, und die Gegenprobe dazu blieb GRÜN: Ich habe
 * die Verdrahtung im Quelltext von `data-input="alarmGetippt"` auf das alte
 * `data-change="speichereAlarm"` zurückgedreht — also genau der Fehler, den
 * diese Datei melden soll —, und der Prüflauf merkte nichts. Er hatte sein
 * eigenes Markup gebaut und prüfte damit eine Verdrahtung, die es im Baum
 * gar nicht mehr gab.
 */
function alarmMarkup(sn) {
  // Ab dem ZUSTANDSFELD, nicht ab der Richtung: Seit der Alarm auch für
  // „gebraucht" gilt, steht das Zustandsfeld davor, und alarmZustand() liest
  // es. Ohne das Feld fiele der Prüfstand still auf „neu" zurück und prüfte
  // eine Oberfläche, die es so nicht gibt.
  const i = ADMIN.indexOf('<select id="${p}-alert-cond"');
  const j = ADMIN.indexOf('id="${p}-alert-state"');
  assert.ok(i > 0 && j > i, 'Das Alarm-Markup steht nicht mehr, wo erwartet');
  const roh = ADMIN.slice(i, ADMIN.indexOf('</span>', j) + 7);
  return (
    roh
      // Der Präfix des Set-Dialogs. Er steht in alarmBlock() als ${p}; hier
      // wird daraus, was zur Laufzeit dort steht.
      .replace(/\$\{p\}/g, 'm')
      .replace(/\$\{(?:escJs\()?sn\)?\}/g, sn)
      // Die Beschriftungen kommen aus der Übersetzung; hier zählt nur die
      // Verdrahtung, nicht der Text.
      .replace(/\$\{[^}]*\}/g, 'x')
  );
}

/** Die Ruhezeit aus detailfelder.js — hier nur, um DARÜBER und DARUNTER zu takten. */
const RUHE = 800;

/** Ein Fenster mit geladenem Bündel und dem Alarm-Markup des Detailfensters. */
function fenster() {
  const vc = new jsdom.VirtualConsole();
  const meldungen = [];
  vc.on('warn', (...a) => meldungen.push(['warn', ...a].join(' ')));
  vc.on('error', (...a) => meldungen.push(['error', ...a].join(' ')));
  const dom = new jsdom.JSDOM(HTML, {
    runScripts: 'outside-only',
    url: 'http://localhost/',
    virtualConsole: vc,
  });
  const w = dom.window;
  const rufe = [];
  w.fetch = async (u, o = {}) => {
    // Die Startabfrage gehört nicht zur Messung.
    if (!String(u).includes('startup-status')) rufe.push(`${o.method || 'GET'} ${u}`);
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ success: true, alerts: [], orte: [], alert: { condition: 'N', ausgeloest: false } }),
    };
  };
  w.eval(BUNDLE);

  const d = w.document.createElement('div');
  d.innerHTML = alarmMarkup('10179-1');
  w.document.body.appendChild(d);
  // schliesse(): OHNE das bleibt der Prüflauf hängen. startApp() im Bündel
  // fragt /api/v1/startup-status im Sekundentakt ab, und dieser Zeitgeber
  // hält den Node-Prozess am Leben, lange nachdem der Test fertig ist.
  return { w, rufe, meldungen, feld: w.document.getElementById('m-alert-val'), schliesse: () => w.close() };
}

const { warte } = require('./helpers/zeit');

/** „249.90" Zeichen für Zeichen, mit [takt] ms zwischen den Anschlägen. */
async function tippe(f, takt, text = '249.90') {
  for (let i = 1; i <= text.length; i++) {
    f.feld.value = text.slice(0, i);
    f.feld.dispatchEvent(new f.w.Event('input', { bubbles: true }));
    await warte(takt);
  }
  await warte(RUHE * 2);
}

test('Tippen speichert — und die Ruhezeit macht daraus EINE Anfrage', async () => {
  const schnell = fenster();
  await tippe(schnell, 40);
  assert.deepEqual(schnell.meldungen, [], 'Es gab Meldungen in der Konsole');

  // 1. Es wird überhaupt gespeichert — das war Marcos Befund.
  assert.ok(schnell.rufe.length >= 1, 'Tippen hat gar nichts ausgelöst — genau der gemeldete Fehler');

  // 2. Und zwar einmal, nicht je Zeichen.
  const langsam = fenster();
  await tippe(langsam, RUHE + 200);
  assert.ok(
    langsam.rufe.length > schnell.rufe.length,
    `Die Ruhezeit ändert nichts: schnell ${schnell.rufe.length}, langsam ` +
      `${langsam.rufe.length}. Ohne diesen Abstand misst der Prüfstand nur sich selbst.`,
  );
  assert.equal(
    schnell.rufe.length,
    1,
    `Schnelles Tippen ergab ${schnell.rufe.length} Anfragen: ${schnell.rufe.join(' | ')}`,
  );

  // 3. Die letzte Zahl gewinnt — nicht die Zwischenstände „2" oder „24".
  //    Genau die wären ohne Ruhezeit übrig geblieben, und eine Schwelle bei 2
  //    meldet sofort.
  assert.match(
    schnell.rufe[0],
    /^PUT .*\/sets\/10179-1\/alert$/,
    `Gespeichert wurde nicht per PUT: ${schnell.rufe[0]}`,
  );
  schnell.schliesse();
  langsam.schliesse();
});

test('die Antwort schreibt NICHT ins Feld zurück', async () => {
  // Der Grund steht an zeigeAlarmMerker(): Wer „249.90" tippt, hat nach der
  // Ruhezeit hinter „249.9" vielleicht schon die letzte Null gesetzt. Ein
  // Nachladen machte daraus wieder „249.9" und frässe das Zeichen weg.
  const f = fenster();
  await tippe(f, 40);
  assert.equal(f.feld.value, '249.90', 'Das Feld wurde überschrieben');
  assert.deepEqual(
    f.rufe.filter(r => r.startsWith('GET')),
    [],
    'Nach dem Speichern wurde der Alarm neu geladen — das fasst das Feld an',
  );
  f.schliesse();
});

test('ein geleertes Feld löscht', async () => {
  // Die natürliche Geste, einen Alarm loszuwerden. Ein eigener Knopf daneben
  // wäre ein zweiter Weg für dieselbe Absicht.
  const f = fenster();
  f.feld.value = '';
  f.feld.dispatchEvent(new f.w.Event('input', { bubbles: true }));
  await warte(RUHE * 2);
  assert.equal(f.rufe.length, 1, `Anfragen: ${f.rufe.join(' | ')}`);
  assert.match(f.rufe[0], /^DELETE .*\/alert\?condition=N$/, `Ein leeres Feld löschte nicht: ${f.rufe[0]}`);
  f.schliesse();
});
