'use strict';
/**
 * Create and delete databases for the parallel test run, as a separate
 * process: the preloader (own-db.js) must be done synchronously before the
 * test file executes its first line.
 */
const path = require('node:path');
const { Client } = require(path.join(__dirname, '..', '..', 'node_modules', 'pg'));

const { roles } = require('./roles');

const [, , was, name, vorlage] = process.argv;
const id = s => `"${String(s).replace(/"/g, '""')}"`;

(async () => {
  const c = new Client({ connectionString: process.env.TEST_DB_BASIS || process.env.TEST_DATABASE_URL });
  await c.connect();
  try {
    if (was === 'anlegen') {
      // TEMPLATE does not copy privileges on the database itself; they stand as in postgres/app-role.sh.
      const r = roles(vorlage);
      await c.query(`CREATE DATABASE ${id(name)} TEMPLATE ${id(vorlage)} OWNER ${id(r.own.name)}`);
      await c.query(`REVOKE TEMPORARY ON DATABASE ${id(name)} FROM PUBLIC`);
      await c.query(`GRANT CONNECT, TEMPORARY ON DATABASE ${id(name)} TO ${id(r.app.name)}, ${id(r.system.name)}`);
      await c.query(`GRANT CONNECT ON DATABASE ${id(name)} TO ${id(r.systemweb.name)}`);
    } else if (was === 'loeschen') await c.query(`DROP DATABASE IF EXISTS ${id(name)} WITH (FORCE)`);
    else throw new Error(`unknown: ${was}`);
  } finally {
    await c.end();
  }
})().catch(e => {
  console.error(`[test-db] ${was} ${name}: ${e.message}`);
  process.exit(1);
});
