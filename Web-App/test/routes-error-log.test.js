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
  const lines = [];
  const original = { error: console.error, warn: console.warn };
  console.error = (...parts) => lines.push({ stufe: 'error', row: require('node:util').format(...parts) });
  console.warn = (...parts) => lines.push({ stufe: 'warn', row: require('node:util').format(...parts) });
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
    Object.assign(console, original);
  }
  assert.equal(lines.length, 1, 'Exactly one line should be written');
  return lines[0];
}
const logIt = (error, req) => logWithLevel(error, req).row;

test('the error line names method and path', () => {
  const e = Object.assign(new Error('Nicht gefunden'), { status: 404, code: 'not_found' });
  const row = logIt(e, {
    method: 'PUT',
    originalUrl: '/api/v2/parts/3001/5/acquisitions/42',
  });
  assert.match(
    row,
    /\[route-warnung\] PUT \/api\/v2\/parts\/3001\/5\/acquisitions\/42 404:/,
    `Without method and path the line cannot be attributed — it read: ${row}`,
  );
});

test('the question mark part stays outside', () => {
  const e = Object.assign(new Error('Nicht gefunden'), { status: 404 });
  const row = logIt(e, {
    method: 'GET',
    originalUrl: '/api/v2/sets?accounts=alle&geheim=abc',
  });
  assert.ok(row.includes('GET /api/v2/sets '), `path missing: ${row}`);
  assert.ok(
    !row.includes('geheim'),
    'The query is in the log as well — what may be in there is not the business ' + `of the log: ${row}`,
  );
  assert.ok(!row.includes('accounts'), `The query is in the log as well: ${row}`);
});

test('without a request the line stays as before', () => {
  // There are callers outside of a route (background work, tests). The addition
  // must not turn into „undefined undefined" there.
  const row = logIt(new Error('kaputt'), undefined);
  assert.match(row, /\[route-error\] 500:/, `Unerwartete Form: ${row}`);
  assert.ok(!row.includes('undefined'), `„undefined" in the line: ${row}`);
});

test('a 4xx is a warning without a stack, a 5xx an error with a stack', () => {
  const nicht = logWithLevel(Object.assign(new Error('Nicht gefunden'), { status: 404 }), {
    method: 'GET',
    originalUrl: '/api/v2/sets/1-1',
  });
  assert.equal(nicht.stufe, 'warn');
  assert.match(nicht.row, /Nicht gefunden/);
  assert.ok(!/\n\s+at /.test(nicht.row), `stack in a 4xx line: ${nicht.row}`);

  const broken = logWithLevel(new Error('Verbindung weg'), { method: 'GET', originalUrl: '/api/v2/sets' });
  assert.equal(broken.stufe, 'error');
  assert.match(broken.row, /\n\s+at /, 'a 5xx carries its stack');
});
