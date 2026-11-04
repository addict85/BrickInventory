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
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { monitorEventLoopDelay } = require('node:perf_hooks');
const os = require('node:os');

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

test('rechnet im Worker und richtig', async (t) => {
  const pool = neuerPool(2);
  t.after(() => pool.beende());
  const hash = await pool.hash('Geheim-2026', 4);
  assert.equal(await pool.vergleiche('Geheim-2026', hash), true);
  assert.equal(await pool.vergleiche('falsch', hash), false);
  assert.equal(await pool.vergleiche('egal', 'x'), false, 'ein kaputter Hash ist kein Treffer');
  assert.equal(bcrypt.compareSync('Geheim-2026', hash), true, 'der Hash ist ein gewöhnlicher bcrypt-Hash');
  assert.deepEqual(pool.stand(), { arbeiter: 1, frei: 1, wartend: 0, hauptthread: false }, 'rechnet im Worker …');
});

test('der Hauptthread bleibt ansprechbar', async (t) => {
  const pool = neuerPool(2);
  t.after(() => pool.beende());
  const hash = bcrypt.hashSync('Geheim-2026', 12);
  await pool.vergleiche('aufwaermen', hash);
  const vier = (f) => Promise.all([1, 2, 3, 4].map(() => f('Geheim-2026', hash)));
  const imHauptthread = await laengsteVerzoegerung(() => vier(bcrypt.compare));
  const imPool = await laengsteVerzoegerung(() => vier(pool.vergleiche));
  console.log(`  ℹ längste Verzögerung der Ereignisschleife: Hauptthread ${imHauptthread.toFixed(0)} ms, Pool ${imPool.toFixed(0)} ms`);
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

test('die Anmeldung prüft über den Pool', async () => {
  const { passwortPasst, bcryptPool } = _req('src/konto/bcryptSchranke.js');
  assert.equal(await passwortPasst('Geheim-2026', bcrypt.hashSync('Geheim-2026', 4)), true);
  assert.ok(bcryptPool.stand().arbeiter >= 1 && !bcryptPool.stand().hauptthread, JSON.stringify(bcryptPool.stand()));
  await bcryptPool.beende();
});
