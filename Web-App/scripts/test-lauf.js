#!/usr/bin/env node
'use strict';
/**
 * `npm test`: einmal bauen, einmal eine Vorlage-Datenbank aufsetzen (basis.sql
 * und Migrationen), dann die Testdateien parallel — jede mit eigener Kopie der
 * Vorlage (test/helpers/eigene-db.js). Browser-Tests laufen danach einzeln:
 * Mehrere Chromium nebeneinander reissen auf schwachen Rechnern die Fristen.
 *
 *   TEST_DATABASE_URL  Basis; ohne sie laufen die Tests ohne Datenbank
 *   TEST_PARALLEL      gleichzeitige Testdateien (Vorgabe: doppelte Kernzahl, höchstens 8)
 *   --seriell          alles nacheinander auf der Basis-Datenbank, wie früher
 *   weitere Argumente  Testdateien statt test/*.test.js
 */
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const seriell = args.includes('--seriell');
const auswahl = args.filter(a => a !== '--seriell');

/** @param {string} url @param {string} name */
const mitDb = (url, name) => { const u = new URL(url); u.pathname = '/' + name; return u.toString(); };
/** @param {string} s */
const id = (s) => `"${s.replace(/"/g, '""')}"`;

/** @param {string[]} dateien @param {number} n @param {Record<string, string>} env @returns {Promise<number>} */
function lauf(dateien, n, env) {
  if (!dateien.length) return Promise.resolve(0);
  const vorlader = env.TEST_DB_VORLAGE ? ['--require', path.join(ROOT, 'test', 'helpers', 'eigene-db.js')] : [];
  return new Promise((fertig) => {
    const p = spawn(process.execPath,
      [...vorlader, '--test', `--test-concurrency=${n}`, '--test-timeout=60000', ...dateien],
      { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
    p.on('exit', (code) => fertig(code ?? 1));
  });
}

async function main() {
  const start = Date.now();
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-ts.js'), '--outdir', path.join(ROOT, 'dist')], { stdio: 'ignore' });

  const dateien = auswahl.length ? auswahl
    : fs.readdirSync(path.join(ROOT, 'test')).filter(f => f.endsWith('.test.js')).sort().map(f => path.join('test', f));
  if (seriell) {
    const code = await lauf(dateien, 1, {});
    console.log(`[test-lauf] seriell, ${Math.round((Date.now() - start) / 1000)} s`);
    process.exit(code);
  }
  // Einzeln laufen Browser-Tests und Dateien mit der Marke `@einzeln`: Sie
  // teilen etwas ausserhalb ihrer Datenbank, etwa eine Datei unter data/.
  const istBrowser = (/** @type {string} */ f) =>
    /CHROME_BIN|helpers\/app-browser|@einzeln\b/.test(fs.readFileSync(path.resolve(ROOT, f), 'utf8'));
  const browser = dateien.filter(istBrowser), uebrige = dateien.filter(f => !istBrowser(f));
  // Doppelt so viele wie Kerne: Viele Dateien warten auf die Datenbank oder Zeitgeber.
  const n = Math.max(1, Number(process.env.TEST_PARALLEL) || Math.min(2 * os.availableParallelism(), 8));

  const basis = process.env.TEST_DATABASE_URL;
  /** @type {Record<string, string>} */
  let env = {};
  /** @type {import('pg').Client | null} */
  let admin = null;
  let vorlage = '';
  if (basis) {
    const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));
    vorlage = `${decodeURIComponent(new URL(basis).pathname.slice(1))}_vorlage`;
    const a = new Client({ connectionString: basis });
    admin = a;
    await a.connect();
    await raeumeAuf(a, vorlage, true);
    await a.query(`CREATE DATABASE ${id(vorlage)}`);
    execFileSync(process.execPath, ['-e',
      "const db = require('./dist/db/database.js'); db.initSchemaOnce().then(() => db.pool.end()).catch(e => { console.error(e); process.exit(1); })"],
      { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, DATABASE_URL: mitDb(basis, vorlage), WEB_WORKERS: '1' } });
    env = { TEST_DB_VORLAGE: vorlage, TEST_DB_BASIS: basis };
  }
  let code = 0;
  try {
    code = await lauf(uebrige, n, env);
    code = (await lauf(browser, 1, env)) || code;
  } finally {
    if (admin) { await raeumeAuf(admin, vorlage, true).catch(() => {}); await admin.end(); }
  }
  console.log(`[test-lauf] ${uebrige.length} Dateien zu ${n} parallel, ${browser.length} Dateien einzeln (Browser, @einzeln), `
    + `${Math.round((Date.now() - start) / 1000)} s`);
  process.exit(code);
}

/** Kopien eines früheren Laufs und (mit `auchVorlage`) die Vorlage löschen. */
async function raeumeAuf(/** @type {import('pg').Client} */ admin, /** @type {string} */ vorlage, auchVorlage = false) {
  const { rows } = await admin.query(
    `SELECT datname FROM pg_database WHERE datname LIKE $1 || '\\_%' OR ($2 AND datname = $1)`, [vorlage, auchVorlage]);
  for (const r of rows) await admin.query(`DROP DATABASE IF EXISTS ${id(r.datname)} WITH (FORCE)`);
}

main().catch((e) => { console.error(`[test-lauf] ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
