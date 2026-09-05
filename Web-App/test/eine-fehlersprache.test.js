/**
 * Der Server antwortet in der Sprache, die der Anfragende ZEIGT.
 *
 * ── Der Befund (Nachtrag 130) ───────────────────────────────────────────────
 *
 * Beide Oberflächen sind zweisprachig — die Webapp mit 724 Übersetzungszeilen,
 * die Android-App mit 452 Texten. Der Server, der sie füttert, sprach nur
 * Deutsch: GEMESSEN 125 Stellen mit fester Zeichenkette, 80 verschiedene Texte,
 * davon 54 eindeutig deutsch. Und beide Clients zeigen sie unverändert an.
 *
 * Ein englischsprachiger Nutzer hatte damit eine vollständig englische
 * Oberfläche — bis etwas schiefging.
 *
 * ── Was hier geprüft wird ───────────────────────────────────────────────────
 *
 * GESUCHT, nicht aufgezählt: Jede `.ts` unter routes/ und utils/ wird gelesen.
 * Wer eine feste Zeichenkette als `error:` verschickt, steht in ERLAUBT — mit
 * dem Grund. Eine neue Route erbt die Regel damit von selbst.
 *
 * Und: Jeder Eintrag der Tabelle muss BEIDE Sprachen haben, und die
 * Platzhalter müssen in beiden dieselben sein — sonst steht in der einen
 * Sprache ein `{name}` auf dem Bildschirm.
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
  'jobs/csvImportWorker.ts':
    'Geht per IPC an den Elternprozess und landet im Serverprotokoll, nicht in einer Oberfläche.',
  'utils/financeCalc.ts':
    'Ein Merkmal des Preisergebnisses, an dem der Preis-Job „übersprungen" von „Fehler" ' +
    'unterscheidet — wird nirgends angezeigt.',
  'routes/api_v1/admin.ts':
    'Ein Diagnosewert der Erreichbarkeitsprobe wie ein HTTP-Status ("timeout"), kein Satz.',
  'utils/fehlerTexte.ts':
    'Die Tabelle selbst.',
};

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
    ...tsDateien(path.join(ROOT, 'utils')).map(([r, p]) => ['' + r, p]),
    ...tsDateien(path.join(ROOT, 'jobs')).map(([r, p]) => [r, p]),
  ];
  assert.ok(dateien.length >= 30,
    `Nur ${dateien.length} Dateien gefunden — dann prüft der Rest nichts.`);

  const verstoesse = [];
  for (const [rel, voll] of dateien) {
    // Der Schlüssel in ERLAUBT ist der Pfad ab Web-App/ — hier zusammensetzen.
    const unterOrdner = path.relative(ROOT, voll).split(path.sep).join('/');
    if (unterOrdner in ERLAUBT) continue;
    const src = fs.readFileSync(voll, 'utf8')
      .split('\n').filter(z => !z.trimStart().startsWith('//') && !z.trimStart().startsWith('*')).join('\n');
    // KEIN Backtick und KEIN Zeilenumbruch im Text: Der erste Entwurf nahm
    // beides und lief damit über Zeilenenden hinweg — er meldete sechs Stellen,
    // an denen `error:` mitten in einem PROTOKOLLTEXT steht
    // (`console.error(\`[pdf] error: \`, e.message)`). Sechs Fehlalarme für
    // null echte Funde; genau die Sorte Prüfung, die abgeschaltet statt
    // befolgt wird.
    for (const m of src.matchAll(/error:\s*(['"])((?:[^\\\n]|\\.)*?)\1/g)) {
      const text = m[2];
      // Variablen und leere Werte sind keine Sätze.
      if (!text || text.length < 4) continue;
      if (/^[a-z_.]+$/.test(text)) continue;
      const zeile = src.slice(0, m.index).split('\n').length;
      verstoesse.push(`${unterOrdner}:${zeile}  ${text.slice(0, 60)}`);
    }
  }

  assert.deepEqual(verstoesse, [],
    'Diese Stellen schicken einen festen Satz statt sendeFehler(req, res, …, code):\n  ' +
    verstoesse.join('\n  ') +
    '\nDamit steht die Meldung nur in einer Sprache da — in einer Oberfläche, ' +
    'die es in zweien gibt.');
});

test('jeder Eintrag der Tabelle hat beide Sprachen und dieselben Platzhalter', () => {
  const src = fs.readFileSync(path.join(ROOT, 'utils', 'fehlerTexte.ts'), 'utf8');
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
  const web = fs.readFileSync(path.join(ROOT, 'public', 'js', '01-core.js'), 'utf8');
  assert.match(web, /'Accept-Language'\s*:\s*LANG/,
    'Die Webapp schickt Accept-Language nicht mit (public/js/01-core.js, api()).');

  const app = fs.readFileSync(
    path.join(ROOT, '..', 'Android-App', 'app', 'src', 'main', 'java', 'ch',
              'brickinventoryapp', 'di', 'AppModule.kt'), 'utf8');
  assert.match(app, /header\("Accept-Language",/,
    'Die Android-App schickt Accept-Language nicht mit (di/AppModule.kt, Interceptor).');
  assert.match(app, /R\.string\.lang_code/,
    'Die App leitet die Sprache nicht aus ihren Ressourcen ab — dann sagt sie ' +
    'nicht, was sie wirklich zeigt.');
});
