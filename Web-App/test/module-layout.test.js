/**
 * Wo Module liegen — und dass ein API-Name kein Pfad ist.
 *
 * ── Warum es diese Datei gibt (Nachtrag 126) ────────────────────────────────
 *
 * Beim Umzug von rebrickable.ts und brickset.ts aus routes/ nach clients/ habe
 * ich die Verweise per Textersetzung umgebogen. Der Ausdruck traf auch das hier:
 *
 *     checkAndIncrementRateLimit('rebrickable')   →  ('../clients/rebrickable')
 *     getRateLimitStatus('brickset')              →  ('../../clients/brickset')
 *
 * Das sind KEINE Modulpfade, sondern die Schlüssel der Tageskontingente. Unter
 * einem neuen Schlüssel hätte jede API bei null angefangen zu zählen — die
 * Zählung wäre gespalten worden, und zwar lautlos: kein Absturz, keine
 * Fehlermeldung, nur ein Kontingent, das plötzlich nie mehr erreicht wird.
 *
 * Neun Stellen in vier Dateien waren betroffen. Gefunden hat es ein Test, der
 * zufällig einen dieser Aufrufe im Wortlaut prüfte; beim Zurückdrehen habe ich
 * dann prompt zu breit ersetzt und drei echte Modulpfade mitgenommen (500er:
 * „Cannot find module 'rebrickable'"). Beide Fehler sind dieselbe Sorte:
 * derselbe Text, zwei völlig verschiedene Bedeutungen.
 *
 * Diese Datei hält beide Seiten fest.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { ohneKommentare } = require('./helpers/sources');

/** Alle Serverquellen (ohne Tests, node_modules, dist). */
/**
 * Die zu prüfenden Quellordner — AUS DEM BAUSKRIPT gelesen, nicht hier
 * abgeschrieben.
 *
 * ── Warum (Nachtrag 139) ────────────────────────────────────────────────────
 * Hier stand eine feste Liste ['db','utils','routes','jobs','clients'].
 * `startup/` kam in Nachtrag 134 dazu — und fehlte hier. Sämtliche Prüfungen
 * dieser Datei übersprangen den Ordner also stillschweigend, darunter „jedes
 * späte require() zeigt auf eine Datei, die es gibt".
 *
 * Genau dort standen zehn kaputte `require('./jobs/…')`, und weil sie in
 * setTimeout und .catch(() => {}) stecken, lief KEIN Hintergrundjob mehr an —
 * ohne eine einzige Fehlermeldung. Marco hat es gemeldet, nicht der Test.
 *
 * Eine zweite Liste neben SRC_DIRS ist genau die Sorte Wahrheit, die
 * auseinanderläuft. Jetzt gibt es nur noch eine.
 */
function srcDirs() {
  const build = fs.readFileSync(path.join(ROOT, 'scripts', 'build-ts.js'), 'utf8');
  const zeile = build.match(/const SRC_DIRS = \[([^\]]*)\]/);
  assert.ok(zeile, 'SRC_DIRS im Bauskript nicht gefunden');
  const dirs = [...zeile[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  assert.ok(dirs.length >= 5, `nur ${dirs.length} Quellordner — das Muster greift nicht mehr`);
  return dirs;
}

function quellen() {
  const raus = [];
  for (const dir of srcDirs()) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    const stapel = [abs];
    while (stapel.length) {
      const d = stapel.pop();
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) stapel.push(p);
        else if (e.name.endsWith('.ts')) raus.push(p);
      }
    }
  }
  raus.push(path.join(ROOT, 'server.ts'));
  return raus;
}

