/**
 * Build-Werkzeuge: eine Fassung, ein Weg.
 *
 * ── Woher der Test kommt ────────────────────────────────────────────────────
 * Die Build-Skripte riefen esbuild über `npx --yes esbuild@<Version>` auf. Das
 * stammte aus der Zeit vor der devDependency und hatte zwei Folgen:
 *
 *   • npx kostet pro Aufruf mehrere hundert Millisekunden Startzeit. Da
 *     build-ts.js esbuild EINMAL JE DATEI startete (58 Dateien), summierte sich
 *     das — auf einem Raspberry Pi so weit, dass neun Testdateien in die
 *     60-Sekunden-Grenze des Test-Runners liefen, ohne dass inhaltlich etwas
 *     falsch war.
 *   • Die fest verdrahtete Version konnte von der in package.json abweichen.
 *     Dann baute derselbe Befehl je nach Umgebung mit unterschiedlichen
 *     Fassungen.
 *
 * Beides ist behoben; dieser Test hält es fest.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('die Build-Skripte bevorzugen das lokal installierte esbuild', () => {
  for (const f of ['scripts/build-ts.js', 'scripts/build-frontend.js']) {
    const src = read(f);
    assert.match(src, /node_modules', '\.bin'/,
      `${f}: nutzt nicht das lokale esbuild — npx kostet pro Aufruf Startzeit`);
  }
});

test('build-ts.js startet esbuild genau einmal, nicht je Datei', () => {
  const src = read('scripts/build-ts.js');
  // Ein Aufruf mit --outdir/--outbase statt einer Schleife mit --outfile.
  assert.match(src, /--outbase=/, 'Ohne --outbase geht die Verzeichnisstruktur verloren');
  assert.doesNotMatch(src, /for \(const tsFile of files\) \{[\s\S]{0,400}execFileSync/,
    'esbuild darf nicht je Datei gestartet werden');
});

test('die npx-Rückfallversion stimmt mit package.json überein', () => {
  const pkg = JSON.parse(read('package.json'));
  const want = (pkg.devDependencies.esbuild || '').replace(/^[^0-9]*/, '');
  assert.ok(want, 'esbuild fehlt in den devDependencies');
  for (const f of ['scripts/build-ts.js', 'scripts/build-frontend.js']) {
    const m = read(f).match(/const ESBUILD_VERSION = '([^']+)'/);
    assert.ok(m, `${f}: ESBUILD_VERSION nicht gefunden`);
    assert.equal(m[1], want,
      `${f}: ${m[1]} weicht von package.json (${want}) ab — derselbe Befehl bauete sonst je nach Umgebung anders`);
  }
});

test('Tests bauen dist/ nicht neu, wenn es aktuell ist', () => {
  const src = read('test/helpers/sources.js');
  assert.match(src, /function distIsFresh/,
    'Ohne diese Prüfung baut JEDE Testdatei den kompletten Baum erneut — jede läuft in einem eigenen Prozess');
});

test('das Runtime-Stage führt keine npm-Skripte aus', () => {
  // ── Woher dieser Test kommt ─────────────────────────────────────────────
  // Im Runtime-Stage stand kurzzeitig `npm ci --omit=dev`. Der Docker-Build
  // brach damit ab: npm führt dabei den postinstall-Hook aus
  // (scripts/bump-version.js), und scripts/ wird in dieses Stage nie kopiert —
  // "Cannot find module '/app/scripts/bump-version.js'".
  //
  // Der Fehler ist nur im echten Docker-Build sichtbar, nicht in Typecheck oder
  // Testsuite. Deshalb die Prüfung hier: Nach dem `FROM` des zweiten Stages
  // darf kein npm-Befehl mehr stehen, der Skripte auslösen kann.
  const df = read('Dockerfile');
  const stages = df.split(/^FROM /m);
  assert.ok(stages.length >= 3, 'Der Dockerfile hat keine zwei Stages mehr');
  const runtime = stages[stages.length - 1];
  assert.doesNotMatch(runtime, /RUN\s+npm\s+(ci|install|prune)(?![^\n]*--ignore-scripts)/,
    'Im Runtime-Stage darf kein npm-Befehl ohne --ignore-scripts laufen — scripts/ existiert dort nicht');
});

