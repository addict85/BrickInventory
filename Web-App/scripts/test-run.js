#!/usr/bin/env node
'use strict';

/**
 * `npm test`: build once, set up a template database once (basis.sql
 * and migrations), then the test files in parallel — each with its own copy of the
 * template (test/helpers/own-db.js). Browser tests run individually afterwards:
 * several Chromium side by side miss the deadlines on weak machines.
 */
const { execFileSync, spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const { rollen, asRole } = require(path.join(ROOT, 'test', 'helpers', 'roles.js'));
const args = process.argv.slice(2);
const seriell = args.includes('--seriell');
const abdeckung = args.includes('--abdeckung');
const auswahl = args.filter(a => a !== '--seriell' && a !== '--abdeckung');
const COVERAGE = path.join(ROOT, 'coverage');

/** @param {string} url @param {string} name */
const withDb = (url, name) => {
  const u = new URL(url);
  u.pathname = '/' + name;
  return u.toString();
};
/** @param {string} s */
const id = s => `"${s.replace(/"/g, '""')}"`;

/** Foreign load on the machine lengthens every file without it having become slower:
 * the deadline grows with the load per core, at most to four times. */
function deadlineAtLast(/** @type {number} */ grund) {
  const last = (os.loadavg()[0] ?? 0) / os.availableParallelism();
  return Math.round(grund * Math.min(4, Math.max(1, last)));
}

/**
 * A TAP report additionally goes into a file: from it the run reads which
 * files only failed on the deadline.
 * @param {string[]} dateien @param {number} n @param {Record<string, string>} env @param {number} frist
 * @returns {Promise<{ code: number, frist: string[], andere: number }>}
 */
function lauf(dateien, n, env, frist = 60_000) {
  if (!dateien.length) return Promise.resolve({ code: 0, frist: [], andere: 0 });
  // text-output.js keeps text out of the stream of the report frames, expiry.js
  // ends a child that does not end (reasoning there).
  const preloader = [
    '--require',
    path.join(ROOT, 'test', 'helpers', 'text-output.js'),
    '--require',
    path.join(ROOT, 'test', 'helpers', 'expiry.js'),
    ...(env.TEST_DB_VORLAGE ? ['--require', path.join(ROOT, 'test', 'helpers', 'own-db.js')] : []),
  ];
  const bericht = path.join(os.tmpdir(), `test-lauf-${process.pid}-${Date.now()}.tap`);
  const reporter = process.stdout.isTTY ? 'spec' : 'tap';
  return new Promise(fertig => {
    const p = spawn(
      process.execPath,
      [
        ...preloader,
        '--test',
        `--test-concurrency=${n}`,
        `--test-timeout=${frist}`,
        `--test-reporter=${reporter}`,
        '--test-reporter-destination=stdout',
        '--test-reporter=tap',
        `--test-reporter-destination=${bericht}`,
        ...dateien,
      ],
      // The file as a whole may take longer than a test, but not forever.
      {
        cwd: ROOT,
        stdio: 'inherit',
        env: { TEST_DATEI_FRIST_MS: String(Math.max(600_000, 3 * frist)), ...process.env, ...env },
      },
    );
    p.on('exit', code => {
      const tap = fs.existsSync(bericht) ? fs.readFileSync(bericht, 'utf8') : '';
      fs.rmSync(bericht, { force: true });
      fertig({ code: code ?? 1, ...deadlineError(tap, dateien) });
    });
  });
}

/** Red files at the top level: which ones only failed on the deadline, how many for other reasons.
 * @param {string} tap @param {string[]} dateien */
function deadlineError(tap, dateien) {
  /** @type {string[]} */
  const frist = [];
  let andere = 0;
  for (const block of tap.split(/\n(?=(?:not )?ok \d+ - )/).filter(b => b.startsWith('not ok'))) {
    // The name is the file (it itself ran too long) or a test in it (location).
    const name = /^not ok \d+ - (.*)/.exec(block)?.[1]?.trim() ?? '';
    const ort = /location: '(.+?):\d+:\d+'/.exec(block)?.[1] ?? name;
    const datei = dateien.find(d => [name, ort].some(x => path.resolve(ROOT, d) === path.resolve(ROOT, x)));
    if (datei && /testTimeoutFailure|timed out after/.test(block)) {
      if (!frist.includes(datei)) frist.push(datei);
    } else andere++;
  }
  return { frist, andere };
}

/** Files that only turned green in the follow-up run: they stand at the end of the run
 * and as a warning in the CI, so that a slow test does not stay silent. */
/** @type {string[]} */
const nachgelaufen = [];

/** Whatever only failed on the deadline runs again individually: under load a
 * slip, red individually an error. With TEST_NACHLAUF=aus there is no
 * follow-up run, then the deadline overrun is already red. */
async function withFollowUp(
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

/** At the end of the run, not between hundreds of test lines. */
function reportFollowUp() {
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

/** Report from the V8 files (scripts/coverage.js); the raw data is superfluous afterwards. */
async function reportsCoverage() {
  const bereiche = await require('./coverage').bericht(path.join(COVERAGE, 'v8'));
  console.log(`[test-lauf] Abdeckung (Zeilen %): ${JSON.stringify(bereiche)}`);
  fs.rmSync(path.join(COVERAGE, 'v8'), { recursive: true, force: true });
}

/**
 * How many files only skip for lack of a tool: without Chrome the browser files are green without
 * having checked. With REQUIRE_BROWSER=1 or REQUIRE_CADDY=1 they fail instead and do not count.
 * @param {string[]} browser @param {string[]} alle @param {(f: string) => string} quelle
 */
function withoutTool(browser, alle, quelle) {
  let chromeDa = true;
  // The same search as the browser tests; the path as an expression, so that tsc does not check the test helper too.
  try {
    chromeDa = !!require(path.join(ROOT, 'test', 'helpers', 'app-browser.js')).chrome();
  } catch {
    /* REQUIRE_BROWSER=1: red instead of silent */
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
    // a run within a run does not build: parallel files read dist/ and the bundle
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-ts.js'), '--outdir', path.join(ROOT, 'dist')], {
      stdio: 'ignore',
    });
    // The bundle is not in git: build it once and always anew, the parallel files only read it.
    require('./build-frontend').buildBundle(path.join(ROOT, 'public', 'js', 'app.bundle.js'));
  }
  /** @type {Record<string, string>} */
  const measurement = { TEST_LAUF_GEBAUT: '1' };
  if (abdeckung) {
    // An own bundle with an embedded source map: the delivered one stays without.
    const withCard = path.join(ROOT, 'dist', 'abdeckung', 'app.bundle.js');
    require('./build-frontend').buildBundle(withCard, { quellkarte: true });
    fs.rmSync(COVERAGE, { recursive: true, force: true });
    fs.mkdirSync(path.join(COVERAGE, 'v8'), { recursive: true });
    Object.assign(measurement, { NODE_V8_COVERAGE: path.join(COVERAGE, 'v8'), TEST_BUENDEL: withCard });
    const erledigt = new Set();
    setInterval(() => require('./coverage').compact(path.join(COVERAGE, 'v8'), erledigt), 5000).unref();
  }

  const dateien = auswahl.length
    ? auswahl
    : fs
        .readdirSync(path.join(ROOT, 'test'))
        .filter(f => f.endsWith('.test.js'))
        .sort()
        .map(f => path.join('test', f));
  // Browser files each have their own database, port and Chrome profile; they run
  // separately, because several Chrome per core miss the deadlines (TEST_PARALLEL_BROWSER).
  // Files with `@einzeln` share something outside their database (data/) and run alone.
  const quelle = (/** @type {string} */ f) => fs.readFileSync(path.resolve(ROOT, f), 'utf8');
  const isBrowser = (/** @type {string} */ f) =>
    /-browser\.test\.js$/.test(f) || /CHROME_BIN|helpers\/app-browser|helpers\/oberflaeche-pruefung/.test(quelle(f));
  const browser = dateien.filter(isBrowser);
  if (seriell) {
    const { code } = await lauf(dateien, 1, measurement, deadlineAtLast(60_000));
    if (abdeckung) await reportsCoverage();
    console.log(
      `[test-lauf] seriell, ${Math.round((Date.now() - start) / 1000)} s; ${withoutTool(browser, dateien, quelle)}`,
    );
    process.exit(code);
  }
  const einzeln = dateien.filter(f => !isBrowser(f) && /@einzeln\b/.test(quelle(f)));
  const remaining = dateien.filter(f => !browser.includes(f) && !einzeln.includes(f));
  // Twice as many as cores: many files wait for the database or timers.
  const n = Math.max(1, Number(process.env.TEST_PARALLEL) || Math.min(2 * os.availableParallelism(), 8));
  const nb = Math.max(1, Number(process.env.TEST_PARALLEL_BROWSER) || 1);

  const basis = process.env.TEST_DATABASE_URL;
  /** @type {Record<string, string>} */
  let env = { ...measurement };
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
    // As in production: first the roles (db-rolle), then the schema as owner (migration).
    const r = rollen(vorlage);
    createRoles(basis, vorlage, r);
    execFileSync(
      process.execPath,
      [
        '-e',
        "const { db } = require('./dist/startup/wiring.js').wireProcess(); db.initSchemaOnce().then(() => db.pool.end()).catch(e => { console.error(e); process.exit(1); })",
      ],
      {
        cwd: ROOT,
        stdio: ['ignore', 'ignore', 'inherit'],
        env: { ...process.env, DATABASE_URL: asRole(withDb(basis, vorlage), r.eigen) },
      },
    );
    // The read role only gets its columns once the tables are in place (as at the next `compose up`).
    createRoles(basis, vorlage, r);
    // As after the first start of the jobs service: a web process would otherwise wait for the re-encryption.
    const v = new Client({ connectionString: withDb(basis, vorlage) });
    await v.connect();
    await v.query(`INSERT INTO run_state (key, value) VALUES ('altbestand_v2', 'Testvorlage') ON CONFLICT DO NOTHING`);
    await v.end();
    env = { ...env, TEST_DB_VORLAGE: vorlage, TEST_DB_BASIS: basis };
  }
  let code = 0;
  try {
    const frist = Number(process.env.TEST_FRIST_MS) || deadlineAtLast(60_000);
    if (frist > 60_000)
      console.log(`[test-lauf] Last ${(os.loadavg()[0] ?? 0).toFixed(1)}: Frist je Datei ${frist / 1000} s`);
    code = await withFollowUp(await lauf(remaining, n, env, frist), env, frist);
    code = (await withFollowUp(await lauf(einzeln, 1, env, frist), env, frist)) || code;
    // Browser tests allow themselves 300 s; the runner's deadline applies per
    // file and must not cut them off before that.
    code = (await withFollowUp(await lauf(browser, nb, env, 300_000), env, 300_000)) || code;
  } finally {
    if (admin) {
      await raeumeAuf(admin, vorlage, true).catch(() => {});
      await admin.end();
    }
  }
  reportFollowUp();
  if (abdeckung) await reportsCoverage();
  console.log(
    `[test-lauf] ${remaining.length} Dateien zu ${n} parallel, ${einzeln.length} @einzeln, ` +
      `${browser.length} Browser zu ${nb}, ` +
      `${Math.round((Date.now() - start) / 1000)} s; ${withoutTool(browser, dateien, quelle)}`,
  );
  process.exit(code);
}

