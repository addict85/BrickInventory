/**
 * bcrypt rechnet in Worker-Threads (src/konto/bcryptPool.ts, Sicherheitsprüfung
 * Runde 13, H1): Der Hauptthread bleibt während der Prüfungen ansprechbar, ein
 * untätiger Arbeiter hält den Prozess nicht am Leben, und ohne Arbeiterdatei
 * rechnet der Hauptthread wie früher.
 *
 * Gegenproben (04.11.2026 gemessen, je einzeln):
 *   A  neuerPool() rechnet immer im Hauptthread (`hauptthread = true`) → rot:
 *      „rechnet im Worker …“, „der Hauptthread bleibt ansprechbar“ und „die
 *      Anmeldung prüft über den Pool“
 *   B  in naechster() `w.unref()` gestrichen → rot: „ein untätiger Arbeiter …“
 *   C  passwortPasst() ruft wieder bcrypt.compare im Hauptthread → rot: „die
 *      Anmeldung prüft über den Pool“
 *   D  in naechster() den Leerlauf-Timer gestrichen → rot: „ein untätiger
 *      Arbeiter endet nach der Leerlaufzeit“ (1 statt 0 Arbeiter)
 *   E  bcryptArbeiter() ohne die Obergrenze 4 → rot: „64 Kerne ohne Kontingent“;
 *      ohne `kontingent` → rot: „64 Kerne, Kontingent 1“
 *   F  kontingentKerne() liest nur cgroup v1 → rot: „cgroup v2: 1,5 Kerne“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { monitorEventLoopDelay } = require('node:perf_hooks');
const os = require('node:os');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const S = require('./helpers/sources');
const _req = S.buildAndRequire();
const { neuerPool } = _req('src/konto/bcryptPool.js');
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

/** Längste Verzögerung der Ereignisschleife (ms), während `arbeit` läuft. */
async function laengsteVerzoegerung(arbeit) {
  const h = monitorEventLoopDelay({ resolution: 5 });
  h.enable();
  await arbeit();
  h.disable();
  return h.max / 1e6;
}

test('rechnet im Worker und richtig', async t => {
  const pool = neuerPool(2);
  t.after(() => pool.beende());
  const hash = await pool.hash('Geheim-2026', 4);
  assert.equal(await pool.vergleiche('Geheim-2026', hash), true);
  assert.equal(await pool.vergleiche('falsch', hash), false);
  assert.equal(await pool.vergleiche('egal', 'x'), false, 'ein kaputter Hash ist kein Treffer');
  assert.equal(bcrypt.compareSync('Geheim-2026', hash), true, 'der Hash ist ein gewöhnlicher bcrypt-Hash');
  assert.deepEqual(pool.stand(), { arbeiter: 1, frei: 1, wartend: 0, hauptthread: false }, 'rechnet im Worker …');
});

test('der Hauptthread bleibt ansprechbar', async t => {
  const pool = neuerPool(2);
  t.after(() => pool.beende());
  const hash = bcrypt.hashSync('Geheim-2026', 12);
  await pool.vergleiche('aufwaermen', hash);
  const vier = f => Promise.all([1, 2, 3, 4].map(() => f('Geheim-2026', hash)));
  const imHauptthread = await laengsteVerzoegerung(() => vier(bcrypt.compare));
  const imPool = await laengsteVerzoegerung(() => vier(pool.vergleiche));
  console.log(
    `  ℹ längste Verzögerung der Ereignisschleife: Hauptthread ${imHauptthread.toFixed(0)} ms, Pool ${imPool.toFixed(0)} ms`,
  );
  assert.ok(imHauptthread >= 50, `Vorbedingung: bcryptjs hält den Hauptthread an (${imHauptthread} ms)`);
  assert.ok(imPool < imHauptthread / 2, `der Hauptthread bleibt ansprechbar: ${imPool} ms gegen ${imHauptthread} ms`);
});

test('ohne Arbeiterdatei rechnet der Hauptthread', async () => {
  const pool = neuerPool(2, path.join(os.tmpdir(), `bcrypt-arbeiter-${process.pid}-fehlt.js`));
  assert.equal(await pool.vergleiche('a', bcrypt.hashSync('a', 4)), true);
  assert.equal(pool.stand().hauptthread, true);
});

