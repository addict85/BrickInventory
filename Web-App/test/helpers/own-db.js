'use strict';
/**
 * Preloaded into every test file (scripts/test-run.js): an own copy of the template
 * so that files run in parallel without sharing rows, NOTIFY channels or locks.
 * The app connects as in production as the runtime role, the system context as the
 * system role (in HTTP requests as the web system role), the owner writes test data (helpers/roles.js, sources.js);
 * files with the marker `@superuser` still run as superuser.
 */
// Only in the test runner's child and only once: started servers inherit the environment including the marker.
const vorlage = process.env.TEST_DB_VORLAGE;
if (process.env.NODE_TEST_CONTEXT && vorlage && process.env.TEST_DATABASE_URL && !process.env.TEST_DB_EIGEN) {
  const { execFileSync } = require('node:child_process');
  const fs = require('node:fs');
  const path = require('node:path');
  const { rollen, asRole, asSuperuser } = require('./roles');
  const werkzeug = path.join(__dirname, 'test-db.js');
  const name = `${vorlage}_${process.pid}`;
  execFileSync(process.execPath, [werkzeug, 'anlegen', name, vorlage], { stdio: 'inherit' });
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = '/' + name;
  const su = url.toString();
  const r = rollen(vorlage);
  const datei = process.argv[1] ?? '';
  const source = fs.existsSync(datei) ? fs.readFileSync(datei, 'utf8') : '';
  const superuser = asSuperuser(source);
  process.env.TEST_DB_SU_URL = su;
  process.env.TEST_DB_EIGEN_URL = superuser ? su : asRole(su, r.eigen);
  process.env.TEST_DATABASE_URL = superuser ? su : asRole(su, r.app);
  if (!superuser) {
    process.env.PGSYSTEM_USER = r.system.name;
    process.env.PGSYSTEM_PASSWORD = r.system.passwort;
    process.env.PGSYSTEM_WEB_USER = r.systemweb.name;
    process.env.PGSYSTEM_WEB_PASSWORD = r.systemweb.passwort;
  }
  process.env.TEST_DB_EIGEN = name;
  process.on('exit', () => {
    try {
      execFileSync(process.execPath, [werkzeug, 'loeschen', name], {
        stdio: 'ignore',
        env: { ...process.env, TEST_DATABASE_URL: process.env.TEST_DB_BASIS },
      });
    } catch {
      /* the run clears leftovers at the end (scripts/test-run.js) */
    }
  });
}
