/**
 * Ein Job-Prozess, dessen Start scheitert, beendet sich mit Exit-Code 1 und
 * hinterlässt kein Lebenszeichen: Der Healthcheck darf keinen Prozess ohne
 * Worker für gesund halten.
 *
 * Geprüft am echten Server (ROLLE=jobs). Ein vorgeladenes Modul lässt
 * planeAlle() werfen, wie es eine fehlende Tabelle oder Verbindung täte.
 *
 * Gegenproben (05.11.2026 gemessen):
 *   A  in server.ts wieder `void starte();` → rot: „der Prozess endet mit
 *      Exit-Code 1“ (er lief weiter, bis der Test ihn nach 20 s abbrach)
 *   B  in starteJobs() das Lebenszeichen wieder vor planeAlle() → rot:
 *      „kein Lebenszeichen ohne Worker“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const URL_DB = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.DATABASE_URL = URL_DB;
const ROOT = path.join(__dirname, '..');
const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');

const VORLADEN = `
const Module = require('node:module');
const echt = Module.prototype.require;
Module.prototype.require = function (name) {
  const m = echt.apply(this, arguments);
  if (typeof name === 'string' && /(?:auftraege[/\\\\]|^\\.\\/)zeitplan(\\.js)?$/.test(name))
    return { ...m, planeAlle: async () => { throw new Error('Testfehler: planeAlle'); } };
  return m;
};`;

test('ein gescheiterter Start des Job-Prozesses beendet ihn', { concurrency: 1, timeout: 90_000 }, async t => {
  const db = await datenOderSkip(t, _req);
  if (!db) return;
  const { liesZustand, loescheZustand } = require('./helpers/sources').testBereich('auftraege').laufzustand;
  const { LEBENSZEICHEN_SCHLUESSEL } = _req('startup/jobsProzess.js');
  await loescheZustand(LEBENSZEICHEN_SCHLUESSEL);
  t.after(() => db.pool.end().catch(() => {}));

  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-startfehler-'));
  const vorladen = path.join(ordner, 'planeAlle-wirft.js');
  fs.writeFileSync(vorladen, VORLADEN);
  t.after(() => fs.rmSync(ordner, { recursive: true, force: true }));

  const srv = spawn(process.execPath, ['--require', vorladen, path.join(ROOT, 'dist', 'server.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DATABASE_URL: URL_DB, ROLLE: 'jobs' },
  });
  let log = '';
  srv.stdout.on('data', d => {
    log += d;
  });
  srv.stderr.on('data', d => {
    log += d;
  });
  const ende = await new Promise(fertig => {
    const frist = setTimeout(() => {
      srv.kill('SIGKILL');
      fertig('lief weiter');
    }, 20_000);
    srv.on('exit', code => {
      clearTimeout(frist);
      fertig(code);
    });
  });

  await t.test('der Prozess endet mit Exit-Code 1', () => {
    assert.equal(ende, 1, log.slice(-1500));
    assert.match(log, /Start gescheitert: .*Testfehler: planeAlle/);
  });

  await t.test('kein Lebenszeichen ohne Worker', async () => {
    assert.equal(await liesZustand(LEBENSZEICHEN_SCHLUESSEL), null);
  });
});
