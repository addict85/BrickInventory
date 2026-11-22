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
const ZIEL = path.join(ROOT, 'coverage');
const BUENDEL = path.join(ROOT, 'dist', 'abdeckung', 'app.bundle.js');
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
  return p === BUENDEL || (p.startsWith(DIST) && !p.startsWith(path.dirname(BUENDEL)));
};

/**
 * Writes finished V8 files back filtered: a process with jsdom otherwise leaves
 * several MB, a whole run several GB. Half-written files stay
 * for the next pass.
 * @param {string} v8 @param {Set<string>} erledigt
 */
function compact(v8, erledigt = new Set()) {
  for (const f of fs.readdirSync(v8).filter(n => n.endsWith('.json') && !erledigt.has(n))) {
    const datei = path.join(v8, f);
    let daten;
    try {
      daten = JSON.parse(fs.readFileSync(datei, 'utf8'));
    } catch {
      continue;
    }
    fs.writeFileSync(datei, JSON.stringify({ result: daten.result.filter(relevant) }));
    erledigt.add(f);
  }
  return erledigt;
}

async function bericht(v8 = path.join(ZIEL, 'v8'), ziel = ZIEL) {
  const { mergeProcessCovs } = nm('@bcoe/v8-coverage');
  const v2i = nm('v8-to-istanbul');
  const libCoverage = nm('istanbul-lib-coverage');
  const libReport = nm('istanbul-lib-report');
  const reports = nm('istanbul-reports');
  const gemessen = [];
  for (const f of fs.readdirSync(v8).filter(n => n.endsWith('.json'))) {
    const { result } = JSON.parse(fs.readFileSync(path.join(v8, f), 'utf8'));
    gemessen.push({ result: result.filter(relevant) });
  }
  const karte = libCoverage.createCoverageMap({});
  for (const script of mergeProcessCovs(gemessen).result) {
    const datei = new URL(script.url).pathname;
    // Sources of the source map outside of public/js (esbuild helpers) do not count.
    const umw = v2i(
      datei,
      datei === BUENDEL ? 0 : undefined,
      {},
      (/** @type {string} */ q) =>
        datei === BUENDEL && !path.resolve(path.dirname(BUENDEL), q).startsWith(path.join(ROOT, 'public', 'js')),
    );
    await umw.load();
    umw.applyCoverage(script.functions);
    karte.merge(umw.toIstanbul());
    umw.destroy();
  }
  const kontext = libReport.createContext({ dir: ziel, coverageMap: karte, sourceFinder: () => '' });
  for (const art of ['lcovonly', 'json-summary', 'text-summary']) reports.create(art).execute(kontext);
  const bereiche = zusammenfassung(karte);
  fs.writeFileSync(path.join(ziel, 'bereiche.json'), `${JSON.stringify(bereiche, null, 2)}\n`);
  return bereiche;
}

/** Line coverage per area in percent, one decimal place. */
function zusammenfassung(/** @type {any} */ karte) {
  /** @type {Record<string, { gedeckt: number, gesamt: number }>} */
  const summe = Object.fromEntries(Object.keys(AREAS).map(k => [k, { gedeckt: 0, gesamt: 0 }]));
  for (const datei of karte.files()) {
    const rel = path.relative(ROOT, datei).split(path.sep).join('/');
    const z = karte.fileCoverageFor(datei).toSummary().lines;
    for (const [k, praefix] of Object.entries(AREAS)) {
      const b = summe[k];
      if (!b || !rel.startsWith(praefix)) continue;
      b.gedeckt += z.covered;
      b.gesamt += z.total;
    }
  }
  return Object.fromEntries(
    Object.entries(summe).map(([k, s]) => [k, s.gesamt ? Math.floor((1000 * s.gedeckt) / s.gesamt) / 10 : 0]),
  );
}

/** Red if an area falls below its limit; names areas whose limit can be raised. */
function pruefen(
  /** @type {Record<string, number>} */ ist,
  limitsFile = path.join(__dirname, 'abdeckung-schranken.json'),
) {
  /** @type {Record<string, number>} */
  const schranken = JSON.parse(fs.readFileSync(limitsFile, 'utf8'));
  const toLittle = Object.entries(schranken).filter(([k, s]) => !((ist[k] ?? -1) >= s));
  for (const [k, s] of Object.entries(schranken))
    console.log(
      `[abdeckung] ${k.padEnd(12)} ${String(ist[k]).padStart(5)} % (Schranke ${s} %)${(ist[k] ?? -1) >= s + 1 ? ' — nachziehen' : ''}`,
    );
  return toLittle.map(([k, s]) => `${k}: ${ist[k]} % < ${s} %`);
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
      const datei = path.join(ZIEL, 'bereiche.json');
      if (!fs.existsSync(datei)) {
        console.error('[abdeckung] coverage/bereiche.json fehlt — erst npm test -- --abdeckung');
        process.exit(2);
      }
      const fehler = pruefen(JSON.parse(fs.readFileSync(datei, 'utf8')));
      if (fehler.length) {
        console.error(`[abdeckung] unter der Schranke: ${fehler.join(', ')}`);
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
