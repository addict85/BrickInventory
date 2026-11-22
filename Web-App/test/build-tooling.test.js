/**
 * Build tools: one version, one path. esbuild comes from the devDependency
 * and runs once for all files — npx per file broke the time limit on weak
 * hardware, and a hard-wired version could deviate from
 * package.json.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('the build scripts prefer the locally installed esbuild', () => {
  for (const f of ['scripts/build-ts.js', 'scripts/build-frontend.js']) {
    const src = read(f);
    assert.match(
      src,
      /node_modules', '\.bin'/,
      `${f}: nutzt nicht das lokale esbuild — npx kostet pro Aufruf Startzeit`,
    );
  }
});

test('build-ts.js starts esbuild exactly once, not per file', () => {
  const src = read('scripts/build-ts.js');
  // One call with --outdir/--outbase instead of a loop with --outfile.
  assert.match(src, /--outbase=/, 'Ohne --outbase geht die Verzeichnisstruktur verloren');
  assert.doesNotMatch(
    src,
    /for \(const tsFile of files\) \{[\s\S]{0,400}execFileSync/,
    'esbuild darf nicht je Datei gestartet werden',
  );
});

test('the npx fallback version matches package.json', () => {
  const pkg = JSON.parse(read('package.json'));
  const want = (pkg.devDependencies.esbuild || '').replace(/^[^0-9]*/, '');
  assert.ok(want, 'esbuild fehlt in den devDependencies');
  for (const f of ['scripts/build-ts.js', 'scripts/build-frontend.js']) {
    const m = read(f).match(/const ESBUILD_VERSION = '([^']+)'/);
    assert.ok(m, `${f}: ESBUILD_VERSION nicht gefunden`);
    assert.equal(
      m[1],
      want,
      `${f}: ${m[1]} weicht von package.json (${want}) ab — derselbe Befehl bauete sonst je nach Umgebung anders`,
    );
  }
});

test('tests do not rebuild dist/ if it is current', () => {
  const src = read('test/helpers/sources.js');
  assert.match(
    src,
    /function distIsFresh/,
    'Ohne diese Prüfung baut JEDE Testdatei den kompletten Baum erneut — jede läuft in einem eigenen Prozess',
  );
});

test('the runtime stage runs no npm scripts', () => {
  // After the `FROM` of the runtime stage no npm command may stand that triggers
  // scripts: scripts/ is not copied there, the Docker build would abort —
  // visible only in the real build, not in type check or test suite.
  const df = read('Dockerfile');
  const stages = df.split(/^FROM /m);
  assert.ok(stages.length >= 3, 'Der Dockerfile hat keine zwei Stages mehr');
  const runtime = stages[stages.length - 1];
  assert.doesNotMatch(
    runtime,
    /RUN\s+npm\s+(ci|install|prune)(?![^\n]*--ignore-scripts)/,
    'Im Runtime-Stage darf kein npm-Befehl ohne --ignore-scripts laufen — scripts/ existiert dort nicht',
  );
});

test('devDependencies do not end up in the runtime image', () => {
  // Build tools do not belong in the image: needless size and attack surface.
  const df = read('Dockerfile');
  assert.match(df, /npm prune --omit=dev/, 'Ohne prune enthält das übernommene node_modules auch die devDependencies');
  // prune must come AFTER the frontend build, otherwise esbuild is missing there.
  assert.ok(
    df.indexOf('npm prune --omit=dev') > df.indexOf('build-frontend.js'),
    'prune läuft zu früh — esbuild wird für den Frontend-Build noch gebraucht',
  );
});

