/**
 * Der Server antwortet in der Sprache, die der Anfragende ZEIGT.
 * Ausführlich: docs/begruendungen/test/eine-fehlersprache.test.js.md#kopf
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/**
 * Wo eine feste Zeichenkette bleiben DARF — und warum.
 *
 * Alle drei sind keine Meldungen an einen Menschen vor einem Bildschirm.
 */
const ERLAUBT = {
  'src/finanzen/rechnung/preise.ts':
    'Ein Merkmal des Preisergebnisses, an dem der Preis-Job „übersprungen" von „Fehler" ' +
    'unterscheidet — wird nirgends angezeigt.',
};

// Drei Eintraege standen hier und beschrieben nichts mehr
// Ausführlich: docs/begruendungen/test/eine-fehlersprache.test.js.md#stelle

/** Alle .ts unter den angegebenen Ordnern, auch in Unterordnern. */
function tsDateien(dir, praefix = '') {
  const gefunden = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) gefunden.push(...tsDateien(path.join(dir, e.name), praefix + e.name + '/'));
    else if (e.name.endsWith('.ts')) gefunden.push([praefix + e.name, path.join(dir, e.name)]);
  }
  return gefunden;
}

test('keine Route verschickt einen festen Fehlersatz', () => {
  const dateien = [
    ...tsDateien(path.join(ROOT, 'routes')).map(([r, p]) => [r, p]),
    ...tsDateien(path.join(ROOT, 'src')).map(([r, p]) => [r, p]),
    ...tsDateien(path.join(ROOT, 'jobs')).map(([r, p]) => [r, p]),
  ];
  assert.ok(dateien.length >= 30,
    `Nur ${dateien.length} Dateien gefunden — dann prüft der Rest nichts.`);

  const verstoesse = [];
  const gebraucht = new Set();
  for (const [rel, voll] of dateien) {
    // Der Schlüssel in ERLAUBT ist der Pfad ab Web-App/ — hier zusammensetzen.
    const unterOrdner = path.relative(ROOT, voll).split(path.sep).join('/');
    const src = fs.readFileSync(voll, 'utf8')
      .split('\n').filter(z => !z.trimStart().startsWith('//') && !z.trimStart().startsWith('*')).join('\n');
    // KEIN Backtick und KEIN Zeilenumbruch im Text: Der erste Entwurf nahm
    // beides und lief damit über Zeilenenden hinweg — er meldete sechs Stellen,
    // an denen `error:` mitten in einem PROTOKOLLTEXT steht
    // (`console.error(\`[pdf] error: \`, e.message)`). Sechs Fehlalarme für …
    // Ausführlich: docs/begruendungen/test/eine-fehlersprache.test.js.md#for-stelle
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
      if (unterOrdner in ERLAUBT) gebraucht.add(unterOrdner);
      else verstoesse.push(`${unterOrdner}:${zeile}  ${text.slice(0, 60)}`);
    }
  }

  // Hier stand `src/infra/fehlerTexte.ts` mit der Begruendung „Die Tabelle
  // selbst." — und die Datei traf das Muster gar nicht: Sie fuehrt ihre Texte
  // als `{ de: '…', en: '…' }`, nie als `error: '…'`. Der Eintrag verbarg
  // also nichts, nahm aber ausgerechnet die Datei, in der ALLE Fehlertexte
  // stehen, von dieser Pruefung aus. Damit das nicht wiederkommt:
  const veraltet = Object.keys(ERLAUBT).filter(k => !gebraucht.has(k)).sort();
  assert.deepEqual(veraltet, [],
    'Diese Eintraege in ERLAUBT beschreiben nichts mehr:\n  ' + veraltet.join('\n  ') +
    '\nDie Datei enthaelt keinen festen Fehlersatz (mehr). Der Eintrag nimmt sie ' +
    'trotzdem von der Pruefung aus — raus damit.');

  assert.deepEqual(verstoesse, [],
    'Diese Stellen schicken einen festen Satz statt sendeFehler(req, res, …, code):\n  ' +
    verstoesse.join('\n  ') +
    '\nDamit steht die Meldung nur in einer Sprache da — in einer Oberfläche, ' +
    'die es in zweien gibt.');
});

test('jeder Eintrag der Tabelle hat beide Sprachen und dieselben Platzhalter', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/infra/fehlerTexte.ts'), 'utf8');
  const tabelle = src.slice(src.indexOf('export const FEHLER'), src.indexOf('} as const;'));

  const eintraege = [...tabelle.matchAll(
    /(\w+):\s*\{\s*de:\s*'((?:[^'\\]|\\.)*)',\s*\n?\s*en:\s*'((?:[^'\\]|\\.)*)'\s*\}/g)];

  // Selbstbeweis: Ohne Treffer wäre die Schleife darunter leer und der Test
  // grün, ohne einen einzigen Eintrag gesehen zu haben.
  assert.ok(eintraege.length >= 60,
    `Nur ${eintraege.length} Einträge erkannt — Muster veraltet? Die Tabelle hat deutlich mehr.`);

  const schief = [];
  for (const [, code, de, en] of eintraege) {
    if (!de.trim()) schief.push(`${code}: deutscher Text fehlt`);
    if (!en.trim()) schief.push(`${code}: englischer Text fehlt`);
    const pDe = (de.match(/\{\w+\}/g) || []).sort().join(',');
    const pEn = (en.match(/\{\w+\}/g) || []).sort().join(',');
    if (pDe !== pEn) {
      schief.push(`${code}: Platzhalter unterschiedlich — de {${pDe}} gegen en {${pEn}}`);
    }
  }
  assert.deepEqual(schief, [],
    'Diese Einträge sind schief:\n  ' + schief.join('\n  ') +
    '\nEin fehlender Platzhalter bedeutet, dass in einer Sprache „{name}" auf ' +
    'dem Bildschirm steht.');
});

test('beide Oberflächen sagen dem Server, welche Sprache sie zeigen', () => {
  // Ohne diesen Kopf nützt die Tabelle nichts — der Server fiele auf Deutsch
  // zurück, und alles oben wäre wirkungslos.
  const web = fs.readFileSync(path.join(ROOT, 'public', 'js', '01-api.js'), 'utf8');
  assert.match(web, /'Accept-Language'\s*:\s*LANG/,
    'Die Webapp schickt Accept-Language nicht mit (public/js/01-api.js, api()).');

  const app = fs.readFileSync(
    path.join(__dirname, '..', '..', 'Android-App', 'core-data', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'data', 'di', 'ServerClient.kt'), 'utf8');
  assert.match(app, /header\("Accept-Language",/,
    'Die Android-App schickt Accept-Language nicht mit (data/di/ServerClient.kt, Interceptor).');
  assert.match(app, /R\.string\.lang_code/,
    'Die App leitet die Sprache nicht aus ihren Ressourcen ab — dann sagt sie ' +
    'nicht, was sie wirklich zeigt.');
});
