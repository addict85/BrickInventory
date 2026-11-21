'use strict';
/**
 * The error line names WHICH request failed.
 *
 * Counter-check (29.10.2026): in handleRouteError again every level via
 * console.error with `e?.stack` → red: “a 4xx is a warning without a stack”
 * (level error, stack in the line) and “the error line names method and path”.
 *
 * Run: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { handleRouteError } = _req('src/http/httpResponse.js');

/** Calls handleRouteError; delivers the one line including the level (error/warn). */
function logWithLevel(fehler, req) {
  const zeilen = [];
  const echt = { error: console.error, warn: console.warn };
  console.error = (...teile) => zeilen.push({ stufe: 'error', zeile: require('node:util').format(...teile) });
  console.warn = (...teile) => zeilen.push({ stufe: 'warn', zeile: require('node:util').format(...teile) });
  // A response that can do only as much as handleRouteError needs.
  const res = {
    headersSent: false,
    status() {
      return this;
    },
    json() {
      return this;
    },
  };
  try {
    handleRouteError(res, fehler, undefined, req);
  } finally {
    Object.assign(console, echt);
  }
  assert.equal(zeilen.length, 1, 'Es soll genau eine Zeile geschrieben werden');
  return zeilen[0];
}
const protokolliere = (fehler, req) => logWithLevel(fehler, req).zeile;

test('the error line names method and path', () => {
  const e = Object.assign(new Error('Nicht gefunden'), { status: 404, code: 'nicht_gefunden' });
  const zeile = protokolliere(e, {
    method: 'PUT',
    originalUrl: '/api/v1/parts/3001/5/acquisitions/42',
  });
  assert.match(
    zeile,
    /\[route-warnung\] PUT \/api\/v1\/parts\/3001\/5\/acquisitions\/42 404:/,
    `Ohne Methode und Pfad ist die Zeile nicht zuzuordnen — dastand: ${zeile}`,
  );
});

test('the question mark part stays outside', () => {
  const e = Object.assign(new Error('Nicht gefunden'), { status: 404 });
  const zeile = protokolliere(e, {
    method: 'GET',
    originalUrl: '/api/v1/sets?accounts=alle&geheim=abc',
  });
  assert.ok(zeile.includes('GET /api/v1/sets '), `Pfad fehlt: ${zeile}`);
  assert.ok(
    !zeile.includes('geheim'),
    'Die Abfrage steht mit im Protokoll — was dort stehen darf, ist nicht Sache ' + `des Protokolls: ${zeile}`,
  );
  assert.ok(!zeile.includes('accounts'), `Die Abfrage steht mit im Protokoll: ${zeile}`);
});

test('without a request the line stays as before', () => {
  // There are callers outside of a route (background work, tests). The addition
  // must not turn into „undefined undefined" there.
  const zeile = protokolliere(new Error('kaputt'), undefined);
  assert.match(zeile, /\[route-error\] 500:/, `Unerwartete Form: ${zeile}`);
  assert.ok(!zeile.includes('undefined'), `„undefined" in der Zeile: ${zeile}`);
});

test('a 4xx is a warning without a stack, a 5xx an error with a stack', () => {
  const nicht = logWithLevel(Object.assign(new Error('Nicht gefunden'), { status: 404 }), {
    method: 'GET',
    originalUrl: '/api/v1/sets/1-1',
  });
  assert.equal(nicht.stufe, 'warn');
  assert.match(nicht.zeile, /Nicht gefunden/);
  assert.ok(!/\n\s+at /.test(nicht.zeile), `Stack in einer 4xx-Zeile: ${nicht.zeile}`);

  const kaputt = logWithLevel(new Error('Verbindung weg'), { method: 'GET', originalUrl: '/api/v1/sets' });
  assert.equal(kaputt.stufe, 'error');
  assert.match(kaputt.zeile, /\n\s+at /, 'ein 5xx trägt seinen Stack');
});
