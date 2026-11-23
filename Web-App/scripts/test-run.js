#!/usr/bin/env node
'use strict';

/**
 * `npm test`: build once, set up a template database once (base.sql
 * and migrations), then the test files in parallel — each with its own copy of the
 * template (test/helpers/own-db.js). Browser tests run individually afterwards:
 * several Chromium side by side miss the deadlines on weak machines.
 */
const { execFileSync, spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const { roles, asRole } = require(path.join(ROOT, 'test', 'helpers', 'roles.js'));
const args = process.argv.slice(2);
const serial = args.includes('--serial');
const coverage = args.includes('--coverage');
const selection = args.filter(a => a !== '--serial' && a !== '--coverage');
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
function deadlineAtLast(/** @type {number} */ reason) {
  const last = (os.loadavg()[0] ?? 0) / os.availableParallelism();
  return Math.round(reason * Math.min(4, Math.max(1, last)));
}

/**
 * A TAP report additionally goes into a file: from it the run reads which
 * files only failed on the deadline.
 * @param {string[]} files @param {number} n @param {Record<string, string>} env @param {number} deadline
 * @returns {Promise<{ code: number, deadline: string[], other: number }>}
 */
function run(files, n, env, deadline = 60_000) {
  if (!files.length) return Promise.resolve({ code: 0, deadline: [], other: 0 });
  // text-output.js keeps text out of the stream of the report frames, expiry.js
  // ends a child that does not end (reasoning there).
  const preloader = [
    '--require',
    path.join(ROOT, 'test', 'helpers', 'text-output.js'),
    '--require',
    path.join(ROOT, 'test', 'helpers', 'expiry.js'),
    ...(env.TEST_DB_TEMPLATE ? ['--require', path.join(ROOT, 'test', 'helpers', 'own-db.js')] : []),
  ];
  const report = path.join(os.tmpdir(), `test-lauf-${process.pid}-${Date.now()}.tap`);
  const reporter = process.stdout.isTTY ? 'spec' : 'tap';
  return new Promise(finished => {
    const p = spawn(
      process.execPath,
      [
        ...preloader,
        '--test',
        `--test-concurrency=${n}`,
        `--test-timeout=${deadline}`,
        `--test-reporter=${reporter}`,
        '--test-reporter-destination=stdout',
        '--test-reporter=tap',
        `--test-reporter-destination=${report}`,
        ...files,
      ],
      // The file as a whole may take longer than a test, but not forever.
      {
        cwd: ROOT,
        stdio: 'inherit',
        env: { TEST_FILE_DEADLINE_MS: String(Math.max(600_000, 3 * deadline)), ...process.env, ...env },
      },
    );
    p.on('exit', code => {
      const tap = fs.existsSync(report) ? fs.readFileSync(report, 'utf8') : '';
      fs.rmSync(report, { force: true });
      finished({ code: code ?? 1, ...deadlineError(tap, files) });
    });
  });
}

/** Red files at the top level: which ones only failed on the deadline, how many for other reasons.
 * @param {string} tap @param {string[]} files */
function deadlineError(tap, files) {
  /** @type {string[]} */
  const deadline = [];
  let other = 0;
  for (const block of tap.split(/\n(?=(?:not )?ok \d+ - )/).filter(b => b.startsWith('not ok'))) {
    // The name is the file (it itself ran too long) or a test in it (location).
    const name = /^not ok \d+ - (.*)/.exec(block)?.[1]?.trim() ?? '';
    const place = /location: '(.+?):\d+:\d+'/.exec(block)?.[1] ?? name;
    const file = files.find(d => [name, place].some(x => path.resolve(ROOT, d) === path.resolve(ROOT, x)));
    if (file && /testTimeoutFailure|timed out after/.test(block)) {
      if (!deadline.includes(file)) deadline.push(file);
    } else other++;
  }
  return { deadline, other };
}

/** Files that only turned green in the follow-up run: they stand at the end of the run
 * and as a warning in the CI, so that a slow test does not stay silent. */
/** @type {string[]} */
const trailing = [];

/** Whatever only failed on the deadline runs again individually: under load a
 * slip, red individually an error. With TEST_NACHLAUF=aus there is no
 * follow-up run, then the deadline overrun is already red. */
async function withFollowUp(
  /** @type {{ code: number, deadline: string[], other: number }} */ r,
  /** @type {Record<string, string>} */ env,
  /** @type {number} */ deadline,
) {
  if (!r.deadline.length) return r.code;
  for (const d of r.deadline) console.log(`::warning title=Frist überschritten::${d} (Frist ${deadline / 1000} s)`);
  if (process.env.TEST_NACHLAUF === 'aus') {
    console.log(`[test-lauf] Frist überschritten, kein Nachlauf (TEST_NACHLAUF=aus): ${r.deadline.join(', ')}`);
    return r.code || 1;
  }
  console.log(`[test-lauf] Frist überschritten, Nachlauf einzeln: ${r.deadline.join(', ')}`);
  const nach = await run(r.deadline, 1, env, deadline * 2);
  console.log(`[test-lauf] Nachlauf ${nach.code === 0 ? 'grün' : 'ROT'}: ${r.deadline.length} Dateien`);
  if (nach.code === 0) trailing.push(...r.deadline);
  return r.other > 0 ? r.code || 1 : nach.code;
}

/** At the end of the run, not between hundreds of test lines. */
function reportFollowUp() {
  if (!trailing.length) return;
  const text = `${trailing.length} Datei(en) nur im Nachlauf grün — unter Last zu langsam: ${trailing.join(', ')}`;
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
  const areas = await require('./coverage').report(path.join(COVERAGE, 'v8'));
  console.log(`[test-lauf] Abdeckung (Zeilen %): ${JSON.stringify(areas)}`);
  fs.rmSync(path.join(COVERAGE, 'v8'), { recursive: true, force: true });
}

/**
 * How many files only skip for lack of a tool: without Chrome the browser files are green without
 * having checked. Browser files only skip with SKIP_BROWSER=1 (otherwise REQUIRE_BROWSER=1 is forced);
 * with REQUIRE_CADDY=1 Caddy files fail instead and do not count.
 * @param {string[]} browser @param {string[]} all @param {(f: string) => string} source
 */
function withoutTool(browser, all, source) {
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
  const caddy = all.filter(f => /CADDY_BIN/.test(source(f))).length;
  return (
    `übersprungen: ${chromeDa ? 0 : browser.length} Browser-Dateien ohne Chrome (CHROME_BIN, SKIP_BROWSER=1), ` +
    `${caddyDa ? 0 : caddy} Caddy-Dateien ohne Caddy (CADDY_BIN, REQUIRE_CADDY=1)`
  );
}

async function main() {
  const start = Date.now();
  // A local run without Chrome was green without checking the layout; only an explicit
  // SKIP_BROWSER=1 still allows skipping (children inherit the variable).
  if (process.env.SKIP_BROWSER !== '1') process.env.REQUIRE_BROWSER = '1';
  if (process.env.TEST_RUN_BUILT !== '1') {
    // a run within a run does not build: parallel files read dist/ and the bundle
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-ts.js'), '--outdir', path.join(ROOT, 'dist')], {
      stdio: 'ignore',
    });
    // The bundle is not in git: build it once and always anew, the parallel files only read it.
    require('./build-frontend').buildBundle(path.join(ROOT, 'public', 'js', 'app.bundle.js'));
  }
  /** @type {Record<string, string>} */
  const measurement = { TEST_RUN_BUILT: '1' };
  if (coverage) {
    // An own bundle with an embedded source map: the delivered one stays without.
    const withCard = path.join(ROOT, 'dist', 'abdeckung', 'app.bundle.js');
    require('./build-frontend').buildBundle(withCard, { sourceMap: true });
    fs.rmSync(COVERAGE, { recursive: true, force: true });
    fs.mkdirSync(path.join(COVERAGE, 'v8'), { recursive: true });
    Object.assign(measurement, { NODE_V8_COVERAGE: path.join(COVERAGE, 'v8'), TEST_BUNDLE: withCard });
    const done = new Set();
    setInterval(() => require('./coverage').compact(path.join(COVERAGE, 'v8'), done), 5000).unref();
  }

  const files = selection.length
    ? selection
    : fs
        .readdirSync(path.join(ROOT, 'test'))
        .filter(f => f.endsWith('.test.js'))
        .sort()
        .map(f => path.join('test', f));
  // Browser files each have their own database, port and Chrome profile; they run
  // separately, because several Chrome per core miss the deadlines (TEST_PARALLEL_BROWSER).
  // Files with `@einzeln` share something outside their database (data/) and run alone.
  const source = (/** @type {string} */ f) => fs.readFileSync(path.resolve(ROOT, f), 'utf8');
  const isBrowser = (/** @type {string} */ f) =>
    /-browser\.test\.js$/.test(f) || /CHROME_BIN|helpers\/app-browser|helpers\/oberflaeche-pruefung/.test(source(f));
  const browser = files.filter(isBrowser);
  if (serial) {
    const { code } = await run(files, 1, measurement, deadlineAtLast(60_000));
    if (coverage) await reportsCoverage();
    console.log(
      `[test-lauf] seriell, ${Math.round((Date.now() - start) / 1000)} s; ${withoutTool(browser, files, source)}`,
    );
    process.exit(code);
  }
  const single = files.filter(f => !isBrowser(f) && /@einzeln\b/.test(source(f)));
  const remaining = files.filter(f => !browser.includes(f) && !single.includes(f));
  // Twice as many as cores: many files wait for the database or timers.
  const n = Math.max(1, Number(process.env.TEST_PARALLEL) || Math.min(2 * os.availableParallelism(), 8));
  const nb = Math.max(1, Number(process.env.TEST_PARALLEL_BROWSER) || 1);

  const basis = process.env.TEST_DATABASE_URL;
  /** @type {Record<string, string>} */
  let env = { ...measurement };
  /** @type {import('pg').Client | null} */
  let admin = null;
  let template = '';
  if (basis) {
    const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));
    template = `${decodeURIComponent(new URL(basis).pathname.slice(1))}_vorlage`;
    const a = new Client({ connectionString: basis });
    admin = a;
    await a.connect();
    await cleanUp(a, template, true);
    await a.query(`CREATE DATABASE ${id(template)}`);
    // As in production: first the roles (db-rolle), then the schema as owner (migration).
    const r = roles(template);
    createRoles(basis, template, r);
    execFileSync(
      process.execPath,
      [
        '-e',
        "const { db } = require('./dist/startup/wiring.js').wireProcess(); db.initSchemaOnce().then(() => db.pool.end()).catch(e => { console.error(e); process.exit(1); })",
      ],
      {
        cwd: ROOT,
        stdio: ['ignore', 'ignore', 'inherit'],
        env: { ...process.env, DATABASE_URL: asRole(withDb(basis, template), r.own) },
      },
    );
    // The read role only gets its columns once the tables are in place (as at the next `compose up`).
    createRoles(basis, template, r);
    // As after the first start of the jobs service: a web process would otherwise wait for the re-encryption.
    const v = new Client({ connectionString: withDb(basis, template) });
    await v.connect();
    await v.query(`INSERT INTO run_state (key, value) VALUES ('altbestand_v2', 'Testvorlage') ON CONFLICT DO NOTHING`);
    await v.end();
    env = { ...env, TEST_DB_TEMPLATE: template, TEST_DB_BASIS: basis };
  }
  let code = 0;
  try {
    const deadline = Number(process.env.TEST_DEADLINE_MS) || deadlineAtLast(60_000);
    if (deadline > 60_000)
      console.log(`[test-lauf] Last ${(os.loadavg()[0] ?? 0).toFixed(1)}: Frist je Datei ${deadline / 1000} s`);
    code = await withFollowUp(await run(remaining, n, env, deadline), env, deadline);
    code = (await withFollowUp(await run(single, 1, env, deadline), env, deadline)) || code;
    // Browser tests allow themselves 300 s; the runner's deadline applies per
    // file and must not cut them off before that.
    code = (await withFollowUp(await run(browser, nb, env, 300_000), env, 300_000)) || code;
  } finally {
    if (admin) {
      await cleanUp(admin, template, true).catch(() => {});
      await admin.end();
    }
  }
  reportFollowUp();
  if (coverage) await reportsCoverage();
  console.log(
    `[test-lauf] ${remaining.length} Dateien zu ${n} parallel, ${single.length} @einzeln, ` +
      `${browser.length} Browser zu ${nb}, ` +
      `${Math.round((Date.now() - start) / 1000)} s; ${withoutTool(browser, files, source)}`,
  );
  process.exit(code);
}

