/**
 * ONE address, one implementation — and only ONE UI left.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// Remove comments — otherwise commented-out routes count too. The helper
// instead of a naive /\*…\*\/: `'/images/*pfad'` in server.ts otherwise opened
// a comment for it up to the next real comment end.
const { ohneKommentare } = require('./helpers/sources');

/** All `router.<verb>('<pfad>'` of a file, with the mount point prepended. */
function routesFrom(datei, mount) {
  const src = ohneKommentare(fs.readFileSync(datei, 'utf8'));
  const out = [];
  for (const m of require('./helpers/sources').routesFromSource(src, mount)) {
    const path = (mount + '/' + m[2].replace(/^\//, '')).replace(/\/+$/, '') || '/';
    out.push(`${m[1].toUpperCase()} ${path}`);
  }
  return out;
}

/**
 * Read the web app's mount points from server.ts. Hard-coded, the
 * list would be right exactly until someone adds a router — and
 * its routes would then silently drop out of the check.
 */
function webRouter() {
  // The same reading as in the other checks (helpers/sources.js); routes/api is the second UI.
  return require('./helpers/sources').routerEinhaengungen();
}

/**
 * Allowed overlaps — with the reason why there must be TWO implementations
 * here instead of one. Whoever adds a line writes the reason with it;
 * whoever has none has found a duplication.
 */
/**
 * Addresses that may exist TWICE — with the reason.
 */
const ALLOWED = new Map([]);

/** Prefix off: /api/v2/sets/x and /api/sets/x both become /sets/x. */
function withoutPrefix(eintrag) {
  return eintrag.replace(/ \/api(\/v1)?/, ' ');
}

test('no unjustified route on either API surface', () => {
  const web = new Set();
  for (const r of webRouter()) for (const x of routesFrom(r.datei, r.mount)) web.add(x);

  const v1 = new Set();
  const v1Dir = path.join(ROOT, 'routes/api');
  for (const f of fs.readdirSync(v1Dir)) {
    if (!f.endsWith('.ts') || f === 'index.ts' || f === 'middleware.ts') continue;
    for (const x of routesFrom(path.join(v1Dir, f), '/api')) v1.add(x);
  }

  // Self-proof: if the pattern no longer matches (renamed `router`, different
  // spelling of the mount point), both sets would be empty and the test
  // green without having checked anything.
  assert.ok(web.size >= 30, `Nur ${web.size} Webapp-Routen gefunden — Muster veraltet?`);
  assert.ok(v1.size >= 80, `Nur ${v1.size} v1-Routen gefunden — Muster veraltet?`);

  // Compare both sides without prefix: since the move the
  // web app routers themselves hang under /api/v2/<bereich>, and a comparison of the raw
  // addresses would find no overlap at all anymore — the test would be green
  // without checking anything.
  const webN = new Set([...web].map(withoutPrefix));
  const v1N = new Set([...v1].map(withoutPrefix));
  const doppelt = [...webN].filter(r => v1N.has(r)).sort();
  const unjustified = doppelt.filter(r => !ALLOWED.has(r));
  assert.deepEqual(
    unjustified,
    [],
    'Diese Adressen stehen auf BEIDEN Oberflaechen, ohne dass ein Grund ' +
      'eingetragen waere:\n  ' +
      unjustified.join('\n  ') +
      '\nZwei Umsetzungen derselben Antwort driften — gemessen bei ' +
      'GET /settings: Webapp 48, App 24. Entweder die Logik in einem Dienst ' +
      'zusammenlegen und beide Routen daraus bedienen, oder in ALLOWED ' +
      'eintragen, WARUM es zwei sein muessen.',
  );

  // A line that nobody needs anymore is a permission that nobody
  // checks — the same rule as in scripts/check-global-settings.js.
  const veraltet = [...ALLOWED.keys()].filter(r => !doppelt.includes(r));
  assert.deepEqual(
    veraltet,
    [],
    'Diese Eintraege in ALLOWED beschreiben keine Ueberschneidung mehr — ' + 'streichen:\n  ' + veraltet.join('\n  '),
  );
});

test('every router hangs under /api/v1', () => {
  const STILL_NOT = new Map([]);

  const einhaengungen = webRouter();
  // Self-proof: if the pattern finds no mount points, everything below
  // checks nothing and would still be green.
  // One: auth. Settings, sets, parts and minifigures were absorbed into the v1 router.
  assert.ok(
    einhaengungen.length >= 1,
    `Nur ${einhaengungen.length} Router-Einhaengepunkte in server.ts gefunden — Muster veraltet?`,
  );

  const daneben = einhaengungen
    .map(r => r.mount)
    .filter(m => !m.startsWith('/api/v2') && !STILL_NOT.has(m))
    .sort();
  assert.deepEqual(
    daneben,
    [],
    'Diese Router haengen NICHT unter /api/v1 und stehen auch nicht als ' +
      'begruendete Ausnahme da:\n  ' +
      daneben.join('\n  ') +
      '\nEntweder umhaengen oder in STILL_NOT eintragen, WARUM noch nicht.',
  );

  // And the exception must not be left lying around: if it is there although the router
  // moved long ago, the conversion looks less finished than it is.
  const done = [...STILL_NOT.keys()].filter(m => !einhaengungen.some(r => r.mount === m));
  assert.deepEqual(
    done,
    [],
    'Diese Ausnahmen beschreiben keinen Einhaengepunkt mehr — streichen:\n  ' + done.join('\n  '),
  );
});

/**
 * Also the routes that are DIRECTLY in server.ts.
 */
test('the directly registered routes are under /api/v1 too', () => {
  // The ONE exception, and it is not negligence:
  // The ONE exception — and it is a phase-out address, not a second
  // equal one.
  const WITHOUT_VERSION = new Map([
    [
      'GET /api/v1/img-proxy',
      'Bleibt unter v1, waehrend die API nach v2 zieht: gespeicherte Bildadressen (image_url) und ' +
        'installierte App-Fassungen zeigen dorthin; der v1-Alias rechnet sie nicht um.',
    ],
    [
      'GET /api/img-proxy',
      'Auslauf-Adresse. Die kanonische ist /api/v1/img-proxy; alles, was der ' +
        'Server heute baut, beide Oberflaechen und die gespeicherten Zeilen ' +
        '(Migration 0014) benutzen sie. Bedient bleibt die alte, weil ' +
        'INSTALLIERTE App-Fassungen sie selbst zusammenbauen (ImageUrls.kt) — ' +
        'wer nicht aktualisiert, bekaeme sonst gar keine Teilebilder mehr. Dass ' +
        'nur noch die neue GEBAUT wird, haelt test/img-proxy-v1.test.js fest.',
    ],
  ]);

  // All .ts of the server tree, not only server.ts.
  const dateien = [path.join(ROOT, 'server.ts')];
  const lauf = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        lauf(p);
        continue;
      }
      if (e.name.endsWith('.ts')) dateien.push(p);
    }
  };
  for (const ordner of ['routes', 'src', 'jobs']) lauf(path.join(ROOT, ordner));
  assert.ok(dateien.length >= 30, `Nur ${dateien.length} Serverdateien gefunden`);

  // Also registrations via a CONSTANT
  const sources = dateien.map(d => ohneKommentare(fs.readFileSync(d, 'utf8')));
  const constants = new Map();
  for (const src of sources)
    for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Z][A-Z0-9_]*)\s*=\s*'(\/api\/[^']*)'/g))
      constants.set(m[1], m[2]);

  const found = [];
  for (const src of sources) {
    for (const m of src.matchAll(/\bapp\.(get|post|put|patch|delete)\(\s*'(\/api\/[^']*)'/g))
      found.push(`${m[1].toUpperCase()} ${m[2]}`);
    for (const m of src.matchAll(/\bapp\.(get|post|put|patch|delete)\(\s*([A-Z][A-Z0-9_]*)\s*,/g)) {
      const path = constants.get(m[2]);
      assert.ok(
        path,
        `app.${m[1]}(${m[2]}, …) meldet eine Route unter einem Bezeichner an, ` +
          'dessen Wert hier nicht auffindbar ist. Ohne ihn kann diese Pruefung ' +
          'nicht sagen, ob die Adresse unter /api/v1 liegt.',
      );
      found.push(`${m[1].toUpperCase()} ${path}`);
    }
  }
  // Self-proof: if the pattern finds nothing, everything below checks nothing.
  // TWO is the MEASURED state (the two addresses of the image proxy); health
  // and startup-status hang in the router routes/health.ts.
  assert.ok(found.length >= 2, `Nur ${found.length} direkt angemeldete API-Routen gefunden — Muster veraltet?`);

  const daneben = found.filter(r => !r.split(' ')[1].startsWith('/api/v2') && !WITHOUT_VERSION.has(r)).sort();
  assert.deepEqual(
    daneben,
    [],
    'Diese Adressen sind direkt an der App angemeldet, stehen nicht unter ' +
      '/api/v1 und haben keinen eingetragenen Grund:\n  ' +
      daneben.join('\n  ') +
      '\nEntweder umziehen oder in WITHOUT_VERSION eintragen, WARUM sie ' +
      'versionslos bleiben muss.',
  );

  // The same opposite direction as above: an exception for a route that
  // no longer exists makes the conversion look less finished than it is.
  const veraltet = [...WITHOUT_VERSION.keys()].filter(r => !found.includes(r));
  assert.deepEqual(
    veraltet,
    [],
    'Diese Ausnahmen beschreiben keine Route mehr — streichen:\n  ' + veraltet.join('\n  '),
  );
});

