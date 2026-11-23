/**
 * The key of the Caddy CA stays in Caddy: the app only sees the volume
 * ca-wurzel, into which Caddy's startup loop copies only root.crt. The loop
 * from compose.yaml really runs here (sh, paths bent into a sandbox,
 * `caddy run` replaced by `sleep`).
 *
 * Counter-checks (measured 01.11.2026):
 *   A  app again with `./caddy/data/caddy/pki/authorities/local:/caddy-ca:ro`
 *      → red: “no service except Caddy …"
 *   B  in the loop additionally `cp /data/caddy/pki/authorities/local/*
 *      /ca-wurzel/` → red: “the loop copies only root.crt …" (root.key in the volume)
 *   C  `sleep 5` replaced by `exit 0` (only one pass) → red: “… even if
 *      Caddy creates the CA only later"
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const compose = fs.readFileSync(path.join(ROOT, 'compose.yaml'), 'utf8');

/** The lines of a service without comments (like test/compose-haertung.test.js). */
function serviceFn(name) {
  const lines = compose.split('\n');
  const start = lines.findIndex(l => new RegExp(`^  ${name}:\\s*$`).test(l));
  const block = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*#/.test(l)) continue;
    if (/^ {2}\S/.test(l) || /^\S/.test(l)) break;
    block.push(l);
  }
  return block;
}
const mountings = name =>
  serviceFn(name)
    .map(l => l.match(/^\s+-\s+([^\s:]+):(\/\S*)\s*$/))
    .filter(Boolean)
    .map(m => ({ source: m[1], target: m[2].replace(/:ro$/, ''), readOnly: m[2].endsWith(':ro') }));

/** The script behind Caddy's `command: [sh, -c, |]`, as Compose passes it ($$ → $). */
function caddyScript() {
  const z = serviceFn('caddy');
  const i = z.findIndex(l => /^\s+- \|\s*$/.test(l));
  const body = [];
  for (const l of z.slice(i + 1)) {
    if (!/^ {8}/.test(l)) break;
    body.push(l.slice(8));
  }
  return body.join('\n').replace(/\$\$/g, '$');
}

test("no service except Caddy mounts Caddy's data, the app only the certificate", () => {
  const names = [...compose.matchAll(/^ {2}([a-z-]+):\s*$/gm)].map(m => m[1]);
  assert.ok(names.includes('app') && names.includes('caddy'), `Services not found: ${names}`);
  // caddy-rechte hands Caddy its folders and has no network (compose-haertung).
  for (const n of names.filter(n => n !== 'caddy' && n !== 'caddy-rechte')) {
    assert.deepEqual(
      mountings(n).filter(e => e.source.startsWith('./caddy')),
      [],
      `${n} sees Caddy’s data`,
    );
  }
  const ca = mountings('app').find(e => e.source === 'ca-wurzel');
  assert.deepEqual(ca, { source: 'ca-wurzel', target: '/caddy-ca', readOnly: true });
  assert.ok(serviceFn('app').some(l => /^\s+CA_CERTIFICATE:\s*\/caddy-ca\/root\.crt\s*$/.test(l)));
  assert.ok(mountings('caddy').some(e => e.source === 'ca-wurzel' && e.target === '/ca-wurzel' && !e.readOnly));
  assert.match(compose, /^volumes:\n(?:\s*#.*\n)*\s+ca-wurzel:\s*$/m, 'the volume ca-wurzel is not created');
});

test('the loop only copies root.crt, even if Caddy creates the CA only later', async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wurzelprobe-'));
  const ca = path.join(tmp, 'data', 'caddy', 'pki', 'authorities', 'local'),
    vol = path.join(tmp, 'vol');
  fs.mkdirSync(vol);
  const script = caddyScript();
  assert.match(script, /exec caddy run /, 'Caddy no longer starts at the end of the script');
  const rerouted = script
    .replaceAll('/data/', `${tmp}/data/`)
    .replaceAll('/ca-wurzel', vol)
    .replace(/exec caddy run .*/, 'exec sleep 60');
  const p = spawn('sh', ['-c', rerouted], {
    detached: true,
    stdio: 'ignore',
    env: { PATH: process.env.PATH, CA_OHNE_NAMENSBESCHRAENKUNG: 'ja', VORGELAGERTER_PROXY: 'keiner' },
  });
  t.after(() => {
    try {
      process.kill(-p.pid, 'SIGKILL');
    } catch {
      /* already ended */
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  await new Promise(r => setTimeout(r, 500));
  assert.deepEqual(fs.readdirSync(vol), [], 'without a CA nothing in the volume');
  // As Caddy at first start: key and certificate, readable only by root.
  fs.mkdirSync(ca, { recursive: true });
  fs.writeFileSync(path.join(ca, 'root.key'), '-----BEGIN EC PRIVATE KEY-----\ngeheim\n', { mode: 0o600 });
  fs.writeFileSync(path.join(ca, 'root.crt'), '-----BEGIN CERTIFICATE-----\nwurzel\n', { mode: 0o600 });
  for (let i = 0; i < 80 && !fs.existsSync(path.join(vol, 'root.crt')); i++) await new Promise(r => setTimeout(r, 100));
  assert.deepEqual(fs.readdirSync(vol), ['root.crt']);
  assert.equal(fs.readFileSync(path.join(vol, 'root.crt'), 'utf8'), '-----BEGIN CERTIFICATE-----\nwurzel\n');
  assert.equal(fs.statSync(path.join(vol, 'root.crt')).mode & 0o777, 0o644, 'the app (brickinv) cannot read it');
});
