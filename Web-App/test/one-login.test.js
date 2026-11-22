/**
 * „Logged in" means something in ONE place, not in five.
 *
 * Counter-check: `req.session.userId` read in routes/api/minifigs.ts → red “no handler asks the session for the user identifier itself”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROUTES = path.join(__dirname, '..', 'routes');

/**
 * Where the session MAY be read directly — and why.
 *
 * The list is deliberately short and deliberately not empty: these places DEFINE
 * what „logged in" means, or deal with the session itself. Whoever
 * uses it instead of defining it does not belong here.
 */
const ALLOWED = {
  'api/middleware.ts':
    'requireToken übersetzt die Sitzung IN die gemeinsame Form (req.apiUser). ' + 'Hier entsteht sie.',
  'auth/secondFactor.ts':
    'Nach dem Einrichten des Faktors enden alle anderen Zugänge; die eigene ' +
    'Sitzung bleibt und bekommt die neue Version – das geht nur, wenn es eine gibt.',
  'auth.ts':
    'GET /me muss "nicht angemeldet" mit 200 beantworten statt mit 401 und ' +
    'meldet zusätzlich die Laufzeit des Tokens — es kann deshalb nicht hinter ' +
    'dem Wächter stehen. Und /change-password stellt nach dem Verwerfen aller ' +
    'Sitzungen die EIGENE wieder her; das geht nur, wenn es eine gibt.',
};

/** All .ts under routes/, also in subfolders. */
function routesFiles(dir, praefix = '') {
  const found = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) found.push(...routesFiles(path.join(dir, e.name), praefix + e.name + '/'));
    else if (e.name.endsWith('.ts')) found.push([praefix + e.name, path.join(dir, e.name)]);
  }
  return found;
}

test('no handler asks the session for the user identifier itself', () => {
  const dateien = routesFiles(ROUTES);
  assert.ok(dateien.length >= 10, `Only ${dateien.length} router files found — then the rest checks nothing.`);

  const violations = [];
  const gebraucht = new Set();
  for (const [rel, voll] of dateien) {
    const src = fs
      .readFileSync(voll, 'utf8')
      // Comments out: an explanatory text that NAMES `req.session.userId`
      // (this one for example) is not a use.
      .split('\n')
      .filter(z => !z.trimStart().startsWith('//') && !z.trimStart().startsWith('*'))
      .join('\n');
    for (const m of src.matchAll(/req\.session\??\.(userId|isAdmin|username)\b/g)) {
      const row = src.slice(0, m.index).split('\n').length;
      // Allowed files are SEARCHED nevertheless: their hit proves that
      // the exception still describes something. Whoever skips it instead
      // never notices when it becomes moot — and then a dead
      // entry permanently exempts a whole file from the check.
      if (rel in ALLOWED) gebraucht.add(rel);
      else violations.push(`${rel}:${row}  ${m[0]}`);
    }
  }

  const veraltet = Object.keys(ALLOWED)
    .filter(k => !gebraucht.has(k))
    .sort();
  assert.deepEqual(
    veraltet,
    [],
    'These entries in ALLOWED no longer describe anything:\n  ' +
      veraltet.join('\n  ') +
      '\nThe file no longer reads the session directly — remove it.',
  );

  assert.deepEqual(
    violations,
    [],
    'These places read the session directly instead of nutzerId()/istVerwalter()/userName():\n  ' +
      violations.join('\n  ') +
      "\nWith a bearer token — the app's only credential — that is always " +
      'undefined. It does not show up as an error: the route answers with 401, ' +
      'or worse, it silently returns the view of a ' +
      'non-admin.',
  );
});

test('no router brings its own guard', () => {
  // The second part of the same finding: routes/auth.ts DEFINED requireLogin
  // and requireAdmin itself — session-bound, while src/account/http/login.ts and
  // routes/api/middleware.ts had long had token-capable versions. Three
  // versions of one rule, and the app could only fulfill one.
  const dateien = routesFiles(ROUTES);
  const eigene = [];
  for (const [rel, voll] of dateien) {
    const src = fs.readFileSync(voll, 'utf8');
    for (const m of src.matchAll(/^\s*(?:export\s+)?function\s+(require\w+)\s*\(/gm)) {
      // api/middleware.ts is the place WHERE they should stand.
      if (rel === 'api/middleware.ts') continue;
      eigene.push(`${rel}  function ${m[1]}`);
    }
  }
  assert.deepEqual(
    eigene,
    [],
    'These routers define their own login guard:\n  ' +
      eigene.join('\n  ') +
      '\nThere are exactly two: requireLoginOrToken (src/account/http/login.ts) and ' +
      'requireApiAdmin (routes/api/middleware.ts). Both accept session OR ' +
      'token. A third version reliably locks out the app.',
  );
});
