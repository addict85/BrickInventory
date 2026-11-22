#!/usr/bin/env node
/**
 * Coverage from the V8 files of a test run (test-run.js --abdeckung):
 * server from dist/, UI via the source map of the measurement bundle down into
 * public/js/. An own evaluation instead of `c8 report`: c8 discarded the UI's functions
 * when rewriting the source map paths (everything 100 %, 0 functions).
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TARGET = path.join(ROOT, 'coverage');
const BUNDLES = path.join(ROOT, 'dist', 'abdeckung', 'app.bundle.js');
/** Areas of the limits: prefix relative to ROOT. */
const AREAS = {
  gesamt: '',
  server: 'dist/',
  clients: 'dist/clients/',
  jobs: 'dist/jobs/',
  oberflaeche: 'public/js/',
};

const nm = (/** @type {string} */ p) => require(path.join(ROOT, 'node_modules', p));

const DIST = path.join(ROOT, 'dist') + path.sep;
/** Only the server (dist/) and the measurement bundle count; node_modules, jsdom and Node itself do not. */
const relevant = (/** @type {{ url: string }} */ s) => {
  if (!s.url.startsWith('file://')) return false;
  const p = new URL(s.url).pathname;
  return p === BUNDLES || (p.startsWith(DIST) && !p.startsWith(path.dirname(BUNDLES)));
};

/**
 * Writes finished V8 files back filtered: a process with jsdom otherwise leaves
 * several MB, a whole run several GB. Half-written files stay
 * for the next pass.
 * @param {string} v8 @param {Set<string>} done
 */
function compact(v8, done = new Set()) {
  for (const f of fs.readdirSync(v8).filter(n => n.endsWith('.json') && !done.has(n))) {
    const file = path.join(v8, f);
    let data;
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    fs.writeFileSync(file, JSON.stringify({ result: data.result.filter(relevant) }));
    done.add(f);
  }
  return done;
}

async function bericht(v8 = path.join(TARGET, 'v8'), target = TARGET) {
  const { mergeProcessCovs } = nm('@bcoe/v8-coverage');
  const v2i = nm('v8-to-istanbul');
  const libCoverage = nm('istanbul-lib-coverage');
  const libReport = nm('istanbul-lib-report');
  const reports = nm('istanbul-reports');
  const measured = [];
  for (const f of fs.readdirSync(v8).filter(n => n.endsWith('.json'))) {
    const { result } = JSON.parse(fs.readFileSync(path.join(v8, f), 'utf8'));
    measured.push({ result: result.filter(relevant) });
  }
  const map = libCoverage.createCoverageMap({});
  for (const script of mergeProcessCovs(measured).result) {
    const file = new URL(script.url).pathname;
    // Sources of the source map outside of public/js (esbuild helpers) do not count.
    const umw = v2i(
      file,
      file === BUNDLES ? 0 : undefined,
      {},
      (/** @type {string} */ q) =>
        file === BUNDLES && !path.resolve(path.dirname(BUNDLES), q).startsWith(path.join(ROOT, 'public', 'js')),
    );
    await umw.load();
    umw.applyCoverage(script.functions);
    map.merge(umw.toIstanbul());
    umw.destroy();
  }
  const context = libReport.createContext({ dir: target, coverageMap: map, sourceFinder: () => '' });
  for (const art of ['lcovonly', 'json-summary', 'text-summary']) reports.create(art).execute(context);
  const areas = zusammenfassung(map);
  fs.writeFileSync(path.join(target, 'bereiche.json'), `${JSON.stringify(areas, null, 2)}\n`);
  return areas;
}

/** Line coverage per area in percent, one decimal place. */
function zusammenfassung(/** @type {any} */ map) {
  /** @type {Record<string, { gedeckt: number, gesamt: number }>} */
  const sum = Object.fromEntries(Object.keys(AREAS).map(k => [k, { gedeckt: 0, gesamt: 0 }]));
  for (const file of map.files()) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    const z = map.fileCoverageFor(file).toSummary().lines;
    for (const [k, prefix] of Object.entries(AREAS)) {
      const b = sum[k];
      if (!b || !rel.startsWith(prefix)) continue;
      b.gedeckt += z.covered;
      b.gesamt += z.total;
    }
  }
  return Object.fromEntries(
    Object.entries(sum).map(([k, s]) => [k, s.gesamt ? Math.floor((1000 * s.gedeckt) / s.gesamt) / 10 : 0]),
  );
}

/** Red if an area falls below its limit; names areas whose limit can be raised. */
function pruefen(
  /** @type {Record<string, number>} */ actual,
  limitsFile = path.join(__dirname, 'abdeckung-schranken.json'),
) {
  /** @type {Record<string, number>} */
  const limits = JSON.parse(fs.readFileSync(limitsFile, 'utf8'));
  const toLittle = Object.entries(limits).filter(([k, s]) => !((actual[k] ?? -1) >= s));
  for (const [k, s] of Object.entries(limits))
    console.log(
      `[abdeckung] ${k.padEnd(12)} ${String(actual[k]).padStart(5)} % (Schranke ${s} %)${(actual[k] ?? -1) >= s + 1 ? ' — nachziehen' : ''}`,
    );
  return toLittle.map(([k, s]) => `${k}: ${actual[k]} % < ${s} %`);
}

module.exports = { bericht, pruefen, compact, zusammenfassung, AREAS };

if (require.main === module) {
  const art = process.argv[2];
  (async () => {
    if (art === 'bericht') {
      console.log(JSON.stringify(await bericht()));
      return;
    }
    if (art === 'pruefen') {
      const file = path.join(TARGET, 'bereiche.json');
      if (!fs.existsSync(file)) {
        console.error('[abdeckung] coverage/bereiche.json fehlt — erst npm test -- --abdeckung');
        process.exit(2);
      }
      const error = pruefen(JSON.parse(fs.readFileSync(file, 'utf8')));
      if (error.length) {
        console.error(`[abdeckung] unter der Schranke: ${error.join(', ')}`);
        process.exit(1);
      }
      return;
    }
    console.error('Aufruf: node scripts/coverage.js bericht|pruefen');
    process.exit(2);
  })().catch(e => {
    console.error(e);
    process.exit(2);
  });
}
