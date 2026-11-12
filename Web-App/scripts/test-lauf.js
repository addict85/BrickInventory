#!/usr/bin/env node
'use strict';

/**
 * `npm test`: einmal bauen, einmal eine Vorlage-Datenbank aufsetzen (basis.sql
 * und Migrationen), dann die Testdateien parallel — jede mit eigener Kopie der
 * Vorlage (test/helpers/eigene-db.js). Browser-Tests laufen danach einzeln:
 * Mehrere Chromium nebeneinander reissen auf schwachen Rechnern die Fristen.
 */
const { execFileSync, spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const seriell = args.includes('--seriell');
const abdeckung = args.includes('--abdeckung');
const auswahl = args.filter(a => a !== '--seriell' && a !== '--abdeckung');
const ABDECKUNG = path.join(ROOT, 'coverage');

/** @param {string} url @param {string} name */
const mitDb = (url, name) => {
  const u = new URL(url);
  u.pathname = '/' + name;
  return u.toString();
};
/** @param {string} s */
const id = s => `"${s.replace(/"/g, '""')}"`;

/** Fremde Last auf dem Rechner verlängert jede Datei, ohne dass sie langsamer
 * geworden wäre: Die Frist wächst mit der Last je Kern, höchstens auf das Vierfache. */
function fristBeiLast(/** @type {number} */ grund) {
  const last = (os.loadavg()[0] ?? 0) / os.availableParallelism();
  return Math.round(grund * Math.min(4, Math.max(1, last)));
}

/**
 * Ein TAP-Bericht geht zusätzlich in eine Datei: Aus ihm liest der Lauf, welche
 * Dateien nur an der Frist scheiterten.
 * @param {string[]} dateien @param {number} n @param {Record<string, string>} env @param {number} frist
 * @returns {Promise<{ code: number, frist: string[], andere: number }>}
 */
function lauf(dateien, n, env, frist = 60_000) {
  if (!dateien.length) return Promise.resolve({ code: 0, frist: [], andere: 0 });
  // textausgabe.js hält Text aus dem Strom der Berichtsrahmen, auslauf.js
  // beendet ein Kind, das nicht endet (Begründungen dort).
  const vorlader = [
    '--require',
    path.join(ROOT, 'test', 'helpers', 'textausgabe.js'),
    '--require',
    path.join(ROOT, 'test', 'helpers', 'auslauf.js'),
    ...(env.TEST_DB_VORLAGE ? ['--require', path.join(ROOT, 'test', 'helpers', 'eigene-db.js')] : []),
  ];
  const bericht = path.join(os.tmpdir(), `test-lauf-${process.pid}-${Date.now()}.tap`);
  const reporter = process.stdout.isTTY ? 'spec' : 'tap';
  return new Promise(fertig => {
    const p = spawn(
      process.execPath,
      [
        ...vorlader,
        '--test',
        `--test-concurrency=${n}`,
        `--test-timeout=${frist}`,
        `--test-reporter=${reporter}`,
        '--test-reporter-destination=stdout',
        '--test-reporter=tap',
        `--test-reporter-destination=${bericht}`,
        ...dateien,
      ],
      // Die Datei als Ganzes darf länger als ein Test brauchen, aber nicht ewig.
      {
        cwd: ROOT,
        stdio: 'inherit',
        env: { TEST_DATEI_FRIST_MS: String(Math.max(600_000, 3 * frist)), ...process.env, ...env },
      },
    );
    p.on('exit', code => {
      const tap = fs.existsSync(bericht) ? fs.readFileSync(bericht, 'utf8') : '';
      fs.rmSync(bericht, { force: true });
      fertig({ code: code ?? 1, ...fristFehler(tap, dateien) });
    });
  });
}

/** Rote Dateien auf oberster Ebene: welche nur an der Frist scheiterten, wie viele aus anderem Grund.
 * @param {string} tap @param {string[]} dateien */
function fristFehler(tap, dateien) {
  /** @type {string[]} */
  const frist = [];
  let andere = 0;
  for (const block of tap.split(/\n(?=(?:not )?ok \d+ - )/).filter(b => b.startsWith('not ok'))) {
    // Der Name ist die Datei (sie selbst lief zu lange) oder ein Test darin (location).
    const name = /^not ok \d+ - (.*)/.exec(block)?.[1]?.trim() ?? '';
    const ort = /location: '(.+?):\d+:\d+'/.exec(block)?.[1] ?? name;
    const datei = dateien.find(d => [name, ort].some(x => path.resolve(ROOT, d) === path.resolve(ROOT, x)));
    if (datei && /testTimeoutFailure|timed out after/.test(block)) {
      if (!frist.includes(datei)) frist.push(datei);
    } else andere++;
  }
  return { frist, andere };
}

/** Dateien, die nur im Nachlauf grün wurden: Sie stehen am Ende des Laufs
 * und als Warnung in der CI, damit ein langsamer Test nicht still bleibt. */
/** @type {string[]} */
const nachgelaufen = [];

/** Was nur an der Frist scheiterte, läuft einzeln nach: unter Last ein
 * Ausrutscher, einzeln rot ein Fehler. Mit TEST_NACHLAUF=aus gibt es keinen
 * Nachlauf, dann ist schon die Fristüberschreitung rot. */
async function mitNachlauf(
  /** @type {{ code: number, frist: string[], andere: number }} */ r,
  /** @type {Record<string, string>} */ env,
  /** @type {number} */ frist,
) {
  if (!r.frist.length) return r.code;
  for (const d of r.frist) console.log(`::warning title=Frist überschritten::${d} (Frist ${frist / 1000} s)`);
  if (process.env.TEST_NACHLAUF === 'aus') {
    console.log(`[test-lauf] Frist überschritten, kein Nachlauf (TEST_NACHLAUF=aus): ${r.frist.join(', ')}`);
    return r.code || 1;
  }
  console.log(`[test-lauf] Frist überschritten, Nachlauf einzeln: ${r.frist.join(', ')}`);
  const nach = await lauf(r.frist, 1, env, frist * 2);
  console.log(`[test-lauf] Nachlauf ${nach.code === 0 ? 'grün' : 'ROT'}: ${r.frist.length} Dateien`);
  if (nach.code === 0) nachgelaufen.push(...r.frist);
  return r.andere > 0 ? r.code || 1 : nach.code;
}

/** Am Ende des Laufs, nicht zwischen hunderten Testzeilen. */
function meldeNachlauf() {
  if (!nachgelaufen.length) return;
  const text = `${nachgelaufen.length} Datei(en) nur im Nachlauf grün — unter Last zu langsam: ${nachgelaufen.join(', ')}`;
  console.log(`[test-lauf] WARNUNG: ${text}`);
  console.log(`::warning title=Nachlauf::${text}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### Nachlauf\n\n${text}\n`);
    } catch (e) {
      console.log(`[test-lauf] Zusammenfassung nicht schreibbar: ${e instanceof Error ? e.message : e}`);
    }
  }
}