test('die API-Kontingente heissen nach der API, nicht nach einem Pfad', () => {
  // Die Schlüssel stehen in rate_limits/global_settings. Ein Pfad darin
  // bedeutet: eine zweite, leere Zählung neben der echten.
  const treffer = [];
  for (const datei of quellen()) {
    const src = ohneKommentare(fs.readFileSync(datei, 'utf8'));
    for (const fn of ['checkAndIncrementRateLimit', 'getRateLimitStatus', 'getLimitForApi']) {
      const re = new RegExp(`${fn}\\(\\s*'([^']+)'`, 'g');
      for (const m of src.matchAll(re)) {
        if (m[1].includes('/') || m[1].includes('.')) {
          treffer.push(`${path.relative(ROOT, datei)}: ${fn}('${m[1]}')`);
        }
      }
    }
  }
  assert.deepEqual(treffer, [],
    'Ein Kontingent-Schlüssel enthält einen Pfad. Das ist fast sicher eine ' +
    'verunglückte Ersetzung — die Zählung liefe unter neuem Namen bei null ' +
    'weiter, ohne dass irgendetwas abstürzt:\n  ' + treffer.join('\n  '));
});

test('kein Modul wird unter einem blossen Namen geholt', () => {
  // Die Gegenrichtung: Beim Zurückdrehen des obigen Fehlers habe ich drei
  // echte require('../clients/rebrickable') auf require('rebrickable')
  // verkürzt. Node sucht dann in node_modules — 500er zur Laufzeit.
  const eigene = new Set(['rebrickable', 'brickset', 'sets', 'parts', 'minifigs',
    'finance', 'settings', 'auth', 'handlers', 'financeCalc', 'database']);
  const treffer = [];
  for (const datei of quellen()) {
    const src = ohneKommentare(fs.readFileSync(datei, 'utf8'));
    for (const m of src.matchAll(/(?:require\(|from )\s*'([^'.\/][^']*)'/g)) {
      if (eigene.has(m[1])) treffer.push(`${path.relative(ROOT, datei)}: '${m[1]}'`);
    }
  }
  assert.deepEqual(treffer, [],
    'Ein projekteigenes Modul wird ohne Pfad geholt — Node sucht es dann in ' +
    'node_modules und wirft zur Laufzeit:\n  ' + treffer.join('\n  '));
});

test('clients/ enthält keine Routen und wird trotzdem gebaut', () => {
  // Der Ordner existiert, WEIL diese beiden Dateien keine Router sind. Kommt
  // dort je eine Route hinein, gehört die Datei zurück nach routes/.
  for (const f of fs.readdirSync(path.join(ROOT, 'clients'))) {
    if (!f.endsWith('.ts')) continue;
    const src = ohneKommentare(fs.readFileSync(path.join(ROOT, 'clients', f), 'utf8'));
    assert.doesNotMatch(src, /^\s*router\.(get|post|put|delete|patch)\(/m,
      `clients/${f} hat eine Route — dann ist es ein Router und gehört nach routes/`);
  }

  // Und das Bauskript muss den Ordner kennen. Fehlt er dort, entsteht kein
  // dist/clients/ und JEDER Import darauf läuft beim Start ins Leere — genau
  // daran wäre der Umzug fast gescheitert.
  const build = fs.readFileSync(path.join(ROOT, 'scripts', 'build-ts.js'), 'utf8');
  const zeile = build.match(/const SRC_DIRS = \[([^\]]*)\]/);
  assert.ok(zeile, 'SRC_DIRS nicht gefunden');
  assert.match(zeile[1], /'clients'/, 'Das Bauskript baut clients/ nicht mit');
});

test('keine Zyklen über echte import-Anweisungen', () => {
  // ── Warum das eine eigene Prüfung verdient (Nachtrag 127) ─────────────────
  //
  // Beim Auslagern der Anleitungs-Kette nach utils/instructions.ts habe ich
  // selbst einen Kreis erzeugt: instructions braucht den Brickset-Client, und
  // der Client holte am Ende seiner Wiederholungsschlange Anleitungen nach.
  //
  // Ein spätes `require()` hätte das überlebt — es läuft ja erst beim Aufruf.
  // Eine `import`-Anweisung nicht: Zur Ladezeit ist eine der beiden Seiten
  // `undefined`, und das fällt erst im Betrieb auf. Beim Umbau von require()
  // auf import wird aus einem harmlosen Kreis also ein Fehler, und genau
  // deshalb muss diese Richtung überwacht werden.
  //
  // Aufgelöst wurde er, indem die Wiederholungsschlange als jobs/bricksetRetry.ts
  // eigenständig wurde: Sie ist Ablaufsteuerung, keine API-Anfrage.
  //
  // Späte require() sind hier bewusst NICHT mitgezählt — die abzubauen ist ein
  // laufendes Vorhaben, aber sie sind zur Ladezeit ungefährlich.
  const graph = new Map();
  const dateien = quellen();
  const kennt = new Set(dateien.map(d => path.resolve(d)));

  const aufloesen = (von, rel) => {
    const basis = path.resolve(path.dirname(von), rel);
    for (const k of [basis + '.ts', path.join(basis, 'index.ts')]) {
      if (kennt.has(k)) return k;
    }
    return null;
  };

  for (const datei of dateien) {
    const src = ohneKommentare(fs.readFileSync(datei, 'utf8'));
    const ziele = new Set();
    for (const m of src.matchAll(/^import [^;]*from\s*'(\.[^']+)'/gm)) {
      const z = aufloesen(datei, m[1]);
      if (z && z !== path.resolve(datei)) ziele.add(z);
    }
    graph.set(path.resolve(datei), ziele);
  }

  const gefunden = [];
  const stapel = [];
  const fertig = new Set();
  const lauf = (u) => {
    stapel.push(u);
    for (const v of graph.get(u) || []) {
      const i = stapel.indexOf(v);
      if (i >= 0) {
        gefunden.push(stapel.slice(i).concat(v).map(x => path.relative(ROOT, x)).join(' → '));
      } else if (!fertig.has(v)) { fertig.add(v); lauf(v); }
    }
    stapel.pop();
  };
  for (const n of graph.keys()) lauf(n);

  assert.deepEqual([...new Set(gefunden)], [],
    'Kreis über echte import-Anweisungen — zur Ladezeit ist eine Seite ' +
    'undefined, und das fällt erst im Betrieb auf:\n  ' +
    [...new Set(gefunden)].join('\n  '));
});