/** postgres/app-rolle.sh against the template, as the base's superuser.
 * @param {string} basis @param {string} vorlage @param {ReturnType<typeof rollen>} r */
function createRoles(basis, vorlage, r) {
  const u = new URL(basis);
  execFileSync('sh', [path.join(ROOT, 'postgres', 'app-rolle.sh')], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: {
      ...process.env,
      PGHOST: u.hostname,
      PGPORT: u.port || '5432',
      PGUSER: decodeURIComponent(u.username),
      PGPASSWORD: decodeURIComponent(u.password),
      PGDATABASE: vorlage,
      DB_APP_USER: r.app.name,
      DB_APP_PASSWORD: r.app.passwort,
      DB_MIGRATION_USER: r.eigen.name,
      DB_MIGRATION_PASSWORD: r.eigen.passwort,
      DB_SYSTEM_USER: r.system.name,
      DB_SYSTEM_PASSWORD: r.system.passwort,
      DB_SYSTEM_WEB_USER: r.systemweb.name,
      DB_SYSTEM_WEB_PASSWORD: r.systemweb.passwort,
      DB_LESEN_USER: r.lesen.name,
      PGWEB_DB_PASSWORD: '',
    },
  });
}

/**
 * Delete copies of an earlier run and (with `alsoTemplate`) the template,
 * plus databases and roles that tests created under the same stem
 * (test/helpers/test-names.js). Roles afterwards: they can own databases.
 */
async function raeumeAuf(
  /** @type {import('pg').Client} */ admin,
  /** @type {string} */ vorlage,
  alsoTemplate = false,
) {
  const { rows } = await admin.query(
    `SELECT datname FROM pg_database WHERE datname LIKE $1 || '\\_%' OR ($2 AND datname = $1)`,
    [vorlage, alsoTemplate],
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