/** Bericht aus den V8-Dateien (scripts/abdeckung.js); die Rohdaten sind danach überflüssig. */
async function berichteAbdeckung() {
  const bereiche = await require('./abdeckung').bericht(path.join(ABDECKUNG, 'v8'));
  console.log(`[test-lauf] Abdeckung (Zeilen %): ${JSON.stringify(bereiche)}`);
  fs.rmSync(path.join(ABDECKUNG, 'v8'), { recursive: true, force: true });
}

/**
 * Wie viele Dateien mangels Werkzeug nur überspringen: Ohne Chrome sind die Browser-Dateien grün, ohne
 * geprüft zu haben. Mit REQUIRE_BROWSER=1 bzw. REQUIRE_CADDY=1 scheitern sie stattdessen und zählen nicht.
 * @param {string[]} browser @param {string[]} alle @param {(f: string) => string} quelle
 */
function ohneWerkzeug(browser, alle, quelle) {
  let chromeDa = true;
  // Dieselbe Suche wie die Browser-Tests; der Pfad als Ausdruck, damit tsc die Testhilfe nicht mitprüft.
  try {
    chromeDa = !!require(path.join(ROOT, 'test', 'helpers', 'app-browser.js')).chrome();
  } catch {
    /* REQUIRE_BROWSER=1: rot statt still */
  }
  const caddyDa =
    process.env.REQUIRE_CADDY === '1' ||
    !!process.env.CADDY_BIN ||
    spawnSync('caddy', ['version'], { stdio: 'ignore' }).status === 0;
  const caddy = alle.filter(f => /CADDY_BIN/.test(quelle(f))).length;
  return (
    `übersprungen: ${chromeDa ? 0 : browser.length} Browser-Dateien ohne Chrome (CHROME_BIN, REQUIRE_BROWSER=1), ` +
    `${caddyDa ? 0 : caddy} Caddy-Dateien ohne Caddy (CADDY_BIN, REQUIRE_CADDY=1)`
  );
}

