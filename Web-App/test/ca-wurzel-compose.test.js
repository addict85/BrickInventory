/**
 * Der Schlüssel der Caddy-CA bleibt in Caddy: Die App sieht nur das Volume
 * ca-wurzel, in das Caddys Startschleife allein root.crt kopiert. Die Schleife
 * aus compose.yaml läuft hier wirklich (sh, Pfade in einen Sandkasten
 * umgebogen, `caddy run` durch `sleep` ersetzt).
 *
 * Gegenproben (01.11.2026 gemessen):
 *   A  App wieder mit `./caddy/data/caddy/pki/authorities/local:/caddy-ca:ro`
 *      → rot: „kein Dienst ausser Caddy …"
 *   B  in der Schleife zusätzlich `cp /data/caddy/pki/authorities/local/*
 *      /ca-wurzel/` → rot: „die Schleife kopiert nur root.crt …" (root.key im Volume)
 *   C  `sleep 5` durch `exit 0` ersetzt (nur ein Durchlauf) → rot: „… auch wenn
 *      Caddy die CA erst später anlegt"
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const compose = fs.readFileSync(path.join(ROOT, 'compose.yaml'), 'utf8');

/** Die Zeilen eines Dienstes ohne Kommentare (wie test/compose-pgweb.test.js). */
function dienst(name) {
  const zeilen = compose.split('\n');
  const start = zeilen.findIndex(l => new RegExp(`^  ${name}:\\s*$`).test(l));
  const block = [];
  for (let i = start + 1; i < zeilen.length; i++) {
    const l = zeilen[i];
    if (/^\s*#/.test(l)) continue;
    if (/^  \S/.test(l) || /^\S/.test(l)) break;
    block.push(l);
  }
  return block;
}
const einhaengungen = (name) => dienst(name).map(l => l.match(/^\s+-\s+([^\s:]+):(\/\S*)\s*$/)).filter(Boolean)
  .map(m => ({ quelle: m[1], ziel: m[2].replace(/:ro$/, ''), nurLesen: m[2].endsWith(':ro') }));

/** Das Skript hinter `command: [sh, -c, |]` von Caddy, wie Compose es übergibt ($$ → $). */
function caddySkript() {
  const z = dienst('caddy');
  const i = z.findIndex(l => /^\s+- \|\s*$/.test(l));
  const rumpf = [];
  for (const l of z.slice(i + 1)) { if (!/^ {8}/.test(l)) break; rumpf.push(l.slice(8)); }
  return rumpf.join('\n').replace(/\$\$/g, '$');
}

test('kein Dienst ausser Caddy hängt Caddys Daten ein, die App nur das Zertifikat', () => {
  const namen = [...compose.matchAll(/^ {2}([a-z]+):\s*$/gm)].map(m => m[1]);
  assert.ok(namen.includes('app') && namen.includes('caddy'), `Dienste nicht gefunden: ${namen}`);
  for (const n of namen.filter(n => n !== 'caddy')) {
    assert.deepEqual(einhaengungen(n).filter(e => e.quelle.startsWith('./caddy')), [], `${n} sieht Caddys Daten`);
  }
  const ca = einhaengungen('app').find(e => e.quelle === 'ca-wurzel');
  assert.deepEqual(ca, { quelle: 'ca-wurzel', ziel: '/caddy-ca', nurLesen: true });
  assert.ok(dienst('app').some(l => /^\s+CA_ZERTIFIKAT:\s*\/caddy-ca\/root\.crt\s*$/.test(l)));
  assert.ok(einhaengungen('caddy').some(e => e.quelle === 'ca-wurzel' && e.ziel === '/ca-wurzel' && !e.nurLesen));
  assert.match(compose, /^volumes:\n(?:\s*#.*\n)*\s+ca-wurzel:\s*$/m, 'das Volume ca-wurzel ist nicht angelegt');
});

test('die Schleife kopiert nur root.crt, auch wenn Caddy die CA erst später anlegt', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wurzelprobe-'));
  const ca = path.join(tmp, 'data', 'caddy', 'pki', 'authorities', 'local'), vol = path.join(tmp, 'vol');
  fs.mkdirSync(vol);
  const skript = caddySkript();
  assert.match(skript, /exec caddy run /, 'Caddy startet nicht mehr am Ende des Skripts');
  const umgebogen = skript.replaceAll('/data/', `${tmp}/data/`).replaceAll('/ca-wurzel', vol)
    .replace(/exec caddy run .*/, 'exec sleep 60');
  const p = spawn('sh', ['-c', umgebogen], { detached: true, stdio: 'ignore' });
  t.after(() => { try { process.kill(-p.pid, 'SIGKILL'); } catch { /* schon beendet */ } fs.rmSync(tmp, { recursive: true, force: true }); });

  await new Promise(r => setTimeout(r, 500));
  assert.deepEqual(fs.readdirSync(vol), [], 'ohne CA nichts im Volume');
  // Wie Caddy beim ersten Start: Schlüssel und Zertifikat, nur für root lesbar.
  fs.mkdirSync(ca, { recursive: true });
  fs.writeFileSync(path.join(ca, 'root.key'), '-----BEGIN EC PRIVATE KEY-----\ngeheim\n', { mode: 0o600 });
  fs.writeFileSync(path.join(ca, 'root.crt'), '-----BEGIN CERTIFICATE-----\nwurzel\n', { mode: 0o600 });
  for (let i = 0; i < 80 && !fs.existsSync(path.join(vol, 'root.crt')); i++) await new Promise(r => setTimeout(r, 100));
  assert.deepEqual(fs.readdirSync(vol), ['root.crt']);
  assert.equal(fs.readFileSync(path.join(vol, 'root.crt'), 'utf8'), '-----BEGIN CERTIFICATE-----\nwurzel\n');
  assert.equal(fs.statSync(path.join(vol, 'root.crt')).mode & 0o777, 0o644, 'die App (brickinv) kann es nicht lesen');
});
