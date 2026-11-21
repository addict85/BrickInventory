/**
 * „Logged in" means something in ONE place, not in five.
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
  'api_v1/middleware.ts':
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
  const gefunden = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) gefunden.push(...routesFiles(path.join(dir, e.name), praefix + e.name + '/'));
    else if (e.name.endsWith('.ts')) gefunden.push([praefix + e.name, path.join(dir, e.name)]);
  }
  return gefunden;
}

test('no handler asks the session for the user identifier itself', () => {
  const dateien = routesFiles(ROUTES);
  assert.ok(dateien.length >= 10, `Nur ${dateien.length} Router-Dateien gefunden — dann prüft der Rest nichts.`);

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
      const zeile = src.slice(0, m.index).split('\n').length;
      // Allowed files are SEARCHED nevertheless: their hit proves that
      // the exception still describes something. Whoever skips it instead
      // never notices when it becomes moot — and then a dead
      // entry permanently exempts a whole file from the check.
      if (rel in ALLOWED) gebraucht.add(rel);
      else violations.push(`${rel}:${zeile}  ${m[0]}`);
    }
  }

  const veraltet = Object.keys(ALLOWED)
    .filter(k => !gebraucht.has(k))
    .sort();
  assert.deepEqual(
    veraltet,
    [],
    'Diese Eintraege in ALLOWED beschreiben nichts mehr:\n  ' +
      veraltet.join('\n  ') +
      '\nDie Datei liest die Sitzung gar nicht (mehr) direkt — raus damit.',
  );

  assert.deepEqual(
    violations,
    [],
    'Diese Stellen lesen die Sitzung direkt statt nutzerId()/istVerwalter()/nutzerName():\n  ' +
      violations.join('\n  ') +
      '\nMit einem Bearer-Token — dem einzigen Ausweis der App — ist das immer ' +
      'undefined. Das fällt nicht als Fehler auf: Die Route antwortet mit 401, ' +
      'oder schlimmer, sie liefert stillschweigend die Ansicht eines ' +
      'Nicht-Verwalters.',
  );
});

test('no router brings its own guard', () => {
  // The second part of the same finding: routes/auth.ts DEFINED requireLogin
  // and requireAdmin itself — session-bound, while src/account/http/login.ts and
  // routes/api_v1/middleware.ts had long had token-capable versions. Three
  // versions of one rule, and the app could only fulfill one.
  const dateien = routesFiles(ROUTES);
  const eigene = [];
  for (const [rel, voll] of dateien) {
    const src = fs.readFileSync(voll, 'utf8');
    for (const m of src.matchAll(/^\s*(?:export\s+)?function\s+(require\w+)\s*\(/gm)) {
      // api_v1/middleware.ts is the place WHERE they should stand.
      if (rel === 'api_v1/middleware.ts') continue;
      eigene.push(`${rel}  function ${m[1]}`);
    }
  }
  assert.deepEqual(
    eigene,
    [],
    'Diese Router definieren einen eigenen Anmelde-Wächter:\n  ' +
      eigene.join('\n  ') +
      '\nEs gibt genau zwei: requireLoginOrToken (src/account/http/login.ts) und ' +
      'requireApiAdmin (routes/api_v1/middleware.ts). Beide nehmen Sitzung ODER ' +
      'Token. Eine dritte Fassung sperrt zuverlässig die App aus.',
  );
});
