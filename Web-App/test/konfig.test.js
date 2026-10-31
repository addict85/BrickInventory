/**
 * Die Datenbankverbindung steht an EINER Stelle (src/infra/konfig.ts). Der
 * CSV-Worker hatte eigene Standardwerte (brickinv statt brickinventory) und
 * verband sich ausserhalb von Docker mit einer anderen Datenbank.
 *
 * Gegenproben (am 27.10. gemessen):
 *   A  in jobs/csvImportWorker.ts wieder `process.env.PGUSER || 'brickinv'`
 *      → rot: „niemand sonst liest die Verbindungsvariablen"
 *   B  in datenbankVerbindung die Zeile für DATABASE_URL entfernt →
 *      rot: „DATABASE_URL geht vor"
 *   C  in standardPasswortInBenutzung den Zweig für connectionString auf
 *      `return false` gesetzt → rot: „das Beispielpasswort wird erkannt"
 *
 * Seit dem 30.10. liest NUR src/infra/konfig.ts die Umgebung; ein ungültiger Wert
 * beendet den Start mit einer Meldung je Variable. Gegenproben (D–F in einem
 * Lauf gemessen):
 *   D  in src/infra/dateiEmpfang.ts wieder `Number(process.env.UPLOAD_KONTINGENT_MB)`
 *      → rot: „niemand ausser der Konfiguration liest process.env“
 *   E  in ganzzahl() die Grenzprüfung `n < min || n > max` entfernt → rot:
 *      „ungültige Werte: alle auf einmal, mit Namen“ (PORT=0 ging durch)
 *   F  den Import von startup/konfigPruefen aus server.ts entfernt → rot:
 *      „der Server startet mit falschem Wert nicht“ (Stacktrace aus
 *      utils/sitzungsFrist statt der Meldung)
 *   G  (30.10.) in ladeKonfig `veraltet` immer leer → rot: „ungültige Werte:
 *      alle auf einmal, mit Namen“ (WEB_WORKERS wurde nicht mehr genannt)
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const { datenbankVerbindung, standardPasswortInBenutzung, ladeKonfig, KonfigFehler, VARIABLEN } = _req('src/infra/konfig.js');
const { ohneKommentare } = require('./helpers/sources');
const { spawnSync } = require('node:child_process');

test('ohne Angaben dieselben Standardwerte wie compose.yaml', () => {
  assert.deepEqual(datenbankVerbindung({}), {
    host: 'postgres', port: 5432, user: 'brickinventory',
    password: 'brickinventory_secret', database: 'brickinventory' });
});

test('das Beispielpasswort wird erkannt — einzeln und in DATABASE_URL', () => {
  assert.equal(standardPasswortInBenutzung({}), true);
  assert.equal(standardPasswortInBenutzung({ PGPASSWORD: 'eigenes' }), false);
  assert.equal(standardPasswortInBenutzung({ DATABASE_URL: 'postgres://brickinventory:brickinventory_secret@db/x' }), true);
  assert.equal(standardPasswortInBenutzung({ DATABASE_URL: 'postgres://brickinventory:anderes@db/x' }), false);
  assert.equal(standardPasswortInBenutzung({ DATABASE_URL: 'kaputt' }), false);
});

test('DATABASE_URL geht vor', () => {
  assert.deepEqual(datenbankVerbindung({ DATABASE_URL: 'postgres://a:b@c/d', PGUSER: 'x' }),
    { connectionString: 'postgres://a:b@c/d' });
  assert.equal(datenbankVerbindung({ PGPORT: '6543', PGUSER: 'u' }).port, 6543);
});

test('niemand sonst liest die Verbindungsvariablen', () => {
  const funde = [];
  const durch = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!['node_modules', 'dist', 'test', 'public', '.git'].includes(e.name)) durch(p); continue; }
      if (!e.name.endsWith('.ts')) continue;
      const rel = path.relative(ROOT, p);
      if (rel === path.join('src/infra/konfig.ts')) continue;
      const s = fs.readFileSync(p, 'utf8');
      for (const m of s.matchAll(/process\.env\.(PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE|DATABASE_URL)\b/g))
        funde.push(`${rel}: ${m[1]}`);
    }
  };
  durch(ROOT);
  assert.deepEqual(funde, []);
});

test('niemand ausser der Konfiguration liest process.env', () => {
  const funde = [];
  const durch = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!['node_modules', 'dist', 'test', 'public', 'scripts', '.git'].includes(e.name)) durch(p); continue; }
      if (!e.name.endsWith('.ts')) continue;
      const rel = path.relative(ROOT, p);
      if (rel === path.join('src/infra/konfig.ts')) continue;
      const zeilen = ohneKommentare(fs.readFileSync(p, 'utf8')).split('\n');
      zeilen.forEach((z, i) => { if (/process\.env\b/.test(z.replace(/\/\/.*$/, ''))) funde.push(`${rel}:${i + 1}`); });
    }
  };
  durch(ROOT);
  assert.deepEqual(funde, []);
});

test('ungültige Werte: alle auf einmal, mit Namen', () => {
  assert.throws(() => ladeKonfig({ PORT: '0', SESSION_IDLE_MINUTES: 'viel', COOKIE_SECURE: 'ja', APP_BASE_URL: 'lego.example.org' }),
    (e) => {
      assert.ok(e instanceof KonfigFehler);
      assert.deepEqual(e.fehler.map(f => f.split('=')[0]), ['APP_BASE_URL', 'PORT', 'COOKIE_SECURE', 'SESSION_IDLE_MINUTES']);
      assert.match(e.message, /PORT="0" ist keine ganze Zahl von 1 bis 65535/);
      return true;
    });
  const k = ladeKonfig({ PORT: '8080', ROLLE: 'Jobs', WEB_WORKERS: '3', COOKIE_SECURE: '0', APP_BASE_URL: 'https://lego.example.org//' });
  assert.equal(k.port, 8080);
  assert.equal(k.rolle, 'jobs');
  assert.deepEqual(k.veraltet, ['WEB_WORKERS'], 'WEB_WORKERS wirkt nicht mehr, der Start nennt es');
  assert.equal(ladeKonfig({}).rolle, 'beides', 'ohne Angabe ein Prozess für alles');
  assert.throws(() => ladeKonfig({ ROLLE: 'primary' }), /ROLLE="primary" ist weder web noch jobs noch beides/);
  assert.equal(k.cookieSecure, false);
  assert.equal(k.appBaseUrl, 'https://lego.example.org');
  assert.equal(ladeKonfig({}).sitzungLeerlaufMin, 240, 'ohne Angabe die Vorgabe');
});

test('der Server startet mit falschem Wert nicht', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
    env: { PATH: process.env.PATH, SESSION_IDLE_MINUTES: '-5', PORT: 'achtzig', DATABASE_URL: 'postgres://niemand@127.0.0.1:1/x' },
    encoding: 'utf8', timeout: 20_000 });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /Ungültige Konfiguration:\n {2}- PORT="achtzig"[^\n]*\n {2}- SESSION_IDLE_MINUTES="-5"/);
});

test('.env.example nennt jede Variable', () => {
  const beispiel = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  const fehlt = VARIABLEN.filter(v => !new RegExp(`^#? ?${v}=`, 'm').test(beispiel));
  assert.deepEqual(fehlt, []);
});
