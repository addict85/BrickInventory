#!/usr/bin/env node
/**
 * Load profile — how does the server behave under CONCURRENT requests?
 */

const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DB_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

if (!DB_URL) {
  console.error('Bitte TEST_DATABASE_URL setzen (das Schema darin wird GELEERT).');
  process.exit(1);
}
if (/prod|live/i.test(DB_URL)) {
  console.error(`Die Verbindung sieht nach Produktion aus — abgebrochen: ${DB_URL}`);
  process.exit(1);
}
process.env.DATABASE_URL = DB_URL;

// ── Arguments ───────────────────────────────────────────────────────────────
/**
 * Read a command line argument as a number.
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
}
const USERS = arg('users', 20); // concurrent virtual users
const DURATION_S = arg('dauer', 10); // measurement duration per pass
const N_SETS = arg('sets', 800); // collection size (as in pass 119)

const dbModule = require(path.join(ROOT, 'dist/db/database.js'));
const db = dbModule.createDb(dbModule.dbConfigFromEnvironment());
// The routes call the areas via their wiring, as in the server.
const wiring = require(path.join(ROOT, 'dist/startup/wiring.js'));
const dienste = wiring.buildServices(db);

/**
 * Readable text of a caught error.
 *
 * Deliberately an own, short version instead of src/infra/error: this script
 * runs as a standalone tool via `node`, without the build — it cannot
 * load a TypeScript module at all. The rule is the same: a thrown
 * string or an object without `message` should not end as "undefined".
 * @param {unknown} e
 * @returns {string}
 */
function errorText(e) {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string' && e) return e;
  // The detour via the intermediate variable is necessary because `typeof e === 'object'`
  // narrows the type to `object`, which knows no `message`.
  const m = e ? /** @type {any} */ (e).message : undefined;
  if (typeof m === 'string' && m) return m;
  // `String([])` is empty — see src/infra/error.ts, found there.
  return e === null || e === undefined ? 'Unbekannter Fehler' : String(e) || 'Unbekannter Fehler';
}

const USER = { id: null, username: 'loadtest-user' };

