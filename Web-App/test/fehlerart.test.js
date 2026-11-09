/**
 * Dienste werfen eine fachliche Fehlerart, keinen HTTP-Status; welcher Status
 * dazu gehört, steht nur in src/http/fehlerArt.ts. Geprüft wird die Antwort,
 * die der Fehlerweg der Routen (handleRouteError) daraus macht.
 *
 * Gegenproben (09.11.2026 gemessen, je einzeln):
 *   A  in STATUS_DER_ART `konflikt: 400` → rot: „jede Art ergibt ihren Status“
 *      (konflikt 400 statt 409)
 *   B  in handleRouteError wieder `typeof e.status === 'number' ? e.status : 500`
 *      statt statusVon(e) → rot: „jede Art ergibt ihren Status“ (alle 500)
 *   C  `import { statusVon } from '../http/fehlerArt'` in src/sets/dienst.ts →
 *      rot: „nur src/http bildet Arten auf Status ab …“
 *   D  in src/infra/geld.ts dem fachfehler() eine Statuszahl 400 angehängt → rot:
 *      dieselbe Prüfung, Liste `status`
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const ohneKommentare = require('./helpers/sources').ohneKommentare;
const { handleRouteError } = _req('src/http/httpAntwort.js');
const { STATUS_DER_ART } = _req('src/http/fehlerArt.js');
const { fachfehler, alsDoppelt } = _req('src/infra/fehlerTexte.js');

/** Was handleRouteError an eine Antwort schreibt. */
function antwort(e) {
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
const geworfen = fn => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error('nichts geworfen');
};

test('jede Art ergibt ihren Status', () => {
  const erwartet = {
    ungueltig: 400,
    nicht_angemeldet: 401,
    verboten: 403,
    nicht_gefunden: 404,
    konflikt: 409,
    zu_gross: 413,
    falscher_typ: 415,
    zu_viele: 429,
    intern: 500,
    fremddienst: 502,
    nicht_verfuegbar: 503,
    zeitueberschreitung: 504,
  };
  assert.deepEqual(Object.keys(STATUS_DER_ART).sort(), Object.keys(erwartet).sort());
  for (const [art, status] of Object.entries(erwartet)) {
    assert.deepEqual(
      antwort(geworfen(() => fachfehler(art, 'set_nicht_gefunden'))),
      { status, code: 'set_nicht_gefunden' },
      art,
    );
  }
});

test('ein Doppel aus der Datenbank wird zum Konflikt', () => {
  const e = geworfen(() => alsDoppelt('benutzername_vergeben')({ code: '23505' }));
  assert.equal(e.art, 'konflikt');
  assert.deepEqual(antwort(e), { status: 409, code: 'benutzername_vergeben' });
  // Ein fremder Fehler mit eigenem Status (Body-Parser) behält ihn.
  assert.equal(antwort(Object.assign(new Error('x'), { status: 413, type: 'entity.too.large' })).status, 413);
});

/** Alle TypeScript-Quellen ausser src/http und der Testhilfen. */
function dienste() {
  const raus = [];
  (function lauf(d) {
    for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
      const rel = path.posix.join(d, e.name);
      if (e.isDirectory()) lauf(rel);
      else if (e.name.endsWith('.ts')) raus.push(rel);
    }
  })('src');
  return raus.filter(d => !d.startsWith('src/http/'));
}

test('nur src/http bildet Arten auf Status ab, kein Dienst nennt einen Status', () => {
  const liste = dienste();
  assert.ok(liste.length > 200, `nur ${liste.length} Dienste gefunden — greift die Suche noch?`);
  const treffer = liste.filter(d => /from '[./]+\/http\/fehlerArt'/.test(fs.readFileSync(path.join(ROOT, d), 'utf8')));
  assert.deepEqual(treffer, []);

  // Kein Dienst nennt einen Status: Eine Zahl als zweites Argument hiesse, dass
  // jemand die frühere Form (Code und Statuszahl) zurückholt.
  const status = [];
  for (const d of liste) {
    const s = ohneKommentare(fs.readFileSync(path.join(ROOT, d), 'utf8'));
    for (const m of s.matchAll(/\b(?:fehlerWerfen|fachfehler|dateiFehler)\([^)]*?,\s*\d{3}\b/g))
      status.push(`${d}: ${m[0]}`);
    for (const m of s.matchAll(/new Fachfehler\(\s*'[a-z_]+',\s*\d{3}/g)) status.push(`${d}: ${m[0]}`);
  }
  assert.deepEqual(status, []);
  // Selbstbeweis der Suche an einer Probe.
  assert.ok(/\b(?:fehlerWerfen|fachfehler|dateiFehler)\([^)]*?,\s*\d{3}\b/.test("fehlerWerfen('x', 400)"));
});
