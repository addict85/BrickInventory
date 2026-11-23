/**
 * The lint rule biome/transaction-body.grit: in the body of `k.transact(async t => …)`
 * nobody queries via the outer access. Checked with the real Biome and the real
 * biome.json on a sample tree with allowed and forbidden forms.
 *
 * Counter-checks (14.11.2026, each on its own):
 *   A  in the rule `contains JsIdentifierExpression()` → `contains \`nichts\`` → “finds every
 *      outer access” red (0 instead of 5 findings)
 *   B  `not $treffer <: $p` deleted → “allows the parameter …” red (finding in erlaubt.ts)
 *   C  in src/account/deviceToken.ts `t.konfig` back to `kx.konfig` → “the stock” red
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
  await k.transact(async (t: any) => { await t.db.get('x'); await k.db.get('y'); });
  await k.transact(async t => k.konfig);
  await sk.transact(async t => { await kx.household.x(t); }, { repeatAtConflict: true });
  await db.transaction(async function (tx: any) { await db.get('z'); });
  await k.transact((t: any) => t.transact(async (u: any) => sk.x(u)));
}
`;
const ALLOWED = `
declare const k: any, sk: any;
export async function b() {
  await k.transact(async (t: any) => { await t.db.get('x'); });
  await sk.transact(t => ({ k: t.k, sk: t.sk }));
  await k.transact(k => k.x);
  await k.transact(fn);
}
declare const fn: any;
`;

/** @returns {{ file: string, row: number }[]} */
function findings(/** @type {string} */ root, /** @type {string[]} */ paths) {
  const r = spawnSync(process.execPath, [BIOME, 'lint', '--reporter=json', '--max-diagnostics=none', ...paths], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120_000,
  });
  /** @type {{ diagnostics: { category: string, location: { path: string, start?: { line: number } } }[] }} */
  const report = JSON.parse(r.stdout);
  return report.diagnostics
    .filter(d => d.category === 'plugin')
    .map(d => ({ file: d.location.path, row: d.location.start?.line ?? 0 }));
}

function probeTree() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-rumpf-'));
  fs.copyFileSync(path.join(ROOT, 'biome.json'), path.join(d, 'biome.json'));
  fs.cpSync(path.join(ROOT, 'biome'), path.join(d, 'biome'), { recursive: true });
  fs.mkdirSync(path.join(d, 'src'));
  fs.writeFileSync(path.join(d, 'src', 'verboten.ts'), VERBOTEN);
  fs.writeFileSync(path.join(d, 'src', 'erlaubt.ts'), ALLOWED);
  fs.mkdirSync(path.join(d, 'test'));
  fs.writeFileSync(path.join(d, 'test', 'probe.ts'), VERBOTEN);
  return d;
}

test('the rule finds every outer access in the body, allows the parameter and does not apply to tests', t => {
  const d = probeTree();
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const f = findings(d, ['src', 'test']);
  assert.equal(f.filter(x => x.file.endsWith('verboten.ts')).length, 5, JSON.stringify(f));
  assert.deepEqual(
    f.filter(x => !x.file.endsWith('verboten.ts')),
    [],
    'allows the parameter, fields of the same name and bodies without an arrow',
  );
});

test('the stock does not query via the outer access in any transaction body', () => {
  assert.deepEqual(findings(ROOT, ['server.ts', 'src', 'jobs', 'routes', 'db', 'startup', 'clients']), []);
});
