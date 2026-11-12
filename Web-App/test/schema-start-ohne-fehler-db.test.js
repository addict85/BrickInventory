const test = require('node:test');
const assert = require('node:assert/strict');

// Voraussetzung: Test-DB via TEST_DATABASE_URL — wie in den uebrigen
// *-db.test.js. Ohne diese Zeile griffe der Start auf DATABASE_URL zu und
// damit auf die echte Datenbank.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const db = _req('db/database.js');

/**
 * Der Schemastart darf keinen Fehler verschlucken.
 */
test('der Schemastart meldet keinen verschluckten Fehler', async t => {
  // Der Pool wird IM NACHLAUF geschlossen, nicht am Ende des Rumpfes: Sonst
  // bleibt er bei einer scheiternden Zusicherung offen, der Prozess endet
  // nicht, und aus einem roten Test wird ein haengender — der schlechteste
  // aller Ausgaenge, weil niemand die Meldung zu sehen bekommt.
  t.after(async () => {
    await db.pool.end().catch(() => {});
  });

  const gemeldet = [];
  const echtesWarn = console.warn;
  console.warn = (...args) => {
    const text = args.map(a => (typeof a === 'string' ? a : String(a?.message ?? a))).join(' ');
    if (text.includes('[weiter-trotz-fehler]')) gemeldet.push(text);
    echtesWarn.apply(console, args);
  };

  try {
    if (!(await dbOderSkip(t, _req, { migrieren: false }))) return;
  } finally {
    console.warn = echtesWarn;
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
