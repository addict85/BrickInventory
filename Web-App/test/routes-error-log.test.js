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
function logWithLevel(error, req) {
  const zeilen = [];
  const echt = { error: console.error, warn: console.warn };
  console.error = (...parts) => zeilen.push({ stufe: 'error', row: require('node:util').format(...parts) });
  console.warn = (...parts) => zeilen.push({ stufe: 'warn', row: require('node:util').format(...parts) });
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
    handleRouteError(res, error, undefined, req);
  } finally {
    Object.assign(console, echt);
  }
  assert.equal(zeilen.length, 1, 'Es soll genau eine Zeile geschrieben werden');
  return zeilen[0];
}
const protokolliere = (error, req) => logWithLevel(error, req).row;

test('the error line names method and path', () => {
  const e = Object.assign(new Error('Nicht gefunden'), { status: 404, code: 'not_found' });
  const row = protokolliere(e, {
    method: 'PUT',
    originalUrl: '/api/v2/parts/3001/5/acquisitions/42',
  });
  assert.match(
    row,
    /\[route-warnung\] PUT \/api\/v2\/parts\/3001\/5\/acquisitions\/42 404:/,
    `Ohne Methode und Pfad ist die Zeile nicht zuzuordnen — dastand: ${row}`,
  );
});

test('the question mark part stays outside', () => {
  const e = Object.assign(new Error('Nicht gefunden'), { status: 404 });
  const row = protokolliere(e, {
    method: 'GET',
    originalUrl: '/api/v2/sets?accounts=alle&geheim=abc',
  });
  assert.ok(row.includes('GET /api/v2/sets '), `Pfad fehlt: ${row}`);
  assert.ok(
    !row.includes('geheim'),
    'Die Abfrage steht mit im Protokoll — was dort stehen darf, ist nicht Sache ' + `des Protokolls: ${row}`,
  );
  assert.ok(!row.includes('accounts'), `Die Abfrage steht mit im Protokoll: ${row}`);
});

test('without a request the line stays as before', () => {
  // There are callers outside of a route (background work, tests). The addition
  // must not turn into „undefined undefined" there.
  const row = protokolliere(new Error('kaputt'), undefined);
  assert.match(row, /\[route-error\] 500:/, `Unerwartete Form: ${row}`);
  assert.ok(!row.includes('undefined'), `„undefined" in der Zeile: ${row}`);
});

test('a 4xx is a warning without a stack, a 5xx an error with a stack', () => {
  const nicht = logWithLevel(Object.assign(new Error('Nicht gefunden'), { status: 404 }), {
    method: 'GET',
    originalUrl: '/api/v2/sets/1-1',
  });
  assert.equal(nicht.stufe, 'warn');
  assert.match(nicht.row, /Nicht gefunden/);
  assert.ok(!/\n\s+at /.test(nicht.row), `Stack in einer 4xx-Zeile: ${nicht.row}`);

  const kaputt = logWithLevel(new Error('Verbindung weg'), { method: 'GET', originalUrl: '/api/v2/sets' });
  assert.equal(kaputt.stufe, 'error');
  assert.match(kaputt.row, /\n\s+at /, 'ein 5xx trägt seinen Stack');
});
