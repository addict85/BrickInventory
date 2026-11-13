'use strict';
/**
 * Vorgeladen in jede Testdatei (scripts/test-lauf.js): eine eigene Kopie der Vorlage,
 * damit Dateien parallel laufen, ohne Zeilen, NOTIFY-Kanäle oder Sperren zu teilen.
 * Die App verbindet sich wie im Betrieb als Laufzeitrolle, der Systemrahmen als
 * Systemrolle, Testdaten schreibt die Eigentümerin (helpers/rollen.js, sources.js);
 * Dateien mit der Marke `@superuser` laufen noch als Superuser.
 */
// Nur im Kind des Test-Runners und nur einmal: Gestartete Server erben die Umgebung samt Marke.
const vorlage = process.env.TEST_DB_VORLAGE;
if (process.env.NODE_TEST_CONTEXT && vorlage && process.env.TEST_DATABASE_URL && !process.env.TEST_DB_EIGEN) {
  const { execFileSync } = require('node:child_process');
  const fs = require('node:fs');
  const path = require('node:path');
  const { rollen, alsRolle, alsSuperuser } = require('./rollen');
  const werkzeug = path.join(__dirname, 'test-db.js');
  const name = `${vorlage}_${process.pid}`;
  execFileSync(process.execPath, [werkzeug, 'anlegen', name, vorlage], { stdio: 'inherit' });
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = '/' + name;
  const su = url.toString();
  const r = rollen(vorlage);
  const datei = process.argv[1] ?? '';
  const quelle = fs.existsSync(datei) ? fs.readFileSync(datei, 'utf8') : '';
  const superuser = alsSuperuser(quelle);
  process.env.TEST_DB_SU_URL = su;
  process.env.TEST_DB_EIGEN_URL = superuser ? su : alsRolle(su, r.eigen);
  process.env.TEST_DATABASE_URL = superuser ? su : alsRolle(su, r.app);
  if (!superuser) {
    process.env.PGSYSTEM_USER = r.system.name;
    process.env.PGSYSTEM_PASSWORD = r.system.passwort;
  }
  process.env.TEST_DB_EIGEN = name;
  process.on('exit', () => {
    try {
      execFileSync(process.execPath, [werkzeug, 'loeschen', name], {
        stdio: 'ignore',
        env: { ...process.env, TEST_DATABASE_URL: process.env.TEST_DB_BASIS },
      });
    } catch {
      /* der Lauf räumt Reste am Ende ab (scripts/test-lauf.js) */
    }
  });
}
