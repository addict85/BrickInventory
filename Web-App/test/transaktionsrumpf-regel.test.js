/**
 * Die Lint-Regel biome/transaktionsrumpf.grit: Im Rumpf von `k.transaktion(async t => …)`
 * fragt niemand über den äusseren Zugang. Geprüft mit dem echten Biome und der echten
 * biome.json an einem Probebaum mit erlaubten und verbotenen Formen.
 *
 * Gegenproben (14.11.2026, je einzeln):
 *   A  in der Regel `contains JsIdentifierExpression()` → `contains \`nichts\`` → „findet jeden
 *      äusseren Zugang“ rot (0 statt 5 Funde)
 *   B  `not $treffer <: $p` gestrichen → „erlaubt den Parameter …“ rot (Fund in erlaubt.ts)
 *   C  in src/konto/geraeteToken.ts `t.konfig` zurück auf `kx.konfig` → „der Bestand“ rot
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const BIOME = path.join(ROOT, 'node_modules', '@biomejs', 'biome', 'bin', 'biome');

const VERBOTEN = `
declare const k: any, sk: any, kx: any, db: any;
export async function a() {
  await k.transaktion(async (t: any) => { await t.db.get('x'); await k.db.get('y'); });
  await k.transaktion(async t => k.konfig);
  await sk.transaktion(async t => { await kx.haushalt.x(t); }, { wiederholeBeiKonflikt: true });
  await db.transaction(async function (tx: any) { await db.get('z'); });
  await k.transaktion((t: any) => t.transaktion(async (u: any) => sk.x(u)));
}
`;
const ERLAUBT = `
declare const k: any, sk: any;
export async function b() {
  await k.transaktion(async (t: any) => { await t.db.get('x'); });
  await sk.transaktion(t => ({ k: t.k, sk: t.sk }));
  await k.transaktion(k => k.x);
  await k.transaktion(fn);
}
declare const fn: any;
`;

/** @returns {{ datei: string, zeile: number }[]} */
function funde(/** @type {string} */ wurzel, /** @type {string[]} */ pfade) {
  const r = spawnSync(process.execPath, [BIOME, 'lint', '--reporter=json', '--max-diagnostics=none', ...pfade], {
    cwd: wurzel,
    encoding: 'utf8',
    timeout: 120_000,
  });
  /** @type {{ diagnostics: { category: string, location: { path: string, start?: { line: number } } }[] }} */
  const bericht = JSON.parse(r.stdout);
  return bericht.diagnostics
    .filter(d => d.category === 'plugin')
    .map(d => ({ datei: d.location.path, zeile: d.location.start?.line ?? 0 }));
}

function probebaum() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-rumpf-'));
  fs.copyFileSync(path.join(ROOT, 'biome.json'), path.join(d, 'biome.json'));
  fs.cpSync(path.join(ROOT, 'biome'), path.join(d, 'biome'), { recursive: true });
  fs.mkdirSync(path.join(d, 'src'));
  fs.writeFileSync(path.join(d, 'src', 'verboten.ts'), VERBOTEN);
  fs.writeFileSync(path.join(d, 'src', 'erlaubt.ts'), ERLAUBT);
  fs.mkdirSync(path.join(d, 'test'));
  fs.writeFileSync(path.join(d, 'test', 'probe.ts'), VERBOTEN);
  return d;
}

test('die Regel findet jeden äusseren Zugang im Rumpf, erlaubt den Parameter und gilt nicht für Tests', t => {
  const d = probebaum();
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const f = funde(d, ['src', 'test']);
  assert.equal(f.filter(x => x.datei.endsWith('verboten.ts')).length, 5, JSON.stringify(f));
  assert.deepEqual(
    f.filter(x => !x.datei.endsWith('verboten.ts')),
    [],
    'erlaubt den Parameter, gleichnamige Felder und Rümpfe ohne Pfeil',
  );
});

test('der Bestand fragt in keinem Transaktionsrumpf über den äusseren Zugang', () => {
  assert.deepEqual(funde(ROOT, ['server.ts', 'src', 'jobs', 'routes', 'db', 'startup', 'clients']), []);
});