test('compose.yaml no longer mounts anything into public/', () => {
  // Images live under data/images/, and public/ is immutable
  // build content: a write mount into it undermines that.
  const compose = read('compose.yaml');
  const mounts = [...compose.matchAll(/^\s*-\s*([^\s:#]+):([^\s:#]+)/gm)].map(m => m[2]);
  const intoPublic = mounts.filter(t => t.startsWith('/app/public'));
  assert.deepEqual(intoPublic, [], `Mount nach public/: ${intoPublic.join(', ')} — Bilder gehören unter /app/data`);
});

test("the data directory is the app's only data volume, the key lies next to it", () => {
  const compose = read('compose.yaml');
  // app and jobs mount the same ./data; besides that only the data key,
  // which precisely should not live in data/ (UPGRADE.md, section 21).
  const appMounts = [...new Set([...compose.matchAll(/^\s*-\s*\.\/[^\s:#]+:(\/app[^\s:#]*)/gm)].map(m => m[1]))].sort();
  assert.deepEqual(
    appMounts,
    ['/app/data', '/app/schluessel'],
    'Alles Persistente liegt unter data/ — ein zweites Volume erzeugt nur einen verwaisten Ordner',
  );
});

test('no build artifacts next to the TypeScript sources', () => {
  // Products only to dist/ and public/js/app.bundle.js: a .js next to its
  // .ts wins with require() without extension, and `npm run dev` would run stale code.
  const walk = dir => {
    const out = [];
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...walk(rel));
      else out.push(rel);
    }
    return out;
  };
  const offenders = [];
  for (const dir of ['db', 'jobs', 'routes', 'src']) {
    offenders.push(...walk(dir).filter(f => f.endsWith('.js')));
  }
  if (fs.existsSync(path.join(ROOT, 'server.js'))) offenders.push('server.js');
  assert.deepEqual(
    offenders,
    [],
    `In-place-Artefakte im Quellbaum: ${offenders.join(', ')} — ` +
      'löschen und mit `node scripts/build-ts.js --outdir dist` bauen',
  );
});

// ── Type packages describe the same major version that also runs ─────────────
/**
 * Otherwise tsc checks against an API that is not shipped like that, and a
 * message is missing. Only the MAJOR VERSION: type packages catch up in minor and
 * patch versions on their own.
 */
test('@types/* describe the same major version as the package itself', () => {
  const pkg = JSON.parse(read('package.json'));
  const alle = { ...pkg.dependencies, ...pkg.devDependencies };
  const haupt = s => {
    const m = String(s).match(/(\d+)\./);
    return m ? m[1] : null;
  };

  // Exemptions: DefinitelyTyped counts the major version by the declarations,
  // not by the library. An entry is a DECISION with a rationale,
  // not a silencing.
  const carteBlanche = {
    archiver: 'Typpaket zählt eigenständig; 8.x ist die aktuelle Fassung für archiver 7',
    'connect-pg-simple': 'Typpaket steht seit Jahren auf 7.x, die Bibliothek bei 10 — DT zählt hier nicht mit',
    nodemailer: '8.0.1 ist die NEUESTE veröffentlichte Fassung; für nodemailer 9 gibt es noch keine',
  };

  const deviating = [];
  let geprueft = 0;
  for (const [name, span] of Object.entries(alle)) {
    if (!name.startsWith('@types/')) continue;
    const ziel = name.slice('@types/'.length).replace('__', '/');
    if (!(ziel in alle)) continue; // @types/node and the like have no counterpart
    geprueft++;
    if (ziel in carteBlanche) continue;
    const a = haupt(alle[ziel]),
      b = haupt(span);
    if (a && b && a !== b) deviating.push(`${ziel} ${alle[ziel]} ↔ ${name} ${span}`);
  }

  // An exemption for a package that no longer exists hides the real question
  // next time.
  const verwaist = Object.keys(carteBlanche).filter(z => !(z in alle));
  assert.deepEqual(verwaist, [], 'Freibrief ohne Paket — Eintrag entfernen: ' + verwaist.join(', '));

  assert.ok(geprueft >= 5, `Nur ${geprueft} Paare gefunden — heissen die Typpakete noch @types/<paket>?`);
  assert.deepEqual(deviating, [], 'Typpaket und Paket in verschiedenen Hauptversionen:\n  ' + deviating.join('\n  '));
});

// strictNullChecks stays on, and tsc must run through cleanly (CI step).
test('tsconfig has strictNullChecks on, and the CI checks the types as a step of its own', () => {
  // The tsc run itself is done by CI (step “type check”); run here twice
  // it cost every test run about 15 s (review report arch17-web-b, N7).
  // Counter-check (05.11.2026): the step `npx tsc --noEmit` removed from web-ci.yml → red.
  const roh = read('tsconfig.json').replace(/^\s*\/\/[^\n]*$/gm, '');
  const cfg = JSON.parse(roh);
  assert.equal(
    cfg.compilerOptions.strictNullChecks,
    true,
    'strictNullChecks wurde in der tsconfig wieder abgeschaltet',
  );
  const ci = fs.readFileSync(path.join(ROOT, '..', '.github', 'workflows', 'web-ci.yml'), 'utf8');
  assert.match(ci, /^\s+run: npx tsc --noEmit\s*$/m, 'die CI prüft die Typen des Servers nicht mehr');
});

/**
 * The address of the test database is NEVER read without a fallback value: a
 * child process without it got `undefined`, and the file's run then aborted
 * with a message that says nothing about the cause. Comments out
 * BEFORE searching — otherwise the rule would report its own explanatory text.
 */
test('the address of the test database has a fallback value everywhere', () => {
  const { ohneKommentare } = require('./helpers/sources');
  const dateien = fs.readdirSync(__dirname).filter(f => f.endsWith('.js'));
  let parsed = 0;
  const withoutFallback = [];
  for (const f of dateien) {
    const src = ohneKommentare(fs.readFileSync(path.join(__dirname, f), 'utf8'));
    for (const m of src.matchAll(/process\.env\.TEST_DATABASE_URL\s*(\|\|)?/g)) {
      parsed++;
      if (!m[1]) withoutFallback.push(`${f}:${src.slice(0, m.index).split('\n').length}`);
    }
  }
  // Self-proof: if the pattern finds nothing, the list would be empty and the test
  // green without having checked anything.
  assert.ok(parsed >= 50, `Nur ${parsed} Zugriffe auf TEST_DATABASE_URL gefunden — Muster veraltet?`);
  assert.deepEqual(
    withoutFallback,
    [],
    'Diese Stellen lesen TEST_DATABASE_URL ohne Rückfallwert:\n  ' +
      withoutFallback.join('\n  ') +
      '\nIst die Variable nicht gesetzt, kommt dort undefined an. In einem ' +
      'Kindprozess bricht der ganze Testlauf dann mit einer Meldung ab, die ' +
      'nichts über die Ursache sagt.',
  );
});

/**
 * The pg client in CI has the service's major version, and the number appears
 * ONCE: pg_dump refuses a version older than the server, and two
 * numbers for the same thing drift apart.
 */
test('the pg client in CI follows the version of the service', () => {
  const yml = fs.readFileSync(path.join(ROOT, '..', '.github', 'workflows', 'web-ci.yml'), 'utf8');

  // Self-proof: without a service definition everything below checks nothing.
  const serviceFn = yml.match(/image:\s*postgres:(\d+)/);
  assert.ok(serviceFn, 'Keine Postgres-Dienstdefinition im Workflow gefunden — Muster veraltet?');

  // No second version of the same number.
  const fixedClients = [...yml.matchAll(/postgresql-client-(\d+)/g)].map(m => m[1]);
  assert.deepEqual(
    fixedClients,
    [],
    `Die Klientenversion steht als feste Zahl im Workflow (${fixedClients.join(', ')}). ` +
      `Der Dienst laeuft auf ${serviceFn[1]}; zwei Zahlen fuer dieselbe Sache laufen auseinander — ` +
      'die Version gehoert aus der Dienstdefinition gelesen.',
  );
  assert.match(
    yml,
    /postgresql-client-\$\{haupt\}|postgresql-client-\$\{\{?\s*haupt/,
    'Der Schritt installiert keinen Klienten, dessen Version aus dem Dienst stammt',
  );

  // Also LOOK: without a PATH entry the preinstalled client wins.
  assert.match(
    yml,
    /pg_dump --version \| grep/,
    'Nach der Installation wird nicht geprueft, ob pg_dump wirklich die richtige Version ist',
  );
});

test('both workflows report what was red', () => {
  const wf = path.join(ROOT, '..', '.github', 'workflows');
  for (const datei of ['web-ci.yml', 'android.yml']) {
    const yml = fs.readFileSync(path.join(wf, datei), 'utf8');
    assert.match(
      yml,
      /set -o pipefail/,
      `${datei}: Ohne pipefail bestimmt tee den Rueckgabewert — ein roter Lauf ginge als Erfolg durch`,
    );
    assert.match(yml, /tee "\$RUNNER_TEMP\/test\.log"/, `${datei}: kein Mitschnitt des Testprotokolls`);
    assert.match(yml, /if:\s*failure\(\)/, `${datei}: kein Schritt, der im Fehlerfall laeuft`);
    // Both exits: something is red, or it is red without a test being red
    // (compile error, module does not load) — otherwise the diagnosis is silent exactly then.
    const error = [...yml.matchAll(/::error title=/g)].length;
    assert.ok(error >= 2, `${datei}: nur ${error} Fehler-Annotation(en) — beide Ausgaenge muessen gemeldet werden`);
    // And the reporter that the configured Node version really takes
    if (datei === 'web-ci.yml') {
      const assignment = (yml.match(/^\s*ROT_MUSTER=.*$/m) || [''])[0];
      assert.ok(assignment, `${datei}: kein ROT_MUSTER definiert`);
      assert.match(assignment, /not ok/, `${datei}: ROT_MUSTER kennt den TAP-Reporter nicht`);
      assert.match(
        assignment,
        /✖/,
        `${datei}: ROT_MUSTER kennt den spec-Reporter (Node 26) nicht — ` +
          'gemessen an Lauf 15: vier rote Tests, kein einziger gemeldet',
      );
    }
    assert.match(
      yml,
      /::notice title=Testsumme::/,
      `${datei}: keine Summenzeile — dann sagt nichts, ob ueberhaupt etwas gelaufen ist`,
    );
  }
});

/**
 * Cut out the body of a workflow step by its name.
 *
 * Found instead of enumerated: the steps come from the file, and the
 * self-proof below shows when the parsing no longer works.
 */
function stepBody(yml, partName) {
  const headers = [...yml.matchAll(/^ {6}- name: (.+)$/gm)];
  assert.ok(headers.length >= 8, `Nur ${headers.length} Schritte erkannt — das Zerlegen greift nicht mehr`);
  for (let i = 0; i < headers.length; i++) {
    if (!headers[i][1].includes(partName)) continue;
    const ende = i + 1 < headers.length ? headers[i + 1].index : yml.length;
    return yml.slice(headers[i].index, ende);
  }
  return null;
}

test('the security check says what it found', () => {
  // The finding
  const yml = fs.readFileSync(path.join(ROOT, '..', '.github', 'workflows', 'web-ci.yml'), 'utf8');
  const rumpf = stepBody(yml, 'Sicherheitsprüfung');
  assert.ok(rumpf, 'Der Schritt heisst anders — diese Regel prueft dann nichts mehr');

  assert.match(rumpf, /--json/, 'Der Schritt betrachtet nur den Rueckgabewert. Der sagt nicht, WAS los war');
  // Both exits: a finding AND no evaluable response.
  const error = [...rumpf.matchAll(/::error title=/g)].length;
  assert.ok(error >= 2, `nur ${error} Fehler-Annotation(en) — beide Ausgaenge muessen gemeldet werden`);
  // And the silent exit: “no gap" is a result too.
  assert.match(
    rumpf,
    /::notice title=npm audit::/,
    'Ohne Meldung im Erfolgsfall sagt nichts, ob die Pruefung ueberhaupt gelaufen ist',
  );
  // npm's default for --fetch-timeout is 300000 ms — exactly the five
  // minutes from run 33867656667.
  assert.match(
    rumpf,
    /--fetch-timeout=/,
    'Ohne eigenes Zeitlimit haengt eine stumme Registry fuenf Minuten je Versuch',
  );
});

// The evaluation from the workflow really runs here, with a rebuilt
// report. Counter-check (measured 03.11.2026): `m.moderate` deleted from the sum
// → red “a finding “moderate” makes the run red”.
test('npm audit: a finding from "moderate" makes the run red', t => {
  const yml = fs.readFileSync(path.join(ROOT, '..', '.github', 'workflows', 'web-ci.yml'), 'utf8');
  const rumpf = stepBody(yml, 'Sicherheitsprüfung');
  const stuecke = [...rumpf.matchAll(/node -e '\n([\s\S]*?)\n\s*'/g)].map(m => m[1]);
  const evaluation = stuecke.find(s => s.includes('process.env.BERICHT'));
  assert.ok(evaluation, 'die Auswertung des Berichts ist nicht zu finden');
  const location = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-'));
  t.after(() => fs.rmSync(location, { recursive: true, force: true }));
  const lauf = stufe => {
    const m = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
    const vulnerabilities = {};
    if (stufe) {
      m[stufe] = 1;
      vulnerabilities.probe = { severity: stufe, via: ['GHSA-probe'] };
    }
    fs.writeFileSync(
      path.join(location, 'audit.json'),
      JSON.stringify({ metadata: { vulnerabilities: m }, vulnerabilities }),
    );
    return spawnSync(process.execPath, ['-e', evaluation], {
      encoding: 'utf8',
      env: { ...process.env, BERICHT: path.join(location, 'audit.json') },
    });
  };
  assert.equal(lauf(null).status, 0, 'ohne Befund rot');
  assert.equal(lauf('low').status, 0, '„low“ macht den Lauf rot');
  const mittel = lauf('moderate');
  assert.notEqual(mittel.status, 0, 'ein Befund „moderate“ macht den Lauf rot');
  assert.match(mittel.stdout, /::error title=Schwachstelle \(moderate\)::probe/);
  assert.notEqual(lauf('critical').status, 0);
});

test('the CI workflow checks what it is supposed to check', () => {
  const p = path.join(ROOT, '..', '.github', 'workflows', 'web-ci.yml');
  assert.ok(fs.existsSync(p), 'Es gibt keinen CI-Workflow mehr');
  const yml = fs.readFileSync(p, 'utf8');

  // 1. REQUIRE_DB. WITHOUT this variable the database suites skip themselves
  //    when they get no connection — in CI that would be the
  //    worst: a green run that never executed half of it.
  assert.match(yml, /REQUIRE_DB:\s*'1'/, 'Ohne REQUIRE_DB=1 überspringt CI stillschweigend alle DB-Suiten');

  // 2. A real database, in the major version from production.
  const compose = fs.readFileSync(path.join(ROOT, 'compose.yaml'), 'utf8');
  const operation = (compose.match(/image:\s*postgres:(\d+)/) || [])[1];
  const ci = (yml.match(/image:\s*postgres:(\d+)/) || [])[1];
  assert.ok(operation && ci, 'Postgres-Abbild nicht auffindbar');
  assert.equal(
    ci,
    operation,
    `CI prüft gegen PostgreSQL ${ci}, im Betrieb läuft ${operation} — ` +
      'Sperren, Indizes und Planerverhalten unterscheiden sich zwischen Hauptversionen',
  );

  // 3. The four steps that together carry the statement. `npm ci` instead of
  //    `npm install` belongs to it: only the former fails when package.json
  //    and lockfile drift apart.
  const code = yml
    .split('\n')
    .filter(z => !z.trimStart().startsWith('#'))
    .join('\n');
  for (const [muster, warum] of /** @type {[RegExp, string][]} */ ([
    [/\bnpm ci\b/, 'npm install würde ein abweichendes Lockfile stillschweigend hinnehmen'],
    [/\bnpx tsc --noEmit/, 'ohne Typprüfung sagt der Lauf nichts über strictNullChecks'],
    [/\bnpm run build\b/, 'ohne frischen Build prüft CI womöglich ein altes dist/'],
    [/\bnpm test\b/, 'ohne Tests ist der ganze Lauf sinnlos'],
    [/\bnpm run typecheck:strict/, 'die gestaffelte noImplicitAny-Prüfung fehlt'],
    [/\bnpm run typecheck:frontend/, 'die Typprüfung der Oberfläche fehlt'],
  ])) {
    assert.match(code, muster, `CI-Workflow: ${warum}`);
  }
  // Counter-check of the comment rule: `npm install` stands ONLY in the prose of the
  // rationale. If it remained after cutting, the function would cut
  // nothing — and everything above would be worthless.
  assert.doesNotMatch(
    code,
    /\bnpm install\b/,
    'npm install steht im ausführbaren Teil des Workflows — oder die ' +
      'Kommentarzeilen werden nicht mehr weggeschnitten.',
  );
});

test('a pipe in the workflow does not lose the failure', () => {
  // measured, not assumed
  const PASS_THROUGH = /\|\s*(tee|head|tail|cat)\b/;
  const wf = path.join(ROOT, '..', '.github', 'workflows');
  let geprueft = 0;
  for (const datei of fs.readdirSync(wf).filter(f => /\.ya?ml$/.test(f))) {
    const roh = fs.readFileSync(path.join(wf, datei), 'utf8');
    for (const block of roh.split(/^ {6}- /m).slice(1)) {
      const rumpf = block
        .split('\n')
        .filter(z => !z.trimStart().startsWith('#'))
        .join('\n');
      if (!/\brun:/.test(rumpf) || !PASS_THROUGH.test(rumpf)) continue;
      geprueft++;
      assert.match(
        rumpf,
        /set -o pipefail|set -[a-z]*o[a-z]* pipefail/,
        `${datei}: Ein run-Block leitet in einen Durchreicher (tee/head/tail/cat), ` +
          'ohne "set -o pipefail". Der Rückgabewert ist dann dessen — ein ' +
          `Fehlschlag davor geht verloren. Block:\n${rumpf.slice(0, 300)}`,
      );
    }
  }
  // Self-proof: if the search finds not a single such block, the
  // loop checks nothing and would still be green.
  assert.ok(geprueft >= 1, 'Kein run-Block mit Durchreicher gefunden — Muster veraltet?');
});

test('the noImplicitAny exception list is still correct', () => {
  // The script checks itself in both directions (new debt / orphaned
  // entries) and is only executed here so that a violation also
  // shows when someone only runs `npm test`.
  const { execFileSync } = require('node:child_process');
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'check-noimplicitany.js')], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    assert.fail(String(e.stdout || '') + String(e.stderr || ''));
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// The Node version stands in three places and must be the same everywhere
// ═══════════════════════════════════════════════════════════════════════════
/**
 * The occasion: the Dockerfile ran on `node:20-alpine`, and the
 * CI workflow wrote `node-version: '20'` with the rationale “as in the
 * Dockerfile". The rationale was right, the number wrong — Node 20 had reached
 * its end of life on 30.04.2026 and since then got no …
 */
test('Dockerfile and CI run on the same, supported Node version', () => {
  const docker = read('Dockerfile');
  // The workflow lives in the root directory of the REPOSITORY, not in
  // Web-App/ — see the paragraph in the test above.
  const ci = read('../.github/workflows/web-ci.yml');

  const inImage = [...docker.matchAll(/^FROM node:(\d+)-/gm)].map(m => m[1]);
  assert.ok(inImage.length >= 2, `Nur ${inImage.length} FROM node:… im Dockerfile — gibt es die zwei Stufen noch?`);
  assert.equal(
    new Set(inImage).size,
    1,
    `Build- und Runtime-Stage laufen auf verschiedenen Node-Versionen: ${inImage.join(', ')}`,
  );

  const imCi = (ci.match(/node-version:\s*'(\d+)'/) || [])[1];
  assert.ok(imCi, 'Der CI-Workflow legt keine Node-Version fest');
  assert.equal(
    imCi,
    inImage[0],
    `CI prüft auf Node ${imCi}, ausgeliefert wird Node ${inImage[0]} — ` +
      'dann sagt ein grüner Lauf nichts über das Image',
  );
  // .nvmrc for local development (`nvm use`). Counter-check (04.11.2026):
  // .nvmrc to 24 → red “.nvmrc names Node 24”.
  const nvmrc = read('.nvmrc').trim();
  assert.equal(nvmrc, inImage[0], `.nvmrc nennt Node ${nvmrc}, ausgeliefert wird Node ${inImage[0]}`);

  // Expired lines. When adding, please write the date with it.
  const abgelaufen = {
    14: '30.04.2023',
    16: '11.09.2023',
    18: '30.04.2025',
    20: '30.04.2026',
    // Odd lines never reach LTS and expire after six months.
    19: 'nie LTS',
    21: 'nie LTS',
    23: 'nie LTS',
    25: 'nie LTS',
  };
  assert.ok(
    !(inImage[0] in abgelaufen),
    `Node ${inImage[0]} bekommt seit ${abgelaufen[inImage[0]]} keine Sicherheits-Patches mehr — ` +
      'das ist keine alte Version, sondern eine ungepatchte Laufzeitumgebung',
  );
});

/**
 * @types/node describes the same Node major version that also runs: otherwise the
 * compiler would check against a different standard library than the executed one.
 * The general rule “type package and package in the same major version" further
 * up does not apply here: `node` is not a dependency in package.json, the
 * version is in the Dockerfile.
 */
test('@types/node matches the Node version from the Dockerfile', () => {
  const inImage = (read('Dockerfile').match(/^FROM node:(\d+)-/m) || [])[1];
  const typen = (JSON.parse(read('package.json')).devDependencies['@types/node'] || '').match(/(\d+)\./);
  assert.ok(inImage, 'Keine Node-Version im Dockerfile gefunden');
  assert.ok(typen, '@types/node fehlt in den devDependencies');
  assert.equal(
    typen[1],
    inImage,
    `Ausgeliefert wird Node ${inImage}, typgeprüft wird gegen @types/node ${typen[1]} — ` +
      'dann beschreibt der Übersetzer eine andere Standardbibliothek als die laufende',
  );
});

/**
 * A migration that no longer exists in the source is also no longer
 * in dist/ after the build.
 */
test('orphaned .sql files disappear on the next build', async t => {
  const ziel = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-bau-'));
  t.after(() => fs.rmSync(ziel, { recursive: true, force: true }));

  // The path is written literally here and not in a variable: eigenbruecken.test.js
  // counts paths with a variable segment and does not let the number grow. The
  // ratchet is justified — a composed path is exactly the one where
  // nobody notices that the file no longer exists.
  const build = () =>
    execFileSync(process.execPath, [path.join(ROOT, 'scripts/build-ts.js'), '--outdir', ziel], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

  const sql = dir =>
    fs.existsSync(dir)
      ? fs
          .readdirSync(dir)
          .filter(f => f.endsWith('.sql'))
          .sort()
      : [];
  const source = path.join(ROOT, 'db/migrations');
  const gebaut = path.join(ziel, 'db/migrations');

  build();
  const erwartet = sql(source);
  assert.ok(
    erwartet.length >= 20,
    `Nur ${erwartet.length} Migrationen in der Quelle gefunden — zu wenig; stimmt der Pfad noch? ` +
      `Ohne sie prueft dieser Fall nichts.`,
  );
  assert.deepEqual(sql(gebaut), erwartet, 'Der Bau traegt nicht genau die Migrationen der Quelle.');

  // Set up the case: a migration that exists only in the target.
  const fremd = path.join(gebaut, '9999-verwaist-aus-anderem-zweig.sql');
  fs.writeFileSync(fremd, '-- aus einem anderen Zweig zurueckgeblieben\nSELECT 1;\n');
  const jsBefore = countJs(ziel);

  build();
  assert.ok(
    !fs.existsSync(fremd),
    'Die verwaiste Migration liegt nach dem Bau noch in dist/. db/migrate.ts liest ' +
      'dieses Verzeichnis und fuehrt sie aus, als waere sie Teil des Schemas.',
  );
  assert.deepEqual(sql(gebaut), erwartet, 'Beim Aufraeumen ist mehr verschwunden als die verwaiste Datei.');
  assert.equal(
    countJs(ziel),
    jsBefore,
    'Das Aufraeumen hat .js-Dateien angefasst. Es darf ausschliesslich quellenlose ' + 'Nicht-TS-Abbilder entfernen.',
  );

  // Two independent proofs that removeOrphaned() took the file: the build names it,
  // and a file with a foreign extension stays (otherwise something cleaned up wholesale).
  const fremdTxt = path.join(gebaut, 'nicht-mitkopiert.md');
  fs.writeFileSync(fremd, '-- zweiter Versuch\nSELECT 1;\n');
  fs.writeFileSync(fremdTxt, 'keine mitkopierte Endung — darf liegen bleiben\n');

  const protokoll = build();
  assert.match(
    protokoll,
    /verwaiste Datei\(en\) entfernt:.*9999-verwaist-aus-anderem-zweig\.sql/,
    'Der Bau nennt die entfernte Datei nicht im Protokoll. Dann ist unklar, ob sie ' +
      'removeOrphaned() zum Opfer fiel oder aus einem anderen Grund fehlt — und wer ' +
      'spaeter sucht, warum eine Datei weg ist, findet keine Spur.\n' +
      protokoll,
  );
  assert.ok(!fs.existsSync(fremd), 'Die verwaiste .sql liegt noch da.');
  assert.ok(
    fs.existsSync(fremdTxt),
    'Auch die .md ist verschwunden. Dann raeumt etwas PAUSCHAL auf, und der Fall ' +
      'oben prueft nicht das gezielte Entfernen quellenloser Abbilder.',
  );
});

/** @param {string} wurzel @returns {number} number of .js files below */
function countJs(wurzel) {
  let n = 0;
  for (const e of fs.readdirSync(wurzel, { withFileTypes: true })) {
    const abs = path.join(wurzel, e.name);
    if (e.isDirectory()) n += countJs(abs);
    else if (e.name.endsWith('.js')) n++;
  }
  return n;
}