async function main() {
  const start = Date.now();
  if (process.env.TEST_LAUF_GEBAUT !== '1') {
    // ein Lauf im Lauf baut nicht: parallele Dateien lesen dist/ und Bündel
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-ts.js'), '--outdir', path.join(ROOT, 'dist')], {
      stdio: 'ignore',
    });
    // Das Bündel liegt nicht in git: einmal und immer neu bauen, die parallelen Dateien lesen es nur.
    require('./build-frontend').baueBuendel(path.join(ROOT, 'public', 'js', 'app.bundle.js'));
  }
  /** @type {Record<string, string>} */
  const messung = { TEST_LAUF_GEBAUT: '1' };
  if (abdeckung) {
    // Ein eigenes Bündel mit eingebetteter Sourcemap: Das ausgelieferte bleibt ohne.
    const mitKarte = path.join(ROOT, 'dist', 'abdeckung', 'app.bundle.js');
    require('./build-frontend').baueBuendel(mitKarte, { quellkarte: true });
    fs.rmSync(ABDECKUNG, { recursive: true, force: true });
    fs.mkdirSync(path.join(ABDECKUNG, 'v8'), { recursive: true });
    Object.assign(messung, { NODE_V8_COVERAGE: path.join(ABDECKUNG, 'v8'), TEST_BUENDEL: mitKarte });
    const erledigt = new Set();
    setInterval(() => require('./abdeckung').verdichte(path.join(ABDECKUNG, 'v8'), erledigt), 5000).unref();
  }

  const dateien = auswahl.length
    ? auswahl
    : fs
        .readdirSync(path.join(ROOT, 'test'))
        .filter(f => f.endsWith('.test.js'))
        .sort()
        .map(f => path.join('test', f));
  // Browser-Dateien haben je eigene Datenbank, Port und Chrome-Profil; sie laufen
  // getrennt, weil mehrere Chrome je Kern die Fristen reissen (TEST_PARALLEL_BROWSER).
  // Dateien mit `@einzeln` teilen etwas ausserhalb ihrer Datenbank (data/) und laufen allein.
  const quelle = (/** @type {string} */ f) => fs.readFileSync(path.resolve(ROOT, f), 'utf8');
  const istBrowser = (/** @type {string} */ f) =>
    /-browser\.test\.js$/.test(f) || /CHROME_BIN|helpers\/app-browser|helpers\/oberflaeche-pruefung/.test(quelle(f));
  const browser = dateien.filter(istBrowser);
  if (seriell) {
    const { code } = await lauf(dateien, 1, messung, fristBeiLast(60_000));
    if (abdeckung) await berichteAbdeckung();
    console.log(
      `[test-lauf] seriell, ${Math.round((Date.now() - start) / 1000)} s; ${ohneWerkzeug(browser, dateien, quelle)}`,
    );
    process.exit(code);
  }
  const einzeln = dateien.filter(f => !istBrowser(f) && /@einzeln\b/.test(quelle(f)));
  const uebrige = dateien.filter(f => !browser.includes(f) && !einzeln.includes(f));
  // Doppelt so viele wie Kerne: Viele Dateien warten auf die Datenbank oder Zeitgeber.
  const n = Math.max(1, Number(process.env.TEST_PARALLEL) || Math.min(2 * os.availableParallelism(), 8));
  const nb = Math.max(1, Number(process.env.TEST_PARALLEL_BROWSER) || 1);

  const basis = process.env.TEST_DATABASE_URL;
  /** @type {Record<string, string>} */
  let env = { ...messung };
  /** @type {import('pg').Client | null} */
  let admin = null;
  let vorlage = '';
  if (basis) {
    const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));
    vorlage = `${decodeURIComponent(new URL(basis).pathname.slice(1))}_vorlage`;
    const a = new Client({ connectionString: basis });
    admin = a;
    await a.connect();
    await raeumeAuf(a, vorlage, true);
    await a.query(`CREATE DATABASE ${id(vorlage)}`);
    execFileSync(
      process.execPath,
      [
        '-e',
        "const db = require('./dist/startup/verdrahtung.js').verdrahteProzess(); db.initSchemaOnce().then(() => db.pool.end()).catch(e => { console.error(e); process.exit(1); })",
      ],
      {
        cwd: ROOT,
        stdio: ['ignore', 'ignore', 'inherit'],
        env: { ...process.env, DATABASE_URL: mitDb(basis, vorlage) },
      },
    );
    env = { ...env, TEST_DB_VORLAGE: vorlage, TEST_DB_BASIS: basis };
  }
  let code = 0;
  try {
    const frist = Number(process.env.TEST_FRIST_MS) || fristBeiLast(60_000);
    if (frist > 60_000)
      console.log(`[test-lauf] Last ${(os.loadavg()[0] ?? 0).toFixed(1)}: Frist je Datei ${frist / 1000} s`);
    code = await mitNachlauf(await lauf(uebrige, n, env, frist), env, frist);
    code = (await mitNachlauf(await lauf(einzeln, 1, env, frist), env, frist)) || code;
    // Browser-Tests erlauben sich selbst 300 s; die Frist des Runners gilt je
    // Datei und darf sie nicht vorher abschneiden.
    code = (await mitNachlauf(await lauf(browser, nb, env, 300_000), env, 300_000)) || code;
  } finally {
    if (admin) {
      await raeumeAuf(admin, vorlage, true).catch(() => {});
      await admin.end();
    }
  }
  meldeNachlauf();
  if (abdeckung) await berichteAbdeckung();
  console.log(
    `[test-lauf] ${uebrige.length} Dateien zu ${n} parallel, ${einzeln.length} @einzeln, ` +
      `${browser.length} Browser zu ${nb}, ` +
      `${Math.round((Date.now() - start) / 1000)} s; ${ohneWerkzeug(browser, dateien, quelle)}`,
  );
  process.exit(code);
}

/**
 * Kopien eines früheren Laufs und (mit `auchVorlage`) die Vorlage löschen,
 * dazu Datenbanken und Rollen, die Tests unter demselben Stamm angelegt haben
 * (test/helpers/testnamen.js). Rollen danach: Sie können Datenbanken besitzen.
 */
async function raeumeAuf(/** @type {import('pg').Client} */ admin, /** @type {string} */ vorlage, auchVorlage = false) {
  const { rows } = await admin.query(
    `SELECT datname FROM pg_database WHERE datname LIKE $1 || '\\_%' OR ($2 AND datname = $1)`,
    [vorlage, auchVorlage],
  );
  for (const r of rows) await admin.query(`DROP DATABASE IF EXISTS ${id(r.datname)} WITH (FORCE)`);
  const rollen = await admin.query(`SELECT rolname FROM pg_roles WHERE rolname LIKE $1 || '\\_%'`, [vorlage]);
  for (const r of rollen.rows) {
    await admin
      .query(`DROP ROLE IF EXISTS ${id(r.rolname)}`)
      .catch((/** @type {Error} */ e) => console.warn(`[test-lauf] Rolle ${r.rolname} bleibt: ${e.message}`));
  }
}

main().catch(e => {
  console.error(`[test-lauf] ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
