/**
 * Counter-check: a failing query with logAndContinue at the start of initSchema() (db/schemaStart.ts) → red “the schema start reports no swallowed error”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

// Prerequisite: test DB via TEST_DATABASE_URL — as in the other
// *-db.test.js. Without this line the start would access DATABASE_URL and
// thereby the real database.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();

/**
 * The schema start must not swallow an error.
 */
test('the schema start reports no swallowed error', async t => {
  // The pool is closed IN THE AFTERMATH, not at the end of the body: otherwise
  // it stays open on a failing assertion, the process does not end,
  // and a red test becomes a hanging one — the worst
  // of all outcomes, because nobody gets to see the message.
  t.after(async () => {
    await db.pool.end().catch(() => {});
  });

  const gemeldet = [];
  const realWarn = console.warn;
  console.warn = (...args) => {
    const text = args.map(a => (typeof a === 'string' ? a : String(a?.message ?? a))).join(' ');
    if (text.includes('[weiter-trotz-fehler]')) gemeldet.push(text);
    realWarn.apply(console, args);
  };

  try {
    if (!(await dataOrSkip(t, _req, { migrieren: false }))) return;
  } finally {
    console.warn = realWarn;
  }

  assert.deepEqual(
    gemeldet,
    [],
    'Der Schemastart hat Fehler verschluckt und nur protokolliert:\n  ' +
      gemeldet.join('\n  ') +
      '\nJede dieser Zeilen ist ein Schritt, der NICHT gelaufen ist — die ' +
      'Datenbank steht danach anders da, als der Start behauptet.',
  );
});