test('jeder Quellordner kommt auch im Container an', () => {
  // ── Zwei Beinahe-Ausfälle in Folge (Nachträge 126 und 128) ───────────────
  //
  // Ein neuer Ordner muss an DREI Stellen bekannt sein, und keine davon meldet
  // sich, wenn sie fehlt:
  //
  //   1. scripts/build-ts.js  → SRC_DIRS, sonst entsteht kein dist/<ordner>/
  //   2. Dockerfile           → COPY, sonst fehlt der Ordner im Build-Stage
  //   3. der Ladepfad zur Laufzeit
  //
  // Bei clients/ habe ich (1) im letzten Moment gesehen und (2) erst beim
  // Durchsehen des Dockerfiles — im Container wäre der Server beim ersten
  // Import gescheitert. Das Projekt hatte denselben Fehler schon bei jobs/
  // (siehe test/jobs-typescript.test.js).
  const build = fs.readFileSync(path.join(ROOT, 'scripts', 'build-ts.js'), 'utf8');
  const dockerfile = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  const srcDirs = [...build.match(/const SRC_DIRS = \[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);

  // Alle Ordner mit .ts-Dateien auf oberster Ebene müssen in SRC_DIRS stehen.
  for (const e of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (['node_modules', 'dist', 'data', 'test', 'public', 'scripts', '.git', 'pgdata'].includes(e.name)) continue;
    // Nur Dateien, aus denen ein Laufzeitmodul entsteht. Reine
    // Typdeklarationen (.d.ts, z.B. types/augmentations.d.ts) erzeugen kein
    // .js und brauchen deshalb weder SRC_DIRS noch ein COPY.
    const hatTs = fs.readdirSync(path.join(ROOT, e.name))
      .some(f => f.endsWith('.ts') && !f.endsWith('.d.ts'));
    if (!hatTs) continue;
    assert.ok(srcDirs.includes(e.name),
      `${e.name}/ enthält TypeScript, steht aber nicht in SRC_DIRS — es entsteht ` +
      `kein dist/${e.name}/ und jeder Import darauf läuft beim Start ins Leere`);
    assert.match(dockerfile, new RegExp(`^COPY ${e.name}/`, 'm'),
      `${e.name}/ wird im Dockerfile nicht kopiert — im Container fehlt der Ordner`);
  }
});

test('das Grundschema wird dort gesucht, wo es zur Laufzeit liegt', () => {
  // Mein erster Versuch nahm APP_ROOT. Im Container gibt es die Quellen nicht —
  // das Laufzeit-Image enthält nur dist/. Die .sql-Dateien landen dort, weil
  // scripts/build-ts.js sie ausdrücklich mitkopiert (ASSET_EXT); gesucht werden
  // müssen sie deshalb neben dem übersetzten Modul, also über __dirname.
  const dbSrc = ohneKommentare(fs.readFileSync(path.join(ROOT, 'db', 'database.ts'), 'utf8'));
  const laden = dbSrc.slice(dbSrc.indexOf('function ladeSchema'), dbSrc.indexOf('function ladeSchema') + 400);
  assert.match(laden, /__dirname/,
    'ladeSchema() sucht nicht über __dirname — im Container liegt die Datei in ' +
    'dist/db/, und einen Quellbaum gibt es dort nicht');
  assert.doesNotMatch(laden, /APP_ROOT/,
    'APP_ROOT zeigt auf den Quellbaum, den das Laufzeit-Image nicht enthält');

  const build = fs.readFileSync(path.join(ROOT, 'scripts', 'build-ts.js'), 'utf8');
  assert.match(build, /ASSET_EXT\s*=\s*\[[^\]]*'\.sql'/,
    'Das Bauskript kopiert keine .sql-Dateien mehr nach dist/ — dann fehlt das ' +
    'Grundschema im Container');
  assert.ok(fs.existsSync(path.join(ROOT, 'db', 'schema.sql')), 'db/schema.sql fehlt');
});

test('jedes späte require() zeigt auf eine Datei, die es gibt', () => {
  // ── Ein echter Laufzeitfehler beim Umzug (Nachtrag 131) ──────────────────
  //
  // Beim Auslagern von addSet nach utils/setService.ts wanderte
  //
  //     require('./parts').fetchMissingBlIds()
  //
  // wortgleich mit. Aus utils/ gesehen gibt es './parts' nicht — der Aufruf
  // stand aber in einem `setImmediate(...)`, also flog der Fehler ERST beim
  // Anlegen eines Sets und ausserhalb jedes `.catch()`. Im Test tauchte er nur
  // als „asynchronous activity after the test ended" auf.
  //
  // Die Prüfung require-exports.test.js sieht das nicht: Sie prüft, ob ein
  // Modul den NAMEN exportiert — nicht, ob es das Modul überhaupt gibt.
  //
  // Verwandt mit dem Fund oben („kein Modul unter blossem Namen"), aber die
  // andere Hälfte: Dort war der Pfad zu kurz, hier zeigt er ins Leere.
  const treffer = [];
  for (const datei of quellen()) {
    const src = ohneKommentare(fs.readFileSync(datei, 'utf8'));
    for (const m of src.matchAll(/require\(\s*'(\.[^']+)'\s*\)/g)) {
      const basis = path.resolve(path.dirname(datei), m[1]);
      const da = ['.ts', '.js', '/index.ts', '/index.js', '']
        .some(e => fs.existsSync(basis + e));
      if (!da) treffer.push(`${path.relative(ROOT, datei)}: require('${m[1]}') zeigt ins Leere`);
    }
  }
  assert.deepEqual(treffer, [],
    'Ein spätes require() zeigt auf eine Datei, die es nicht gibt. Das fällt ' +
    'erst zur Laufzeit auf — und wenn der Aufruf in einem setImmediate steckt, ' +
    'sogar ausserhalb jedes catch:\n  ' + treffer.join('\n  '));
});
