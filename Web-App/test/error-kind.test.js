/**
 * Services throw a domain error kind, not an HTTP status; which status
 * belongs to it is only in src/http/errorKind.ts. What is checked is the response
 * the routes' error path (handleRouteError) makes of it.
 *
 * Counter-checks (measured 09.11.2026, each alone):
 *   A  in STATUS_THE_KIND `konflikt: 400` → red: “every kind yields its status”
 *      (konflikt 400 instead of 409)
 *   B  in handleRouteError again `typeof e.status === 'number' ? e.status : 500`
 *      instead of statusOf(e) → red: “every kind yields its status” (all 500)
 *   C  `import { statusOf } from '../http/fehlerArt'` in src/sets/service.ts →
 *      red: “only src/http maps kinds to status …”
 *   D  in src/infra/money.ts a status number 400 appended to fachfehler() → red:
 *      the same check, list `status`
 *   E  (15.11.2026) in sendError `res.status(500)` instead of STATUS_THE_KIND[art] → red:
 *      “every kind yields its status” (sendError ungueltig: 500 instead of 400)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const ohneKommentare = require('./helpers/sources').ohneKommentare;
const { handleRouteError, sendError } = _req('src/http/httpResponse.js');
const { STATUS_THE_KIND } = _req('src/http/errorKind.js');
const { failDomain, asDuplicate } = _req('src/infra/errorTexts.js');

/** What handleRouteError writes to a response. */
function response(e) {
  let status = 0,
    rumpf = null;
  const res = {
    headersSent: false,
    status(c) {
      status = c;
      return {
        json(b) {
          rumpf = b;
        },
      };
    },
  };
  const warn = console.warn,
    err = console.error;
  console.warn = () => {};
  console.error = () => {};
  try {
    handleRouteError(res, e, undefined, { headers: {} });
  } finally {
    console.warn = warn;
    console.error = err;
  }
  return { status, code: rumpf?.code };
}
const thrown = fn => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error('nichts geworfen');
};

test('every kind yields its status', () => {
  const erwartet = {
    ungueltig: 400,
    not_signed_in: 401,
    verboten: 403,
    not_found: 404,
    konflikt: 409,
    zu_gross: 413,
    falscher_typ: 415,
    zu_langsam: 408,
    nicht_mehr_da: 410,
    nicht_verarbeitbar: 422,
    zu_viele: 429,
    speicher_voll: 507,
    intern: 500,
    fremddienst: 502,
    nicht_verfuegbar: 503,
    zeitueberschreitung: 504,
    falscher_host: 421,
    zu_alt: 426,
  };
  assert.deepEqual(Object.keys(STATUS_THE_KIND).sort(), Object.keys(erwartet).sort());
  for (const [kind, status] of Object.entries(erwartet)) {
    assert.deepEqual(
      response(thrown(() => failDomain(kind, 'set_not_found'))),
      { status, code: 'set_not_found' },
      kind,
    );
    // Whoever answers themselves (guards, HTTP sides) names the kind; the same table chooses the status.
    let gesendet = 0;
    const res = {
      status: c => {
        gesendet = c;
        return { json: () => {} };
      },
    };
    sendError({ headers: {} }, res, kind, 'set_not_found');
    assert.equal(gesendet, status, `sendError ${kind}`);
  }
});

test('a duplicate from the database becomes a conflict', () => {
  const e = thrown(() => asDuplicate('username_taken')({ code: '23505' }));
  assert.equal(e.kind, 'konflikt');
  assert.deepEqual(response(e), { status: 409, code: 'username_taken' });
  // A foreign error with its own status (body parser) keeps it.
  assert.equal(response(Object.assign(new Error('x'), { status: 413, type: 'entity.too.large' })).status, 413);
});

/** All TypeScript sources except src/http and the test helpers. */
function dienste() {
  const raus = [];
  (function lauf(d) {
    for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
      const rel = path.posix.join(d, e.name);
      if (e.isDirectory()) lauf(rel);
      else if (e.name.endsWith('.ts')) raus.push(rel);
    }
  })('src');
  // The HTTP sides of the scopes (src/<bereich>/http/) belong to the HTTP layer.
  return raus.filter(d => !d.startsWith('src/http/') && !/^src\/[^/]+\/http\//.test(d));
}

test('only src/http maps kinds to status, no service names a status', () => {
  const liste = dienste();
  assert.ok(liste.length > 200, `nur ${liste.length} Dienste gefunden — greift die Suche noch?`);
  const treffer = liste.filter(d => /from '[./]+\/http\/fehlerArt'/.test(fs.readFileSync(path.join(ROOT, d), 'utf8')));
  assert.deepEqual(treffer, []);

  // No service names a status: a number as the second argument would mean that
  // someone brings back the former form (code and status number).
  const status = [];
  for (const d of liste) {
    const s = ohneKommentare(fs.readFileSync(path.join(ROOT, d), 'utf8'));
    for (const m of s.matchAll(/\b(?:fehlerWerfen|fachfehler|fileError)\([^)]*?,\s*\d{3}\b/g))
      status.push(`${d}: ${m[0]}`);
    for (const m of s.matchAll(/new Fachfehler\(\s*'[a-z_]+',\s*\d{3}/g)) status.push(`${d}: ${m[0]}`);
  }
  assert.deepEqual(status, []);
  // Self-proof of the search on a probe.
  assert.ok(/\b(?:fehlerWerfen|fachfehler|fileError)\([^)]*?,\s*\d{3}\b/.test("fehlerWerfen('x', 400)"));
});