test('devDependencies landen nicht im Laufzeit-Image', () => {
  // esbuild, typescript, jsdom und tsx werden nur zum Bauen gebraucht. Ohne
  // Bereinigung wandern sie mit node_modules ins Image — unnötige Grösse und
  // unnötige Angriffsfläche.
  const df = read('Dockerfile');
  assert.match(df, /npm prune --omit=dev/,
    'Ohne prune enthält das übernommene node_modules auch die devDependencies');
  // prune muss NACH dem Frontend-Build stehen, sonst fehlt esbuild dort.
  assert.ok(df.indexOf('npm prune --omit=dev') > df.indexOf('build-frontend.js'),
    'prune läuft zu früh — esbuild wird für den Frontend-Build noch gebraucht');
});

test('compose.yaml mountet nichts mehr nach public/', () => {
  // ── Woher dieser Test kommt ─────────────────────────────────────────────
  // Nach der Umstellung der Bildablage auf data/images/ (utils/appPaths.ts)
  // blieb in compose.yaml die Zeile `./images:/app/public/images/sets` stehen.
  // Der Code schrieb dort längst nicht mehr hin — der Ordner ./images blieb
  // trotzdem neben ./data liegen und sah aus, als wäre die Umstellung nur halb
  // passiert.
  //
  // Zweiter Grund: public/ ist seit dem dist/-Umbau reiner, unveränderlicher
  // Build-Inhalt. Ein Schreib-Mount hinein hebelt das auf.
  const compose = read('compose.yaml');
  const mounts = [...compose.matchAll(/^\s*-\s*([^\s:#]+):([^\s:#]+)/gm)].map(m => m[2]);
  const intoPublic = mounts.filter(t => t.startsWith('/app/public'));
  assert.deepEqual(intoPublic, [],
    `Mount nach public/: ${intoPublic.join(', ')} — Bilder gehören unter /app/data`);
});

test('das Datenverzeichnis ist als einziges Volume der App gemountet', () => {
  const compose = read('compose.yaml');
  const appMounts = [...compose.matchAll(/^\s*-\s*\.\/[^\s:#]+:(\/app[^\s:#]*)/gm)].map(m => m[1]);
  assert.deepEqual(appMounts, ['/app/data'],
    'Alles Persistente liegt unter data/ — ein zweites Volume erzeugt nur einen verwaisten Ordner');
});

test('keine Build-Artefakte neben den TypeScript-Quellen', () => {
  // ── Woher dieser Test kommt ─────────────────────────────────────────────
  // Ein `node scripts/build-ts.js` OHNE --outdir schreibt die .js in-place —
  // und genau das ist einmal passiert: 61 transpilierte Dateien lagen wieder
  // neben ihren Quellen, nachweislich VERALTET (utils/setMove.js fehlte, der
  // Lauf war also älter als hardened-109). Das ist mehr als Unordnung:
  // server.ts lädt einige Module per require() ohne Endung, und die
  // Node-Auflösung nimmt eine vorhandene .js vor der .ts — `npm run dev`
  // konnte damit stillschweigend veralteten Code ausführen.
  //
  // Erzeugnisse gehören ausschliesslich nach dist/ (Build) und
  // public/js/app.bundle.js (Frontend). Quellverzeichnisse bleiben rein.
  const walk = (dir) => {
    const out = [];
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...walk(rel));
      else out.push(rel);
    }
    return out;
  };
  const offenders = [];
  for (const dir of ['db', 'jobs', 'routes', 'utils']) {
    offenders.push(...walk(dir).filter(f => f.endsWith('.js')));
  }
  if (fs.existsSync(path.join(ROOT, 'server.js'))) offenders.push('server.js');
  assert.deepEqual(offenders, [],
    `In-place-Artefakte im Quellbaum: ${offenders.join(', ')} — ` +
    'löschen und mit `node scripts/build-ts.js --outdir dist` bauen');
});

// ═══════════════════════════════════════════════════════════════════════════
// Typpakete müssen dieselbe Hauptversion beschreiben, die auch läuft
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Der Anlass (Nachtrag 148): `express` stand auf ^4, `@types/express` auf ^5.
 * Beides für sich installierbar, npm meldet nichts — aber tsc prüfte den
 * ganzen Server gegen eine API, die so nicht ausgeliefert wird. Express 5 hat
 * unter anderem die Router- und Fehler-Signaturen geändert; eine Meldung, die
 * ausbleibt, weil der Typ sie in der ANDEREN Hauptversion erlaubt, ist eine
 * Prüfung, die stillschweigend nicht stattfindet.
 *
 * Geprüft werden die Pakete, bei denen Laufzeit und Typen getrennt gepflegt
 * werden. Die Regel ist bewusst auf die HAUPTVERSION beschränkt: Typpakete
 * ziehen in Neben- und Patchversionen eigenständig nach, das ist normal.
 */
test('@types/* beschreiben dieselbe Hauptversion wie das Paket selbst', () => {
  const pkg = JSON.parse(read('package.json'));
  const alle = { ...pkg.dependencies, ...pkg.devDependencies };
  const haupt = s => {
    const m = String(s).match(/(\d+)\./);
    return m ? m[1] : null;
  };

  // ── Freibriefe ────────────────────────────────────────────────────────────
  // Nicht jedes Typpaket zählt mit seiner Bibliothek mit: DefinitelyTyped
  // erhöht die Hauptversion, wenn sich die Deklarationen ändern, nicht wenn die
  // Bibliothek eine neue Fassung bekommt. Für diese beiden ist die aktuelle
  // (und einzige) Fassung des Typpakets die richtige — nachgesehen am
  // 28.08.2026, beide beschreiben die eingesetzte API.
  //
  // Ein Eintrag hier ist eine ENTSCHEIDUNG, kein Stummschalten: Wer ein Paket
  // hinzufügt, muss begründen, warum die Nummern auseinanderlaufen dürfen.
  const freibrief = {
    'archiver':          'Typpaket zählt eigenständig; 8.x ist die aktuelle Fassung für archiver 7',
    'connect-pg-simple': 'Typpaket steht seit Jahren auf 7.x, die Bibliothek bei 10 — DT zählt hier nicht mit',
    'nodemailer':        '8.0.1 ist die NEUESTE veröffentlichte Fassung; für nodemailer 9 gibt es noch keine',
  };

  const abweichend = [];
  let geprueft = 0;
  for (const [name, spanne] of Object.entries(alle)) {
    if (!name.startsWith('@types/')) continue;
    const ziel = name.slice('@types/'.length).replace('__', '/');
    if (!(ziel in alle)) continue;              // @types/node u.ä. haben kein Gegenstück
    geprueft++;
    if (ziel in freibrief) continue;
    const a = haupt(alle[ziel]), b = haupt(spanne);
    if (a && b && a !== b) abweichend.push(`${ziel} ${alle[ziel]} ↔ ${name} ${spanne}`);
  }

  // Gegenrichtung: ein Freibrief für ein Paket, das es nicht mehr gibt, ist
  // toter Ballast und verdeckt beim nächsten Mal die echte Frage.
  const verwaist = Object.keys(freibrief).filter(z => !(z in alle));
  assert.deepEqual(verwaist, [],
    'Freibrief ohne Paket — Eintrag entfernen: ' + verwaist.join(', '));

  assert.ok(geprueft >= 5,
    `Nur ${geprueft} Paare gefunden — heissen die Typpakete noch @types/<paket>?`);
  assert.deepEqual(abweichend, [],
    'Typpaket und Paket in verschiedenen Hauptversionen:\n  ' + abweichend.join('\n  '));
});

// ═══════════════════════════════════════════════════════════════════════════
// strictNullChecks bleibt an — und muss durchlaufen
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Der Schalter war seit der TypeScript-Migration aus und wurde in Nachtrag 148
 * eingeschaltet, nachdem die letzten 93 Meldungen abgeräumt waren.
 *
 * Wieder auszuschalten ist eine Zeile — und beim nächsten Mal, wenn eine
 * Meldung im Weg steht, die naheliegendste. Die Prüfung hier hält beides fest:
 * dass der Schalter steht, UND dass tsc damit tatsächlich sauber ist. Der erste
 * Teil allein wäre wertlos: `strictNullChecks: true` mit zwanzig roten
 * Meldungen ist genau der Zustand, den die alte Begründung im tsconfig zu Recht
 * vermeiden wollte.
 *
 * Der Lauf dauert ein paar Sekunden. Das ist er wert: Er ist die einzige
 * Stelle, an der das Versprechen „tsc ist sauber" auch geprüft wird.
 */
test('tsconfig hat strictNullChecks an und tsc läuft sauber durch', { timeout: 120000 }, () => {
  // JSON mit Kommentaren — tsc erlaubt sie, JSON.parse nicht.
  const roh = read('tsconfig.json').replace(/^\s*\/\/[^\n]*$/gm, '');
  const cfg = JSON.parse(roh);
  assert.equal(cfg.compilerOptions.strictNullChecks, true,
    'strictNullChecks wurde in der tsconfig wieder abgeschaltet');

  const { execFileSync } = require('node:child_process');
  let ausgabe = '';
  try {
    execFileSync(process.execPath,
      [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit'],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    ausgabe = String(e.stdout || '') + String(e.stderr || '');
  }
  const fehler = ausgabe.split('\n').filter(l => /error TS\d+/.test(l));
  assert.deepEqual(fehler.slice(0, 10), [],
    `tsc meldet ${fehler.length} Fehler (erste zehn oben)`);
});

// ═══════════════════════════════════════════════════════════════════════════
// Der CI-Lauf ist die einzige Stelle, an der nichts Altes herumliegt
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Der Anlass (Nachtrag 148/150): Eine Testdatei holte ein Modul aus dist/, das
 * es nach einer Aufteilung nicht mehr gab. Lokal blieb sie grün, weil in einem
 * gewachsenen dist/ noch eine alte Fassung lag — zehn Prüfungen liefen
 * monatelang nicht, ohne dass irgendwo etwas rot war.
 *
 * Dagegen hilft kein weiterer Test, sondern ein Lauf auf einem Rechner ohne
 * Vorgeschichte. Was hier geprüft wird, sind die drei Eigenschaften, ohne die
 * so ein Lauf wertlos wäre — und jede davon ist eine Zeile, die man beim
 * Umbauen des Workflows versehentlich verliert.
 *
 * ── Und wo die Datei liegt, war das Wichtigste ─────────────────────────────
 * Dieser Test zeigte auf `Web-App/.github/workflows/ci.yml` und war grün.
 * GitHub liest Workflows aber AUSSCHLIESSLICH aus `.github/workflows/` im
 * Wurzelverzeichnis; in einem Unterordner ist so eine Datei nur Text.
 * NACHGEMESSEN über die Actions-API: Das Repository kannte drei Workflows,
 * dieser war keiner davon — er ist nie gelaufen.
 *
 * Der Inhalt war also die ganze Zeit bewacht und der Lauf fand nie statt.
 * Dass eine Prüfung grün ist, sagt eben nur etwas über das, worauf sie zeigt.
 * Der Ort selbst wird jetzt in workflow-ort.test.js geprüft.
 */
/**
 * Die Adresse der Test-Datenbank wird NIE ohne Rückfallwert gelesen.
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 * 79 Testdateien setzen oben
 *
 *     process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://…'
 *
 * Genau EINE Stelle las die Variable ohne diesen Rückfall: das Kind-Skript in
 * image-queue-pace-db.test.js, das einen zweiten Prozess startet. Ist
 * TEST_DATABASE_URL nicht gesetzt — und in der Entwicklungsumgebung ist sie es
 * nicht —, bekam das Kind `undefined` und die Verbindung scheiterte.
 *
 * Der rote Untertest war dabei noch das Harmlose. Mehrfach beobachtet: Der
 * Lauf der ganzen Datei brach danach ab mit
 *
 *     Unable to deserialize cloned data due to invalid or unsupported version.
 *
 * Diese Meldung sagt nichts über die Ursache. Sichtbar war nur, dass die Datei
 * nach dem ersten Untertest aufhörte — 2 statt 13 Tests, und niemand sah,
 * welche elf fehlten.
 *
 * ── Warum als Regel und nicht als einzelne Reparatur ────────────────────────
 * Der Rückfallwert ist eine Regel, die 79-mal richtig und einmal falsch
 * dastand. Wer den nächsten Kindprozess baut, schreibt dieselbe Zeile ab.
 *
 * Kommentare raus, BEVOR gesucht wird: Die Erklärung an der reparierten Stelle
 * zitiert die falsche Zeile — ohne das meldete die Regel ihren eigenen
 * Erklärtext.
 */
test('die Adresse der Test-Datenbank hat überall einen Rückfallwert', () => {
  const { ohneKommentare } = require('./helpers/sources');
  const dateien = fs.readdirSync(__dirname).filter(f => f.endsWith('.js'));
  let gelesen = 0;
  const ohneRueckfall = [];
  for (const f of dateien) {
    const src = ohneKommentare(fs.readFileSync(path.join(__dirname, f), 'utf8'));
    for (const m of src.matchAll(/process\.env\.TEST_DATABASE_URL\s*(\|\|)?/g)) {
      gelesen++;
      if (!m[1]) ohneRueckfall.push(`${f}:${src.slice(0, m.index).split('\n').length}`);
    }
  }
  // Selbstbeweis: Findet das Muster nichts, wäre die Liste leer und der Test
  // grün, ohne etwas geprüft zu haben.
  assert.ok(gelesen >= 50, `Nur ${gelesen} Zugriffe auf TEST_DATABASE_URL gefunden — Muster veraltet?`);
  assert.deepEqual(ohneRueckfall, [],
    'Diese Stellen lesen TEST_DATABASE_URL ohne Rückfallwert:\n  ' + ohneRueckfall.join('\n  ') +
    '\nIst die Variable nicht gesetzt, kommt dort undefined an. In einem ' +
    'Kindprozess bricht der ganze Testlauf dann mit einer Meldung ab, die ' +
    'nichts über die Ursache sagt.');
});

/**
 * BEIDE Workflows sagen, was rot war — nicht nur einer.
 *
 * ── Der Anlass ──────────────────────────────────────────────────────────────
 * web-ci.yml schreibt seit Laengerem `::error::`-Annotationen, weil das rohe
 * Protokoll von aussen nicht zu holen ist (die Ablage liegt hinter einer
 * Weiterleitung, die der Proxy mit 403 abweist). android.yml tat das nicht.
 *
 * GEMESSEN an den Laeufen 80 und 81: Beide waren rot, und die einzige
 * Annotation lautete „Process completed with exit code 1". Die Ursache — ein
 * roter Test bzw. ein fehlender Import — war nur zu finden, indem das ganze
 * Protokoll gelesen wurde, zweimal.
 *
 * ── Warum als gemeinsame Regel ──────────────────────────────────────────────
 * „Zwei Apps, gleich gebaut" heisst auch: gleich diagnostizierbar. Eine Regel,
 * die nur den Web-Workflow prueft, laesst genau die Haelfte offen, die man
 * ohnehin schlechter untersuchen kann (Android laesst sich hier nicht bauen).
 *
 * Geprueft wird die WIRKUNG, nicht der Wortlaut: ein Mitschnitt, ein Schritt
 * fuer den Fehlerfall, Annotationen fuer BEIDE Ausgaenge (etwas ist rot / es
 * ist rot, ohne dass ein einzelner Test rot ist) und die Summenzeile.
 */
test('beide Workflows melden, was rot war', () => {
  const wf = path.join(ROOT, '..', '.github', 'workflows');
  for (const datei of ['web-ci.yml', 'android.yml']) {
    const yml = fs.readFileSync(path.join(wf, datei), 'utf8');
    assert.match(yml, /set -o pipefail/,
      `${datei}: Ohne pipefail bestimmt tee den Rueckgabewert — ein roter Lauf ginge als Erfolg durch`);
    assert.match(yml, /tee "\$RUNNER_TEMP\/test\.log"/,
      `${datei}: kein Mitschnitt des Testprotokolls`);
    assert.match(yml, /if:\s*failure\(\)/,
      `${datei}: kein Schritt, der im Fehlerfall laeuft`);
    // Beide Ausgaenge: der erwartete (etwas ist rot) und der unerwartete
    // (rot, ohne dass ein einzelner Test rot ist — ein Uebersetzungsfehler,
    // ein Modul, das nicht laedt). Eine Diagnose, die nur den ersten abdeckt,
    // schweigt genau dann, wenn etwas Unerwartetes passiert.
    const fehler = [...yml.matchAll(/::error title=/g)].length;
    assert.ok(fehler >= 2,
      `${datei}: nur ${fehler} Fehler-Annotation(en) — beide Ausgaenge muessen gemeldet werden`);
    assert.match(yml, /::notice title=Testsumme::/,
      `${datei}: keine Summenzeile — dann sagt nichts, ob ueberhaupt etwas gelaufen ist`);
  }
});

test('der CI-Workflow prüft, was er prüfen soll', () => {
  const p = path.join(ROOT, '..', '.github', 'workflows', 'web-ci.yml');
  assert.ok(fs.existsSync(p), 'Es gibt keinen CI-Workflow mehr');
  const yml = fs.readFileSync(p, 'utf8');

  // 1. REQUIRE_DB. OHNE diese Variable überspringen die Datenbank-Suiten sich
  //    selbst, wenn sie keine Verbindung bekommen — in CI wäre das das
  //    Schlimmste: ein grüner Lauf, der die Hälfte nie ausgeführt hat.
  assert.match(yml, /REQUIRE_DB:\s*'1'/,
    'Ohne REQUIRE_DB=1 überspringt CI stillschweigend alle DB-Suiten');

  // 2. Eine echte Datenbank, und zwar in der Hauptversion aus dem Betrieb.
  const compose = fs.readFileSync(path.join(ROOT, 'compose.yaml'), 'utf8');
  const betrieb = (compose.match(/image:\s*postgres:(\d+)/) || [])[1];
  const ci      = (yml.match(/image:\s*postgres:(\d+)/) || [])[1];
  assert.ok(betrieb && ci, 'Postgres-Abbild nicht auffindbar');
  assert.equal(ci, betrieb,
    `CI prüft gegen PostgreSQL ${ci}, im Betrieb läuft ${betrieb} — ` +
    'Sperren, Indizes und Planerverhalten unterscheiden sich zwischen Hauptversionen');

  // 3. Die vier Schritte, die zusammen die Aussage tragen. `npm ci` statt
  //    `npm install` gehört dazu: nur ersteres scheitert, wenn package.json
  //    und Lockfile auseinanderlaufen.
  //
  //    Gesucht wird im Workflow OHNE seine Kommentarzeilen. Der frühere Anker
  //    war `run:\s*npm test` — direkt hinter dem Schlüsselwort. Er sollte
  //    verhindern, dass die Begründungen im Fliesstext („npm ci statt npm
  //    install") die Prüfung von selbst erfüllen. Er hat aber auch etwas
  //    anderes festgeschrieben: dass der Befehl in DERSELBEN Zeile steht.
  //
  //    Sobald der Testschritt ein mehrzeiliger Block wurde (`set -o pipefail`
  //    davor, `| tee` dahinter, damit ein roter Lauf lesbar bleibt), fand der
  //    Anker nichts mehr und meldete „ohne Tests ist der ganze Lauf sinnlos" —
  //    obwohl die Tests laufen. Kommentare wegzuschneiden erreicht dasselbe
  //    Ziel, ohne die FORM des Schrittes vorzuschreiben.
  const code = yml.split('\n').filter(z => !z.trimStart().startsWith('#')).join('\n');
  for (const [muster, warum] of [
    [/\bnpm ci\b/,          'npm install würde ein abweichendes Lockfile stillschweigend hinnehmen'],
    [/\bnpx tsc --noEmit/,  'ohne Typprüfung sagt der Lauf nichts über strictNullChecks'],
    [/\bnpm run build\b/,   'ohne frischen Build prüft CI womöglich ein altes dist/'],
    [/\bnpm test\b/,        'ohne Tests ist der ganze Lauf sinnlos'],
    [/\bnpm run typecheck:strict/, 'die gestaffelte noImplicitAny-Prüfung fehlt'],
  ]) {
    assert.match(code, muster, `CI-Workflow: ${warum}`);
  }
  // Gegenprobe zur Kommentar-Regel: `npm install` steht NUR im Fliesstext der
  // Begründung. Bliebe es nach dem Wegschneiden übrig, schnitte die Funktion
  // nichts weg — und alles darüber wäre wertlos.
  assert.doesNotMatch(code, /\bnpm install\b/,
    'npm install steht im ausführbaren Teil des Workflows — oder die ' +
    'Kommentarzeilen werden nicht mehr weggeschnitten.');
});

test('eine Pipe im Workflow verliert den Fehlschlag nicht', () => {
  // ── Gemessen, nicht vermutet ──────────────────────────────────────────────
  //
  //     bash -c 'set -e;               (echo x; exit 1) | tee /dev/null' -> 0
  //     bash -c 'set -e -o pipefail;   (echo x; exit 1) | tee /dev/null' -> 1
  //
  // In einer Kette ist der Rückgabewert der des LETZTEN Gliedes. `npm test |
  // tee protokoll` meldet also immer Erfolg, egal wie viele Tests rot sind.
  // GitHub startet `run:`-Blöcke mit `bash -e`, aber OHNE pipefail.
  //
  // Der Testschritt benutzt genau diese Kette, damit ein roter Lauf lesbar
  // bleibt (das Container-Protokoll überdeckt am Ende die `not ok`-Zeilen).
  // Ohne die eine Zeile davor wäre der Preis dafür ein Workflow, der bei
  // gescheiterten Tests grün ist — schlimmer als gar keiner.
  //
  // ── Wonach genau gesucht wird ─────────────────────────────────────────────
  //
  // Nicht nach JEDER Pipe. Der erste Entwurf tat das und meldete sofort einen
  // Fehlalarm: `[ "$X" = "true" ] || fehlt=…` ist ein logisches ODER, und
  // `--jq '.assets[] | select(…)'` ist ein Rohr INNERHALB von jq. Beide sind
  // harmlos, beide enthalten ein `|`.
  //
  // Gefährlich ist die Kette, deren LETZTES Glied nur durchreicht: tee, head,
  // tail, cat. Dort will man den Rückgabewert von LINKS, bekommt aber den von
  // rechts — und der ist bei einem Durchreicher fast immer 0. Bei allen
  // anderen Ketten ist das letzte Glied das, worauf es ankommt.
  const DURCHREICHER = /\|\s*(tee|head|tail|cat)\b/;
  const wf = path.join(ROOT, '..', '.github', 'workflows');
  let geprueft = 0;
  for (const datei of fs.readdirSync(wf).filter(f => /\.ya?ml$/.test(f))) {
    const roh = fs.readFileSync(path.join(wf, datei), 'utf8');
    for (const block of roh.split(/^      - /m).slice(1)) {
      const rumpf = block.split('\n').filter(z => !z.trimStart().startsWith('#')).join('\n');
      if (!/\brun:/.test(rumpf) || !DURCHREICHER.test(rumpf)) continue;
      geprueft++;
      assert.match(rumpf, /set -o pipefail|set -[a-z]*o[a-z]* pipefail/,
        `${datei}: Ein run-Block leitet in einen Durchreicher (tee/head/tail/cat), ` +
        'ohne "set -o pipefail". Der Rückgabewert ist dann dessen — ein ' +
        `Fehlschlag davor geht verloren. Block:\n${rumpf.slice(0, 300)}`);
    }
  }
  // Selbstbeweis: Findet die Suche keinen einzigen solchen Block, prüft die
  // Schleife nichts und wäre trotzdem grün.
  assert.ok(geprueft >= 1, 'Kein run-Block mit Durchreicher gefunden — Muster veraltet?');
});

test('die noImplicitAny-Ausnahmeliste stimmt noch', () => {
  // Das Skript prüft sich selbst in beide Richtungen (neue Schuld / verwaiste
  // Einträge) und wird hier nur ausgeführt, damit ein Verstoss auch dann
  // auffällt, wenn jemand nur `npm test` laufen lässt.
  const { execFileSync } = require('node:child_process');
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'check-noimplicitany.js')],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    assert.fail(String(e.stdout || '') + String(e.stderr || ''));
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Die Node-Version steht an drei Stellen und muss überall dieselbe sein
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Der Anlass (Nachtrag 152): Das Dockerfile lief auf `node:20-alpine`, und der
 * CI-Workflow schrieb `node-version: '20'` mit der Begründung „wie im
 * Dockerfile". Die Begründung war richtig, die Zahl falsch — Node 20 hatte am
 * 30.04.2026 sein Lebensende erreicht und bekam seitdem keine
 * Sicherheits-Patches mehr. Ausgeliefert wurde also eine ungepatchte
 * Laufzeitumgebung, und CI prüfte brav dagegen.
 *
 * Zwei Dinge werden hier festgehalten:
 *
 *   1. Build-Stage, Runtime-Stage und CI nennen DIESELBE Hauptversion. Laufen
 *      sie auseinander, prüft CI etwas anderes als das, was läuft — und zwar
 *      still, weil beide für sich funktionieren.
 *
 *   2. Die Version ist keine, deren Lebensende bekannt ist. Die Liste unten ist
 *      bewusst eine Liste ABGELAUFENER Zeilen und keine Liste erlaubter: Eine
 *      Erlaubnisliste müsste bei jeder neuen Node-Zeile nachgepflegt werden und
 *      würde einen Aufstieg auf 26 als Fehler melden. Eine Sperrliste altert in
 *      die richtige Richtung — sie wird nur ergänzt, wenn wirklich eine Zeile
 *      ausläuft.
 */
test('Dockerfile und CI laufen auf derselben, unterstützten Node-Version', () => {
  const docker = read('Dockerfile');
  // Der Workflow liegt im Wurzelverzeichnis des REPOSITORIES, nicht in
  // Web-App/ — siehe den Absatz im Test darueber.
  const ci     = read('../.github/workflows/web-ci.yml');

  const imBild = [...docker.matchAll(/^FROM node:(\d+)-/gm)].map(m => m[1]);
  assert.ok(imBild.length >= 2,
    `Nur ${imBild.length} FROM node:… im Dockerfile — gibt es die zwei Stufen noch?`);
  assert.equal(new Set(imBild).size, 1,
    `Build- und Runtime-Stage laufen auf verschiedenen Node-Versionen: ${imBild.join(', ')}`);

  const imCi = (ci.match(/node-version:\s*'(\d+)'/) || [])[1];
  assert.ok(imCi, 'Der CI-Workflow legt keine Node-Version fest');
  assert.equal(imCi, imBild[0],
    `CI prüft auf Node ${imCi}, ausgeliefert wird Node ${imBild[0]} — ` +
    'dann sagt ein grüner Lauf nichts über das Image');

  // Abgelaufene Zeilen. Beim Ergänzen bitte das Datum dazuschreiben.
  const abgelaufen = {
    '14': '30.04.2023', '16': '11.09.2023', '18': '30.04.2025', '20': '30.04.2026',
    // Ungerade Zeilen erreichen nie LTS und laufen nach sechs Monaten aus.
    '19': 'nie LTS', '21': 'nie LTS', '23': 'nie LTS', '25': 'nie LTS',
  };
  assert.ok(!(imBild[0] in abgelaufen),
    `Node ${imBild[0]} bekommt seit ${abgelaufen[imBild[0]]} keine Sicherheits-Patches mehr — ` +
    'das ist keine alte Version, sondern eine ungepatchte Laufzeitumgebung');
});

/**
 * @types/node beschreibt dieselbe Node-Hauptversion, die auch läuft.
 *
 * Der Anlass (Nachtrag 153): Beim Wechsel auf Node 26 stand @types/node bereits
 * auf ^26 — zufällig passend, weil `npm update` es kurz vorher hochgezogen
 * hatte. Andersherum wäre es unbemerkt geblieben: Der Übersetzer prüfte dann
 * gegen eine andere Standardbibliothek als die ausgeführte, und ein Aufruf, den
 * es in der laufenden Fassung gar nicht gibt, käme sauber durch.
 *
 * Die allgemeine Regel „Typpaket und Paket in derselben Hauptversion" weiter
 * oben greift hier nicht: `node` ist keine Abhängigkeit in package.json, die
 * Version steht im Dockerfile.
 */
test('@types/node passt zur Node-Version aus dem Dockerfile', () => {
  const imBild = (read('Dockerfile').match(/^FROM node:(\d+)-/m) || [])[1];
  const typen  = (JSON.parse(read('package.json')).devDependencies['@types/node'] || '').match(/(\d+)\./);
  assert.ok(imBild, 'Keine Node-Version im Dockerfile gefunden');
  assert.ok(typen,  '@types/node fehlt in den devDependencies');
  assert.equal(typen[1], imBild,
    `Ausgeliefert wird Node ${imBild}, typgeprüft wird gegen @types/node ${typen[1]} — ` +
    'dann beschreibt der Übersetzer eine andere Standardbibliothek als die laufende');
});