test('ein untätiger Arbeiter hält den Prozess nicht am Leben', () => {
  const code = `const { neuerPool } = require(${JSON.stringify(path.join(S.DIST, 'src/konto/bcryptPool.js'))});
    neuerPool(1).hash('x', 4).then((h) => console.log(h.length));`;
  const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', timeout: 15_000 });
  assert.equal(r.signal, null, 'ein untätiger Arbeiter …: der Prozess endete nicht von selbst');
  assert.equal(r.stdout.trim(), '60', r.stderr);
});

test('die Anmeldung prüft alte bcrypt-Hashes über den Pool', async () => {
  const { bcryptPool } = _req('src/konto/bcryptSchranke.js');
  const { passwortPasst } = _req('src/konto/passwortHash.js');
  assert.equal(await passwortPasst('Geheim-2026', bcrypt.hashSync('Geheim-2026', 4)), true);
  assert.ok(bcryptPool.stand().arbeiter >= 1 && !bcryptPool.stand().hauptthread, JSON.stringify(bcryptPool.stand()));
  await bcryptPool.beende();
});

test('ein untätiger Arbeiter endet nach der Leerlaufzeit', async t => {
  const pool = neuerPool(2, undefined, 200);
  t.after(() => pool.beende());
  await pool.hash('x', 4);
  assert.equal(pool.stand().arbeiter, 1, 'Vorbedingung: ein Arbeiter rechnete');
  for (let i = 0; i < 100 && pool.stand().arbeiter > 0; i++) await new Promise(r => setTimeout(r, 50));
  assert.equal(pool.stand().arbeiter, 0, 'ein untätiger Arbeiter endet nach der Leerlaufzeit');
  assert.equal(await pool.vergleiche('x', await pool.hash('x', 4)), true, 'danach entsteht wieder einer');
  assert.deepEqual(pool.stand(), { arbeiter: 1, frei: 1, wartend: 0, hauptthread: false });
});

test('die Zahl der Arbeiter ist gedeckelt', () => {
  const { bcryptArbeiter, kontingentKerne } = _req('src/konto/bcryptSchranke.js');
  const { ladeKonfig } = _req('src/infra/konfig.js');
  assert.equal(bcryptArbeiter(null, 64, null), 4, '64 Kerne ohne Kontingent');
  assert.equal(bcryptArbeiter(null, 64, 1), 2, '64 Kerne, Kontingent 1');
  assert.equal(bcryptArbeiter(null, 3, null), 3);
  assert.equal(bcryptArbeiter(ladeKonfig({ BCRYPT_ARBEITER: '8' }).bcryptArbeiter, 64, 2), 8, 'die Variable gilt');
  assert.equal(ladeKonfig({}).bcryptArbeiter, null);
  assert.throws(
    () => ladeKonfig({ BCRYPT_ARBEITER: '0' }),
    /BCRYPT_ARBEITER="0"/,
    'ein ungültiger Wert hält den Start an',
  );

  const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), 'cgroup-'));
  const t = (f, inhalt) => {
    fs.mkdirSync(path.dirname(path.join(wurzel, f)), { recursive: true });
    fs.writeFileSync(path.join(wurzel, f), inhalt);
  };
  try {
    assert.equal(kontingentKerne(wurzel), null, 'ohne Dateien kein Kontingent');
    t('cpu/cpu.cfs_quota_us', '50000\n');
    t('cpu/cpu.cfs_period_us', '100000\n');
    assert.equal(kontingentKerne(wurzel), 1, 'cgroup v1: halber Kern');
    t('cpu/cpu.cfs_quota_us', '-1\n');
    assert.equal(kontingentKerne(wurzel), null, 'cgroup v1 ohne Kontingent');
    t('cpu.max', '150000 100000\n');
    assert.equal(kontingentKerne(wurzel), 2, 'cgroup v2: 1,5 Kerne');
    t('cpu.max', 'max 100000\n');
    assert.equal(kontingentKerne(wurzel), null, 'cgroup v2 ohne Kontingent');
  } finally {
    fs.rmSync(wurzel, { recursive: true, force: true });
  }
});
