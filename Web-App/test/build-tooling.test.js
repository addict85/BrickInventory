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
