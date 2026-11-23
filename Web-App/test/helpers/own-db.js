'use strict';
/**
 * Preloaded into every test file (scripts/test-run.js): an own copy of the template
 * so that files run in parallel without sharing rows, NOTIFY channels or locks.
 * The app connects as in production as the runtime role, the system context as the
 * system role (in HTTP requests as the web system role), the owner writes test data (helpers/roles.js, sources.js);
 * files with the marker `@superuser` still run as superuser.
 */
// Only in the test runner's child and only once: started servers inherit the environment including the marker.
const template = process.env.TEST_DB_TEMPLATE;
if (process.env.NODE_TEST_CONTEXT && template && process.env.TEST_DATABASE_URL && !process.env.TEST_DB_OWN) {
  const { execFileSync } = require('node:child_process');
  const fs = require('node:fs');
  const path = require('node:path');
  const { roles, asRole, asSuperuser } = require('./roles');
  const tool = path.join(__dirname, 'test-db.js');
  const name = `${template}_${process.pid}`;
  execFileSync(process.execPath, [tool, 'anlegen', name, template], { stdio: 'inherit' });
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = '/' + name;
  const su = url.toString();
  const r = roles(template);
  const file = process.argv[1] ?? '';
  const source = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const superuser = asSuperuser(source);
  process.env.TEST_DB_SU_URL = su;
  process.env.TEST_DB_OWN_URL = superuser ? su : asRole(su, r.own);
  process.env.TEST_DATABASE_URL = superuser ? su : asRole(su, r.app);
  if (!superuser) {
    process.env.PGSYSTEM_USER = r.system.name;
    process.env.PGSYSTEM_PASSWORD = r.system.password;
    process.env.PGSYSTEM_WEB_USER = r.systemweb.name;
    process.env.PGSYSTEM_WEB_PASSWORD = r.systemweb.password;
  }
  process.env.TEST_DB_OWN = name;
  process.on('exit', () => {
    try {
      execFileSync(process.execPath, [tool, 'loeschen', name], {
        stdio: 'ignore',
        env: { ...process.env, TEST_DATABASE_URL: process.env.TEST_DB_BASIS },
      });
    } catch {
      /* the run clears leftovers at the end (scripts/test-run.js) */
    }
  });
}