/**
 * The health check from compose.yaml points to an address that exists.
 */
test('the health check from compose.yaml points to a real address', () => {
  const compose = fs.readFileSync(path.join(ROOT, 'compose.yaml'), 'utf8');
  const treffer = compose.match(/http:\/\/localhost:\d+(\/api\/[^'"\s)]*)/);
  assert.ok(treffer, 'compose.yaml enthaelt keinen Gesundheitscheck auf eine /api-Adresse');
  const address = treffer[1];

  const src = ohneKommentare(fs.readFileSync(path.join(ROOT, 'server.ts'), 'utf8'));
  const direkt = [...src.matchAll(/app\.get\(\s*'(\/api\/[^']*)'/g)].map(m => m[1]);
  // And the GET routes of the routers mounted in server.ts (routes/health.ts).
  for (const r of webRouter())
    for (const m of require('./helpers/sources').routesFromSource(
      ohneKommentare(fs.readFileSync(r.datei, 'utf8')),
      r.mount,
    ))
      if (m[1] === 'get') direkt.push(r.mount + m[2]);
  assert.ok(direkt.length >= 2, `Nur ${direkt.length} direkte GET-Routen gefunden — Muster veraltet?`);
  assert.ok(
    direkt.includes(address),
    `compose.yaml prueft ${address}; server.ts kennt nur ${direkt.join(', ')}. ` +
      'Der Container gaelte damit dauerhaft als „unhealthy", ohne dass die ' +
      'Anwendung selbst etwas davon merkt.',
  );
});
