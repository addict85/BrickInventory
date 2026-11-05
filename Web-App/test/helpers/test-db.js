'use strict';
/**
 * Datenbanken für den parallelen Testlauf anlegen und löschen, als eigener
 * Prozess: Der Vorlader (eigene-db.js) muss synchron fertig sein, bevor die
 * Testdatei ihre erste Zeile ausführt.
 * Ausführlich: docs/begruendungen/test/helpers/test-db.js.md#path
 */
const path = require('node:path');
const { Client } = require(path.join(__dirname, '..', '..', 'node_modules', 'pg'));

const [, , was, name, vorlage] = process.argv;
const id = (s) => `"${String(s).replace(/"/g, '""')}"`;

(async () => {
  const c = new Client({ connectionString: process.env.TEST_DB_BASIS || process.env.TEST_DATABASE_URL });
  await c.connect();
  try {
    if (was === 'anlegen') await c.query(`CREATE DATABASE ${id(name)} TEMPLATE ${id(vorlage)}`);
    else if (was === 'loeschen') await c.query(`DROP DATABASE IF EXISTS ${id(name)} WITH (FORCE)`);
    else throw new Error(`unbekannt: ${was}`);
  } finally { await c.end(); }
})().catch((e) => { console.error(`[test-db] ${was} ${name}: ${e.message}`); process.exit(1); });
