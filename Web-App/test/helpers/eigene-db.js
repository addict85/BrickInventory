'use strict';
/**
 * Vorgeladen in jede Testdatei (scripts/test-lauf.js, `--require`): Sie
 * bekommt eine eigene Datenbank als Kopie der Vorlage und kann parallel zu
 * den anderen laufen, ohne Zeilen, NOTIFY-Kanäle oder Advisory-Locks zu
 * teilen. Nur im Kindprozess des Test-Runners (NODE_TEST_CONTEXT) und nur
 * einmal: Server, die ein Test startet, erben die Umgebung samt Marke.
 */
const vorlage = process.env.TEST_DB_VORLAGE;
if (process.env.NODE_TEST_CONTEXT && vorlage && process.env.TEST_DATABASE_URL && !process.env.TEST_DB_EIGEN) {
  const { execFileSync } = require('node:child_process');
  const path = require('node:path');
  const werkzeug = path.join(__dirname, 'test-db.js');
  const name = `${vorlage}_${process.pid}`;
  execFileSync(process.execPath, [werkzeug, 'anlegen', name, vorlage], { stdio: 'inherit' });
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = '/' + name;
  process.env.TEST_DATABASE_URL = url.toString();
  process.env.TEST_DB_EIGEN = name;
  process.on('exit', () => {
    try { execFileSync(process.execPath, [werkzeug, 'loeschen', name], { stdio: 'ignore', env: { ...process.env, TEST_DATABASE_URL: process.env.TEST_DB_BASIS } }); }
    catch { /* der Lauf räumt Reste am Ende ab (scripts/test-lauf.js) */ }
  });
}