/** postgres/app-role.sh against the template, as the base's superuser.
 * @param {string} basis @param {string} template @param {ReturnType<typeof roles>} r */
function createRoles(basis, template, r) {
  const u = new URL(basis);
  execFileSync('sh', [path.join(ROOT, 'postgres', 'app-role.sh')], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: {
      ...process.env,
      PGHOST: u.hostname,
      PGPORT: u.port || '5432',
      PGUSER: decodeURIComponent(u.username),
      PGPASSWORD: decodeURIComponent(u.password),
      PGDATABASE: template,
      DB_APP_USER: r.app.name,
      DB_APP_PASSWORD: r.app.password,
      DB_MIGRATION_USER: r.own.name,
      DB_MIGRATION_PASSWORD: r.own.password,
      DB_SYSTEM_USER: r.system.name,
      DB_SYSTEM_PASSWORD: r.system.password,
      DB_SYSTEM_WEB_USER: r.systemweb.name,
      DB_SYSTEM_WEB_PASSWORD: r.systemweb.password,
      DB_LESEN_USER: r.read.name,
      PGWEB_DB_PASSWORD: '',
    },
  });
}

/**
 * Delete copies of an earlier run and (with `alsoTemplate`) the template,
 * plus databases and roles that tests created under the same stem
 * (test/helpers/test-names.js). Roles afterwards: they can own databases.
 */
async function cleanUp(/** @type {import('pg').Client} */ admin, /** @type {string} */ template, alsoTemplate = false) {
  const { rows } = await admin.query(
    `SELECT datname FROM pg_database WHERE datname LIKE $1 || '\\_%' OR ($2 AND datname = $1)`,
    [template, alsoTemplate],
  );
  for (const r of rows) await admin.query(`DROP DATABASE IF EXISTS ${id(r.datname)} WITH (FORCE)`);
  const roles = await admin.query(`SELECT rolname FROM pg_roles WHERE rolname LIKE $1 || '\\_%'`, [template]);
  for (const r of roles.rows) {
    await admin
      .query(`DROP ROLE IF EXISTS ${id(r.rolname)}`)
      .catch((/** @type {Error} */ e) => console.warn(`[test-lauf] Rolle ${r.rolname} bleibt: ${e.message}`));
  }
}

main().catch(e => {
  console.error(`[test-lauf] ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
