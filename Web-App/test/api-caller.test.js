/**
 * Every route has someone who calls it — or a registered reason.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { routerEinhaengungen } = require('./helpers/sources');

const ROOT = path.join(__dirname, '..');
const { appRoutes, appAddresses } = require('./helpers/contract');
const _req = require('./helpers/sources').buildAndRequire();

function ohneKommentare(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function routesFrom(datei, mount) {
  const src = ohneKommentare(fs.readFileSync(datei, 'utf8'));
  const out = [];
  for (const m of require('./helpers/sources').routesFromSource(src, mount))
    out.push([m[1].toUpperCase(), (mount + '/' + m[2].replace(/^\//, '')).replace(/\/+$/, '')]);
  return out;
}

function allRoutes() {
  const out = [];
  // Mount points READ from server.ts instead of copied: a
  // copied list silently goes stale. See routerEinhaengungen().
  for (const r of routerEinhaengungen()) out.push(...routesFrom(r.datei, r.mount));
  const v1 = path.join(ROOT, 'routes/api');
  for (const f of fs.readdirSync(v1)) {
    if (!f.endsWith('.ts') || f === 'index.ts' || f === 'middleware.ts') continue;
    out.push(...routesFrom(path.join(v1, f), '/api/v2'));
  }
  return out;
}

/** Browser code and templates; the app's calls are in shared/app-schnittstelle.json. */
function clientSources() {
  const dateien = [];
  const collect = (dir, extensions) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'build') collect(p, extensions);
        continue;
      }
      // app.bundle.js is the product of public/js/*.js — counting it
      // would mean seeing every call twice, and a call that existed only in the
      // product would be a bug and not evidence.
      if (e.name === 'app.bundle.js') continue;
      if (extensions.some(x => e.name.endsWith(x))) dateien.push(p);
    }
  };
  collect(path.join(ROOT, 'public'), ['.js', '.html']);
  collect(path.join(ROOT, 'views'), ['.js', '.html', '.ejs']);
  return dateien;
}

/**
 * Routes without a caller in the source text — with the reason why that is fine.
 * Whoever adds a line writes the reason with it; whoever has none has found a
 * route that nobody needs anymore.
 */
// Five entries disappeared here because the routes did
const WITHOUT_CALLER = new Map([
  ['GET /api/v2/health', 'Für Überwachung von aussen (Status, Details nur für Verwalter).'],
  ['GET /api/v2/health/live', 'Lebenszeichen des Prozesses für eine Überwachung von aussen.'],
  ['GET /api/v2/health/ready', 'Gesundheitsprüfung von compose.yaml (node -e im Container).'],
  // The token routes are missing here because their UI is now under
  // “Signed-in devices” and they thus have a caller.
  [
    'POST /api/v2/admin/img-probe',
    'Diagnosewerkzeug, von Hand gerufen: zeigt, was der Bild-Proxy vom ' +
      'Ursprungsserver bekommt. Entstanden, weil Minifiguren-Bilder über den ' +
      'Proxy fehlschlugen, im Browser aber luden.',
  ],
  [
    'POST /api/v2/admin/price-probe',
    'Diagnosewerkzeug, von Hand gerufen: zeigt, woher ein Preis stammt ' +
      '(Zustandswahl, Cache oder BrickLink-Antwort).',
  ],
  [
    'GET /api/v2/admin/image-diag/:setNumber',
    'Diagnosewerkzeug, von Hand gerufen: reine Beobachtung des Bildzustands ' + 'eines Sets, ohne etwas nachzuladen.',
  ],
  [
    'POST /api/v2/admin/forget-image-misses',
    'Wartungsgriff, von Hand gerufen: nimmt gemerkte Bild-Fehlanzeigen zurück, ' +
      'damit der Nachlauf es erneut versucht.',
  ],
  [
    'GET /api/v2/catalog/bricklink',
    'Gebündelte Abfrage der BrickLink-Nummern aus dem lokalen Katalog-Cache. ' +
      'Gegen BrickLink selbst geht das nicht (deren API kennt nur einzelne ' +
      'Artikel und drosselt) — deshalb existiert die Route, benutzt wird sie ' +
      'noch nicht.',
  ],
  [
    'POST /api/v2/auth/token-create',
    'Stellt einen App-Token für eine bereits bestehende Anmeldung aus ' +
      '(Sitzung ODER Token). Die App holt ihren Token beim Anmelden, die Webapp ' +
      'über den QR-Weg (/auth/qr-token) — dieser dritte Weg wird derzeit von ' +
      'keinem der beiden gerufen.',
  ],
]);

test('every route has a caller or a registered reason', () => {
  const routen = allRoutes();
  const sources = clientSources();
  assert.ok(sources.length >= 20, `Nur ${sources.length} Client-Dateien gefunden — Pfade veraltet?`);
  const text = [
    ...sources.map(p => fs.readFileSync(p, 'utf8')),
    // The app still calls /api/v1 (the alias): its paths count under their v2 name.
    ...appRoutes(_req).map(r => r.path),
    ...appAddresses(_req),
  ].join('\n');

  assert.ok(routen.length >= 120, `Nur ${routen.length} Routen gefunden — Muster veraltet?`);

  const ohne = [];
  let withCaller = 0;
  for (const [verb, path] of routen) {
    // Search up to the first placeholder: the client assembles the rest.
    const stamm = path.split('/:')[0].replace(/\/+$/, '');
    if (!stamm) continue;
    const shapes = [stamm, stamm.slice(1), stamm.slice('/api'.length)].filter(Boolean);
    if (shapes.some(f => text.includes(f))) {
      withCaller++;
      continue;
    }
    ohne.push(`${verb} ${path}`);
  }

  // Self-proof: if the pattern found nothing at all, `ohne` would be the whole list
  // and the test red — the reverse case is more dangerous: if every
  // path matched anything, `ohne` would be empty and the test green without
  // having checked anything. Hence pin down both sides.
  assert.ok(withCaller >= 100, `Nur ${withCaller} Routen mit Aufrufer — findet die Suche noch, was sie soll?`);
  assert.ok(
    ohne.length > 0,
    'Keine einzige Route ohne Aufrufer — das waere schoen, ist aber ' +
      'verdaechtig: Die Suche trifft dann vermutlich auf alles.',
  );

  const unexplained = ohne.filter(r => !WITHOUT_CALLER.has(r)).sort();
  assert.deepEqual(
    unexplained,
    [],
    'Diese Routen ruft kein Client, und es steht kein Grund dabei:\n  ' +
      unexplained.join('\n  ') +
      '\nEntweder sie wird nicht mehr gebraucht (dann entfernen), oder es gibt ' +
      'einen Grund (E-Mail-Link, Diagnosewerkzeug, geplante Oberflaeche) — dann ' +
      'in WITHOUT_CALLER eintragen, damit der Naechste ihn nicht neu herleiten muss.',
  );

  // A line that nobody needs anymore is a permission that nobody
  // checks — the same rule as in scripts/check-global-settings.js.
  const veraltet = [...WITHOUT_CALLER.keys()].filter(r => !ohne.includes(r)).sort();
  assert.deepEqual(
    veraltet,
    [],
    'Diese Eintraege beschreiben keine aufruferlose Route mehr — entweder ist ' +
      'sie geloescht worden oder sie hat jetzt einen Aufrufer. Zeile streichen:\n  ' +
      veraltet.join('\n  '),
  );
});
