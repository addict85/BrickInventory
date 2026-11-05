/**
 * Schalter, die im Betrieb eine Schutzschicht abschalten (Sicherheitsprüfung
 * 16, L5): MAIL_KONSOLE_MIT_TOKEN=1 verhindert mit NODE_ENV=production den
 * Start, COOKIE_SECURE=0 ergibt eine Warnzeile. Am echten Server; eigene
 * Datei, weil startverbot.test.js mit jedem Start näher an die Frist der
 * Datei rückte.
 *
 * Gegenproben (05.11.2026 gemessen, je einzeln):
 *   K  in startVerbote() den Zweig zu MAIL_KONSOLE_MIT_TOKEN entfernt → rot:
 *      „MAIL_KONSOLE_MIT_TOKEN=1 im Betrieb …“ (Code statt 1: Datenbankfehler)
 *   L  in server.ts die Schleife über startWarnungen() entfernt → rot:
 *      „COOKIE_SECURE=0 im Betrieb …“ (keine Warnzeile)
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
require('./helpers/sources').buildAndRequire();

/** Server starten und auf sein Ende warten — höchstens `ms`, dann gilt er als laufend. */
function starte(env, ms = 20000) {
  return new Promise((fertig) => {
    const srv = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, NODE_ENV: 'production', PORT: '39649',
             SESSION_SECRET: 'startverbot-geheimnis-lang-genug-1234567', ...env },
    });
    let log = '';
    srv.stdout.on('data', d => { log += d; });
    srv.stderr.on('data', d => { log += d; });
    const uhr = setTimeout(() => { srv.kill('SIGKILL'); }, ms);
    srv.on('exit', (code) => { clearTimeout(uhr); fertig({ code, log }); });
  });
}

test('MAIL_KONSOLE_MIT_TOKEN=1 im Betrieb: Start verweigert', { timeout: 50_000 }, async () => {
  const db = { DATABASE_URL: 'postgres://u:eigenes@127.0.0.1:1/x', APP_BASE_URL: 'https://lego.example.org' };
  const r = await starte({ ...db, MAIL_KONSOLE_MIT_TOKEN: '1' });
  assert.equal(r.code, 1, r.log.slice(-400));
  assert.match(r.log, /❌ \[mail\] MAIL_KONSOLE_MIT_TOKEN=1 .*Start verweigert/);
  assert.doesNotMatch(r.log, /Database initialisation failed/, 'das Verbot kommt vor der Datenbank');
  const entw = await starte({ ...db, MAIL_KONSOLE_MIT_TOKEN: '1', NODE_ENV: 'development' });
  assert.doesNotMatch(entw.log, /MAIL_KONSOLE_MIT_TOKEN/);
  assert.match(entw.log, /Database initialisation failed/);
});

test('COOKIE_SECURE=0 im Betrieb: Warnzeile beim Start', { timeout: 50_000 }, async () => {
  const db = { DATABASE_URL: 'postgres://u:eigenes@127.0.0.1:1/x', APP_BASE_URL: 'http://lego.lan' };
  const mit = await starte({ ...db, COOKIE_SECURE: '0' });
  assert.match(mit.log, /⚠️ \[start\] COOKIE_SECURE=0: Das Sitzungs-Cookie geht auch über http/);
  assert.match(mit.log, /Database initialisation failed/, 'nur eine Warnung, kein Verbot');
  const ohne = await starte({ ...db, COOKIE_SECURE: '1' });
  assert.doesNotMatch(ohne.log, /COOKIE_SECURE/);
});
