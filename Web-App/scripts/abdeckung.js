#!/usr/bin/env node
/**
 * Abdeckung aus den V8-Dateien eines Testlaufs (test-lauf.js --abdeckung):
 * Server aus dist/, Oberfläche über die Sourcemap des Mess-Bündels bis in
 * public/js/. Eigene Auswertung statt `c8 report`: c8 verwarf die Funktionen
 * der Oberfläche beim Umschreiben der Sourcemap-Pfade (alles 100 %, 0 Funktionen).
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ZIEL = path.join(ROOT, 'coverage');
const BUENDEL = path.join(ROOT, 'dist', 'abdeckung', 'app.bundle.js');
/** Bereiche der Schranken: Präfix relativ zu ROOT. */
const BEREICHE = {
  gesamt: '',
  server: 'dist/',
  clients: 'dist/clients/',
  jobs: 'dist/jobs/',
  oberflaeche: 'public/js/',
};

const nm = (/** @type {string} */ p) => require(path.join(ROOT, 'node_modules', p));

const DIST = path.join(ROOT, 'dist') + path.sep;
/** Nur Server (dist/) und das Mess-Bündel zählen; node_modules, jsdom und Node selbst nicht. */
const relevant = (/** @type {{ url: string }} */ s) => {
  if (!s.url.startsWith('file://')) return false;
  const p = new URL(s.url).pathname;
  return p === BUENDEL || (p.startsWith(DIST) && !p.startsWith(path.dirname(BUENDEL)));
};

/**
 * Schreibt fertige V8-Dateien gefiltert zurück: Ein Prozess mit jsdom hinterlässt
 * sonst einige MB, ein ganzer Lauf mehrere GB. Halb geschriebene Dateien bleiben
 * für den nächsten Durchgang liegen.
 * @param {string} v8 @param {Set<string>} erledigt
 */
function verdichte(v8, erledigt = new Set()) {
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
  for (const skript of mergeProcessCovs(gemessen).result) {
    const datei = new URL(skript.url).pathname;
    // Quellen der Sourcemap ausserhalb von public/js (esbuild-Hilfen) zählen nicht.
    const umw = v2i(
      datei,
      datei === BUENDEL ? 0 : undefined,
      {},
      (/** @type {string} */ q) =>
        datei === BUENDEL && !path.resolve(path.dirname(BUENDEL), q).startsWith(path.join(ROOT, 'public', 'js')),
    );
    await umw.load();
    umw.applyCoverage(skript.functions);
    karte.merge(umw.toIstanbul());
    umw.destroy();
  }
  const kontext = libReport.createContext({ dir: ziel, coverageMap: karte, sourceFinder: () => '' });
  for (const art of ['lcovonly', 'json-summary', 'text-summary']) reports.create(art).execute(kontext);
  const bereiche = zusammenfassung(karte);
  fs.writeFileSync(path.join(ziel, 'bereiche.json'), `${JSON.stringify(bereiche, null, 2)}\n`);
  return bereiche;
}

/** Zeilenabdeckung je Bereich in Prozent, eine Nachkommastelle. */
function zusammenfassung(/** @type {any} */ karte) {
  /** @type {Record<string, { gedeckt: number, gesamt: number }>} */
  const summe = Object.fromEntries(Object.keys(BEREICHE).map(k => [k, { gedeckt: 0, gesamt: 0 }]));
  for (const datei of karte.files()) {
    const rel = path.relative(ROOT, datei).split(path.sep).join('/');
    const z = karte.fileCoverageFor(datei).toSummary().lines;
    for (const [k, praefix] of Object.entries(BEREICHE)) {
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

/** Rot, wenn ein Bereich unter seine Schranke fällt; nennt Bereiche, deren Schranke nachgezogen werden kann. */
function pruefen(
  /** @type {Record<string, number>} */ ist,
  schrankenDatei = path.join(__dirname, 'abdeckung-schranken.json'),
) {
  /** @type {Record<string, number>} */
  const schranken = JSON.parse(fs.readFileSync(schrankenDatei, 'utf8'));
  const zuWenig = Object.entries(schranken).filter(([k, s]) => !((ist[k] ?? -1) >= s));
  for (const [k, s] of Object.entries(schranken))
    console.log(
      `[abdeckung] ${k.padEnd(12)} ${String(ist[k]).padStart(5)} % (Schranke ${s} %)${(ist[k] ?? -1) >= s + 1 ? ' — nachziehen' : ''}`,
    );
  return zuWenig.map(([k, s]) => `${k}: ${ist[k]} % < ${s} %`);
}

module.exports = { bericht, pruefen, verdichte, zusammenfassung, BEREICHE };

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
    console.error('Aufruf: node scripts/abdeckung.js bericht|pruefen');
    process.exit(2);
  })().catch(e => {
    console.error(e);
    process.exit(2);
  });
}