// ── Seed: a collection of realistic size ────────────────────────────────────
async function seed() {
  console.log(`Seed: ${N_SETS} Sets, Teile und Preisverlauf …`);
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchemaOnce();

  await db.run(`INSERT INTO users (username, password_hash) VALUES ($1, 'x')`, [USER.username]);
  USER.id = (await db.get(`SELECT id FROM users WHERE username = $1`, [USER.username])).id;

  await db.run(`INSERT INTO rb_themes (id, name) SELECT g, 'Theme '||g FROM generate_series(1, 12) g
                ON CONFLICT (id) DO NOTHING`);
  await db.run(
    `INSERT INTO rb_sets (set_num, name, year, theme_id, num_parts)
     SELECT (10000+g)||'-1', 'Set '||g, 1990 + (g % 35), 1 + g%12, 100 + (g*7)%8000
       FROM generate_series(1, $1) g
     ON CONFLICT (set_num) DO NOTHING`,
    [N_SETS],
  );
  await db.run(
    `INSERT INTO set_catalog (set_number, minifigs)
     SELECT (10000+g)||'-1', g%9 FROM generate_series(1, $1) g
     ON CONFLICT (set_number) DO NOTHING`,
    [N_SETS],
  );
  await db.run(
    `INSERT INTO sets (user_id, set_number)
     SELECT $1, (10000+g)||'-1' FROM generate_series(1, $2) g`,
    [USER.id, N_SETS],
  );

  // Acquisitions: since migration 0036 they are the ONLY source of the
  // piece count. 1 to 3 copies per set, spread over two years.
  await db.run(
    `INSERT INTO set_acquisitions (user_id, set_number, purchase_price, condition, quantity, created_at)
     SELECT $1, (10000+g)||'-1', 20 + (g%400), CASE WHEN g%3=0 THEN 'U' ELSE 'N' END,
            1 + (g%3),
            NOW() - ((g % 700) || ' days')::interval
       FROM generate_series(1, $2) g`,
    [USER.id, N_SETS],
  );

  // Parts: ~75 per set — with 800 sets that yields the order of magnitude 60,000
  // from the measurements of pass 119.
  await db.run(
    `INSERT INTO part_catalog (part_number, part_name)
     SELECT DISTINCT (3000 + (g*13 + p) % 900)::text, 'Part '||((g*13+p)%900)
       FROM generate_series(1, $1) g, generate_series(1, 75) p
     ON CONFLICT (part_number) DO NOTHING`,
    [N_SETS],
  );
  await db.run(
    `INSERT INTO part_color_catalog (part_number, color_id, color_name)
     SELECT DISTINCT (3000 + (g*13 + p) % 900)::text, (p % 60), 'Color '||(p % 60)
       FROM generate_series(1, $1) g, generate_series(1, 75) p
     ON CONFLICT (part_number, color_id) DO NOTHING`,
    [N_SETS],
  );
  // BrickLink numbers already looked up: otherwise every parts list starts a reload over the network.
  await db.run(
    `INSERT INTO bl_mapping (type, rb_id, bl_id)
     SELECT 'part', part_number, part_number FROM part_catalog ON CONFLICT DO NOTHING`,
  );
  // The piece count of a part from a set is in the set's contents (set_parts), not in parts.
  await db.run(
    `INSERT INTO set_parts (set_number, part_number, color_id, quantity)
     SELECT (10000+g)||'-1', (3000 + (g*13 + p) % 900)::text, (p % 60), 1 + (p % 4)
       FROM generate_series(1, $1) g, generate_series(1, 75) p
     ON CONFLICT DO NOTHING`,
    [N_SETS],
  );
  await db.run(
    `INSERT INTO parts (user_id, set_number, part_number, color_id, source)
     SELECT $1, set_number, part_number, color_id, 'set' FROM set_parts`,
    [USER.id],
  );

  await db.run(
    `INSERT INTO minifigs_catalog (fig_number, fig_name)
     SELECT DISTINCT 'fig'||((g*3+m)%2500), 'Minifig '||((g*3+m)%2500)
       FROM generate_series(1, $1) g, generate_series(1, 4) m
     ON CONFLICT (fig_number) DO NOTHING`,
    [N_SETS],
  );
  await db.run(
    `INSERT INTO set_minifigs (set_number, fig_number, quantity)
     SELECT (10000+g)||'-1', 'fig'||((g*3+m)%2500), 1
       FROM generate_series(1, $1) g, generate_series(1, 4) m
     ON CONFLICT DO NOTHING`,
    [N_SETS],
  );
  await db.run(
    `INSERT INTO minifigs (user_id, set_number, fig_number, source)
     SELECT $1, set_number, fig_number, 'set' FROM set_minifigs`,
    [USER.id],
  );

  // Market prices per condition — without them the finance endpoints compute on nothing.
  await db.run(
    `INSERT INTO price_cache (set_number, condition, currency_code, min_price, avg_price, max_price, qty_avg_price, total_quantity)
     SELECT (10000+g)||'-1', c, 'EUR', 10+(g%300), 30+(g%500), 60+(g%800), 31+(g%500), 5
       FROM generate_series(1, $1) g, (VALUES ('N'),('U')) AS t(c)`,
    [N_SETS],
  );

  // Price history: 180 days, but with gaps (not every set writes daily).
  await db.run(
    `INSERT INTO price_history (set_number, condition, currency_code, avg_price, qty_avg_price, recorded_at)
     SELECT (10000+g)||'-1', 'N', 'EUR', 30 + (g%500) + d*0.05, 31 + (g%500),
            (CURRENT_DATE - (180 - d))::timestamptz + interval '9 hours'
       FROM generate_series(1, $1) g, generate_series(1, 180) d
      WHERE (d + g) % 4 = 0`,
    [N_SETS],
  );

  /** @param {string} t table name — hard-wired below, no input */
  const z = async t => (await db.get(`SELECT count(*)::int n FROM ${t}`)).n;
  console.log(
    `  → sets ${await z('sets')}, parts ${await z('parts')}, ` +
      `minifigs ${await z('minifigs')}, price_history ${await z('price_history')}\n`,
  );
}

// ── The real stack, as in the parity test ───────────────────────────────────
// The app from startup/app.ts (baueApp); only the session store is provided,
// so that the run gets by without login.
function buildApp() {
  return require(path.join(ROOT, 'dist/startup/app.js')).buildApp({
    pool: db.pool,
    config: require(path.join(ROOT, 'dist/src/infra/config.js')).config(),
    sitzungsGeheimnis: 'lasttest-sitzungsgeheimnis-lang-genug',
    dienste,
    sessionStorage: (/** @type {any} */ req, /** @type {any} */ _res, /** @type {any} */ next) => {
      req.session = { userId: USER.id, username: USER.username, isAdmin: false };
      next();
    },
  });
}

// The endpoints a session actually touches: open the gallery, page through
// parts, look at finances.
/** @type {Array<[string, string]>} */
const PATHS = [
  ['Galerie (Seite 1)', '/api/v1/sets?page=1&page_size=60'],
  ['Galerie (Seite 5)', '/api/v1/sets?page=5&page_size=60'],
  ['Teile-Liste', '/api/v1/parts?page=1&page_size=60'],
  ['Teile-Suche', '/api/v1/parts?search=Part%201&page=1&page_size=60'],
  ['Teile-Statistik', '/api/v1/parts/stats'],
  ['Minifiguren', '/api/v1/minifigs?page=1&page_size=60'],
  ['Bewertung Sets', '/api/v1/finance/valuation'],
  ['GuV', '/api/v1/finance/pnl'],
  ['Portfolio-Verlauf', '/api/v1/finance/portfolio-history?period=year'],
];

/**
 * @param {number[]} arr
 * @param {number} p  share between 0 and 1, e.g. 0.5 for the median
 */
