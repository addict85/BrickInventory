/**
 * Operation: every service in compose.yaml has limits for memory, processes
 * and CPU, and the data key is read-only for app and jobs — it is created
 * by the service `schluessel`, whose script really runs here (paths bent into
 * a sandbox, owner the current user).
 *
 * Counter-checks (measured 03.11.2026, each alone):
 *   A  mem_limit deleted for caddy → red: “every service has limits" (caddy)
 *   B  ./schluessel for jobs again without :ro → red: “… read-only" (jobs)
 *   C  in the script the check for the old key deleted → red: “an
 *      old key in data/ stays the only one"
 *   D  in the script `umask 077` and `chmod 400` deleted → red: “only the
 *      owner reads it"
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const compose = fs.readFileSync(path.join(ROOT, 'compose.yaml'), 'utf8');

function dienst(name) {
  const zeilen = compose.split('\n');
  const start = zeilen.findIndex(l => new RegExp(`^  ${name}:\\s*$`).test(l));
  assert.ok(start >= 0, `Dienst ${name} fehlt`);
  const block = [];
  for (const l of zeilen.slice(start + 1)) {
    if (/^\s*#/.test(l)) continue;
    if (/^ {0,2}\S/.test(l)) break;
    block.push(l);
  }
  return block.join('\n');
}
const SERVICES = [
  ...compose.slice(compose.indexOf('\nservices:'), compose.indexOf('\nvolumes:')).matchAll(/^ {2}([a-z-]+):\s*$/gm),
].map(m => m[1]);

/** Default from `${VAR:-wert}` or the value itself, in bytes or as a number. */
const wert = roh => roh.replace(/^\$\{\w+:-(.*)\}$/, '$1');
const byte = roh => {
  const m = wert(roh).match(/^(\d+)([kmg])?$/i);
  return m ? Number(m[1]) * { k: 2 ** 10, m: 2 ** 20, g: 2 ** 30 }[m[2]?.toLowerCase() ?? ''] || Number(m?.[1]) : NaN;
};

test('every service has limits for memory, processes and CPU', () => {
  assert.ok(SERVICES.length >= 6, `nur ${SERVICES.join(', ')}`);
  const fehlt = [];
  for (const n of SERVICES) {
    const b = dienst(n);
    const mem = b.match(/^\s+mem_limit:\s*(\S+)/m)?.[1],
      pids = b.match(/^\s+pids_limit:\s*(\d+)/m)?.[1];
    const cpus = b.match(/^\s+cpus:\s*(\S+)/m)?.[1];
    if (!mem || !(byte(mem) >= 32 * 2 ** 20 && byte(mem) <= 4 * 2 ** 30)) fehlt.push(`${n}: mem_limit ${mem}`);
    if (!pids || Number(pids) > 512) fehlt.push(`${n}: pids_limit ${pids}`);
    if (!cpus || !(Number(wert(cpus)) > 0 && Number(wert(cpus)) <= 4)) fehlt.push(`${n}: cpus ${cpus}`);
  }
  assert.deepEqual(fehlt, [], 'jeder Dienst hat Grenzen');
});

test('app and jobs only see the data key read-only', () => {
  for (const n of ['app', 'jobs']) {
    const b = dienst(n);
    assert.match(b, /^\s+- \.\/schluessel:\/app\/schluessel:ro\s*$/m, `${n}: ./schluessel nur lesend`);
    assert.match(
      b,
      /schluessel:\s*\n\s+condition: service_completed_successfully/,
      `${n} wartet nicht auf den Schlüssel`,
    );
  }
  const s = dienst('schluessel');
  assert.match(s, /entrypoint: \["sh", "\/app\/create-keys\.sh"\]/);
  assert.match(s, /network_mode: none/);
  const copy = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  assert.match(copy, /^COPY .*\bcreate-keys\.sh\b.* \.\/$/m, 'das Skript liegt nicht im Image');
  assert.match(copy, /^COPY .*\bdata-permissions\.sh\b.* \.\/$/m, 'data-permissions.sh liegt nicht im Image');
});

function sandbox() {
  const ort = fs.mkdtempSync(path.join(os.tmpdir(), 'schluessel-'));
  fs.mkdirSync(path.join(ort, 'schluessel'));
  fs.mkdirSync(path.join(ort, 'data'));
  const lauf = () =>
    spawnSync('sh', [path.join(ROOT, 'create-keys.sh')], {
      encoding: 'utf8',
      env: {
        ...process.env,
        SCHLUESSEL_ORDNER: path.join(ort, 'schluessel'),
        ALTER_SCHLUESSEL: path.join(ort, 'data', '.datenschluessel'),
        SCHLUESSEL_EIGNER: os.userInfo().username,
      },
    });
  return { ort, lauf, datei: path.join(ort, 'schluessel', 'datenschluessel') };
}

test('the key is created once, only the owner reads it', t => {
  const { ort, lauf, datei } = sandbox();
  t.after(() => fs.rmSync(ort, { recursive: true, force: true }));
  const r = lauf();
  assert.equal(r.status, 0, r.stderr);
  const erster = fs.readFileSync(datei, 'utf8');
  assert.equal(Buffer.from(erster.trim(), 'base64').length, 32);
  assert.equal(fs.statSync(datei).mode & 0o777, 0o400, 'nur der Eigentümer liest ihn');
  assert.equal(fs.statSync(path.dirname(datei)).mode & 0o777, 0o700);
  fs.chmodSync(datei, 0o600);
  assert.equal(lauf().status, 0);
  assert.equal(fs.readFileSync(datei, 'utf8'), erster, 'ein zweiter Lauf ersetzt den Schlüssel');
});

test('an old key in data/ stays the only one', t => {
  const { ort, lauf, datei } = sandbox();
  t.after(() => fs.rmSync(ort, { recursive: true, force: true }));
  fs.writeFileSync(path.join(ort, 'data', '.datenschluessel'), Buffer.alloc(32, 7).toString('base64'));
  const r = lauf();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(datei), false, 'neben dem alten ein zweiter Schlüssel');
});
