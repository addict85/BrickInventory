/**
 * Der Server antwortet in der Sprache, die der Anfragende ZEIGT.
 *
 * Gegenproben (10.11.2026 gemessen, je einzeln, zurückgenommen):
 *   A  im deutschen Text von einladungen_zu_viele `{n}` durch `n` ersetzt → rot:
 *      „jeder Eintrag der Tabelle hat beide Sprachen und dieselben Platzhalter“
 *   B  in api() (api.js) den Kopf Accept-Language gestrichen (Bündel neu gebaut)
 *      → rot: „die Webapp sagt dem Server, welche Sprache sie zeigt“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/** Wo eine feste Zeichenkette bleiben DARF — und warum. Zurzeit nirgends. */
/** @type {Record<string, string>} */
const ALLOWED = {};

/** Alle .ts unter den angegebenen Ordnern, auch in Unterordnern. */
function tsFiles(dir, praefix = '') {
  const gefunden = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) gefunden.push(...tsFiles(path.join(dir, e.name), praefix + e.name + '/'));
    else if (e.name.endsWith('.ts')) gefunden.push([praefix + e.name, path.join(dir, e.name)]);
  }
  return gefunden;
}

test('keine Route verschickt einen festen Fehlersatz', () => {
  const dateien = [
    ...tsFiles(path.join(ROOT, 'routes')).map(([r, p]) => [r, p]),
    ...tsFiles(path.join(ROOT, 'src')).map(([r, p]) => [r, p]),
    ...tsFiles(path.join(ROOT, 'jobs')).map(([r, p]) => [r, p]),
  ];
  assert.ok(dateien.length >= 30, `Nur ${dateien.length} Dateien gefunden — dann prüft der Rest nichts.`);

  const violations = [];
  const gebraucht = new Set();
  for (const [, voll] of dateien) {
    // Der Schlüssel in ALLOWED ist der Pfad ab Web-App/ — hier zusammensetzen.
    const belowFolder = path.relative(ROOT, voll).split(path.sep).join('/');
    const src = fs
      .readFileSync(voll, 'utf8')
      .split('\n')
      .filter(z => !z.trimStart().startsWith('//') && !z.trimStart().startsWith('*'))
      .join('\n');
    // KEIN Backtick und KEIN Zeilenumbruch im Text: Der erste Entwurf nahm
    // beides und lief damit über Zeilenenden hinweg — er meldete sechs Stellen,
    // an denen `error:` mitten in einem PROTOKOLLTEXT steht
    // (`console.error(\`[pdf] error: \`, e.message)`). Sechs Fehlalarme für …
    for (const m of src.matchAll(/error:\s*(['"])((?:[^\\\n]|\\.)*?)\1/g)) {
      const text = m[2];
      // Variablen und leere Werte sind keine Sätze.
      if (!text || text.length < 4) continue;
      if (/^[a-z_.]+$/.test(text)) continue;
      const zeile = src.slice(0, m.index).split('\n').length;
      // Eine erlaubte Datei wird trotzdem DURCHSUCHT — nur landet ihr Treffer
      // nicht in den Verstoessen, sondern belegt, dass die Ausnahme noch
      // gebraucht wird. Ueberspringt man sie stattdessen gleich, kann ihr
      // Eintrag jahrelang stehen bleiben, ohne noch etwas zu beschreiben.
      if (belowFolder in ALLOWED) gebraucht.add(belowFolder);
      else violations.push(`${belowFolder}:${zeile}  ${text.slice(0, 60)}`);
    }
  }

  // Hier stand `src/infra/errorTexts.ts` mit der Begruendung „Die Tabelle
  // selbst." — und die Datei traf das Muster gar nicht: Sie fuehrt ihre Texte
  // als `{ de: '…', en: '…' }`, nie als `error: '…'`. Der Eintrag verbarg
  // also nichts, nahm aber ausgerechnet die Datei, in der ALLE Fehlertexte
  // stehen, von dieser Pruefung aus. Damit das nicht wiederkommt:
  const veraltet = Object.keys(ALLOWED)
    .filter(k => !gebraucht.has(k))
    .sort();
  assert.deepEqual(
    veraltet,
    [],
    'Diese Eintraege in ALLOWED beschreiben nichts mehr:\n  ' +
      veraltet.join('\n  ') +
      '\nDie Datei enthaelt keinen festen Fehlersatz (mehr). Der Eintrag nimmt sie ' +
      'trotzdem von der Pruefung aus — raus damit.',
  );

  assert.deepEqual(
    violations,
    [],
    'Diese Stellen schicken einen festen Satz statt sendError(req, res, …, code):\n  ' +
      violations.join('\n  ') +
      '\nDamit steht die Meldung nur in einer Sprache da — in einer Oberfläche, ' +
      'die es in zweien gibt.',
  );
});

test('jeder Eintrag der Tabelle hat beide Sprachen und dieselben Platzhalter', () => {
  // Ein fehlender Platzhalter heisst, dass in einer Sprache „{name}" auf dem Bildschirm steht.
  const { FEHLER, errorText } = require('./helpers/sources').buildAndRequire()('src/infra/errorTexts.js');
  const codes = Object.keys(FEHLER);
  assert.ok(codes.length >= 60, `Nur ${codes.length} Einträge — greift die Tabelle noch?`);
  const skewed = [];
  for (const code of codes) {
    const vars = {};
    for (const sprache of ['de', 'en']) {
      if (!String(FEHLER[code][sprache] || '').trim()) skewed.push(`${code}: ${sprache} fehlt`);
      for (const [, n] of String(FEHLER[code][sprache] || '').matchAll(/\{(\w+)\}/g)) vars[n] = `«${n}»`;
    }
    // Mit allen Platzhaltern beider Sprachen gefüllt, bleibt in keiner eine Klammer stehen.
    for (const sprache of ['de', 'en']) {
      const text = errorText(code, sprache, vars);
      if (/\{\w+\}/.test(text)) skewed.push(`${code}/${sprache}: ${text}`);
      for (const n of Object.keys(vars)) if (!text.includes(`«${n}»`)) skewed.push(`${code}/${sprache}: {${n}} fehlt`);
    }
  }
  assert.deepEqual(skewed, []);
});

test('die Webapp sagt dem Server, welche Sprache sie zeigt', async () => {
  // Ohne diesen Kopf fiele der Server auf Deutsch zurück, und die Tabelle oben wäre wirkungslos.
  const { openUi } = require('./helpers/ui');
  for (const sprache of ['en', 'de']) {
    const { w, aufrufe } = await openUi({}, { sprache });
    try {
      const api = aufrufe.filter(a => a.url.includes('/api/v1/'));
      assert.ok(api.length >= 5, `nur ${api.length} Anfragen`);
      assert.deepEqual(
        api.filter(a => a.headers['Accept-Language'] !== sprache).map(a => a.url),
        [],
        `ohne Sprache ${sprache}`,
      );
    } finally {
      w.close();
    }
  }
});