/**
 * @param {number[]} arr
 * @param {number} p
 * @returns {number}
 */
const percentile = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  // The index is capped by the Math.min and the list is not empty —
  // `?? 0` is the assurance for the checker, not a second case.
  return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0;
};

/**
 * Measure a route once.
 * @param {string} base
 * @param {string} path
 */
async function miss(base, path) {
  const t0 = process.hrtime.bigint();
  const r = await fetch(base + path);
  await r.arrayBuffer(); // read the response completely
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { ms, ok: r.status === 200, status: r.status };
}

async function main() {
  await seed();
  const app = buildApp();
  const srv = app.listen(0);
  const base = `http://localhost:${srv.address().port}`;

  // Warm-up: the first hit builds caches and query plans.
  for (const [, path] of PATHS) await miss(base, path).catch(() => {});

  // ── Pass 1: alone (reference) ───────────────────────────────────────────────
  console.log('Referenz ohne Nebenlast (je 5 Aufrufe, Median):');
  // The types are here because `{}` has no keys for the checker —
  // `allein[name] = …` would otherwise be a write to a field that
  // does not exist according to the type.
  /** @type {Record<string, number>} */
  const alone = {};
  for (const [name, path] of PATHS) {
    // The median is computed ONCE and kept in a variable instead of
    // reading it from the map again after writing. That is not only
    // type-safe (a read access on a map can be empty), but also says
    // better what happens here.
    const w = [];
    for (let i = 0; i < 5; i++) w.push((await miss(base, path)).ms);
    const median = percentile(w, 0.5);
    alone[name] = median;
    console.log(`  ${name.padEnd(24)} ${median.toFixed(0).padStart(6)} ms`);
  }

  // ── Pass 2: USERS concurrently, for DURATION_S ──────────────────────────────
  console.log(`\n${USERS} gleichzeitige Nutzer, ${DURATION_S} s …`);
  /** @type {Record<string, number[]>} */
  const measurement = Object.fromEntries(PATHS.map(([n]) => [n, []]));
  /** @type {Record<string, number>} */
  const error = {};
  const end = Date.now() + DURATION_S * 1000;
  let total = 0;

  /** @param {number} id */
  const userRow = async id => {
    // Staggered start, so that not all run in lockstep.
    await new Promise(r => setTimeout(r, (id * 37) % 250));
    while (Date.now() < end) {
      // The fallback to the first entry makes visible that the list
      // is never empty — an index into an array may still be off even with tuple elements
      // as far as the type is concerned.
      const entry = PATHS[Math.floor(Math.random() * PATHS.length)];
      if (!entry) continue; // PATHS is never empty; this tells the checker
      const [name, p] = entry;
      try {
        const { ms, ok, status } = await miss(base, p);
        measurement[name] ??= [];
        measurement[name].push(ms);
        total++;
        if (!ok) error[`${name} → HTTP ${status}`] = (error[`${name} → HTTP ${status}`] || 0) + 1;
      } catch (e) {
        error[`${name} → ${errorText(e)}`] = (error[`${name} → ${errorText(e)}`] || 0) + 1;
      }
    }
  };
  const t0 = Date.now();
  await Promise.all(Array.from({ length: USERS }, (_, i) => userRow(i)));
  const sec = (Date.now() - t0) / 1000;

  // ── Output ──────────────────────────────────────────────────────────────────
  console.log(`\n${total} Anfragen in ${sec.toFixed(1)} s = ${(total / sec).toFixed(0)}/s\n`);
  console.log('Endpunkt                   allein     p50     p95     max   Faktor   n');
  console.log('─'.repeat(76));
  for (const [name] of PATHS) {
    // An endpoint no user hit during the runtime has no
    // measurements — `?? []` is not a sedative here, but the case.
    const w = measurement[name] ?? [];
    const reference = alone[name] ?? 0;
    const p50 = percentile(w, 0.5),
      p95 = percentile(w, 0.95),
      max = Math.max(0, ...w);
    const factor = reference > 0 ? p50 / reference : 0;
    console.log(
      `${name.padEnd(24)} ${reference.toFixed(0).padStart(6)}  ${p50.toFixed(0).padStart(6)}  ` +
        `${p95.toFixed(0).padStart(6)}  ${max.toFixed(0).padStart(6)}  ${factor.toFixed(1).padStart(6)}x  ${String(w.length).padStart(4)}`,
    );
  }
  const errorList = Object.entries(error);
  if (errorList.length) {
    // A run with errors does not measure what it claims to: red, also for the test that starts the script.
    process.exitCode = 1;
    console.log('\n⚠️  Fehler:');
    for (const [k, n] of errorList) console.log(`  ${n}× ${k}`);
  } else {
    console.log('\n✅ Keine Fehler — alle Antworten HTTP 200.');
  }
  console.log('\nLesehilfe: „Faktor" ist p50 geteilt durch „allein". Nahe 1 = der');
  console.log('Endpunkt trägt die Last; deutlich darüber = er wird zum Engpass.');

  srv.close();
  await db.pool.end();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
