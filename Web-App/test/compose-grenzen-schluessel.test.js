/**
 * Betrieb: Jeder Dienst in compose.yaml hat Grenzen für Speicher, Prozesse
 * und CPU, und der Datenschlüssel ist für app und jobs nur lesbar — angelegt
 * wird er vom Dienst `schluessel`, dessen Skript hier wirklich läuft (Pfade in
 * einen Sandkasten umgebogen, Eigentümer der aktuelle Nutzer).
 *
 * Gegenproben (03.11.2026 gemessen, je einzeln):
 *   A  mem_limit bei caddy gestrichen → rot: „jeder Dienst hat Grenzen" (caddy)
 *   B  ./schluessel bei jobs wieder ohne :ro → rot: „… nur lesend" (jobs)
 *   C  im Skript die Prüfung auf den alten Schlüssel gestrichen → rot: „ein
 *      alter Schlüssel in data/ bleibt der einzige"
 *   D  im Skript `umask 077` und `chmod 400` gestrichen → rot: „nur der
 *      Eigentümer liest ihn"
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
const DIENSTE = [...compose.slice(compose.indexOf('\nservices:'), compose.indexOf('\nvolumes:')).matchAll(/^ {2}([a-z-]+):\s*$/gm)].map(m => m[1]);

/** Vorgabe aus `${VAR:-wert}` oder der Wert selbst, in Byte bzw. als Zahl. */
const wert = (roh) => roh.replace(/^\$\{\w+:-(.*)\}$/, '$1');
const byte = (roh) => { const m = wert(roh).match(/^(\d+)([kmg])?$/i); return m ? Number(m[1]) * { k: 2 ** 10, m: 2 ** 20, g: 2 ** 30 }[m[2]?.toLowerCase() ?? ''] || Number(m?.[1]) : NaN; };

test('jeder Dienst hat Grenzen für Speicher, Prozesse und CPU', () => {
  assert.ok(DIENSTE.length >= 6, `nur ${DIENSTE.join(', ')}`);
  const fehlt = [];
  for (const n of DIENSTE) {
    const b = dienst(n);
    const mem = b.match(/^\s+mem_limit:\s*(\S+)/m)?.[1], pids = b.match(/^\s+pids_limit:\s*(\d+)/m)?.[1];
    const cpus = b.match(/^\s+cpus:\s*(\S+)/m)?.[1];
    if (!mem || !(byte(mem) >= 32 * 2 ** 20 && byte(mem) <= 4 * 2 ** 30)) fehlt.push(`${n}: mem_limit ${mem}`);
    if (!pids || Number(pids) > 512) fehlt.push(`${n}: pids_limit ${pids}`);
    if (!cpus || !(Number(wert(cpus)) > 0 && Number(wert(cpus)) <= 4)) fehlt.push(`${n}: cpus ${cpus}`);
  }
  assert.deepEqual(fehlt, [], 'jeder Dienst hat Grenzen');
});

test('app und jobs sehen den Datenschlüssel nur lesend', () => {
  for (const n of ['app', 'jobs']) {
    const b = dienst(n);
    assert.match(b, /^\s+- \.\/schluessel:\/app\/schluessel:ro\s*$/m, `${n}: ./schluessel nur lesend`);
    assert.match(b, /schluessel:\s*\n\s+condition: service_completed_successfully/, `${n} wartet nicht auf den Schlüssel`);
  }
  const s = dienst('schluessel');
  assert.match(s, /entrypoint: \["sh", "\/app\/schluessel-anlegen\.sh"\]/);
  assert.match(s, /network_mode: none/);
  assert.match(fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8'), /^COPY .*\bschluessel-anlegen\.sh\b.* \.\/$/m,
    'das Skript liegt nicht im Image');
});

function sandkasten() {
  const ort = fs.mkdtempSync(path.join(os.tmpdir(), 'schluessel-'));
  fs.mkdirSync(path.join(ort, 'schluessel')); fs.mkdirSync(path.join(ort, 'data'));
  const lauf = () => spawnSync('sh', [path.join(ROOT, 'schluessel-anlegen.sh')], { encoding: 'utf8',
    env: { ...process.env, SCHLUESSEL_ORDNER: path.join(ort, 'schluessel'), ALTER_SCHLUESSEL: path.join(ort, 'data', '.datenschluessel'),
      SCHLUESSEL_EIGNER: os.userInfo().username } });
  return { ort, lauf, datei: path.join(ort, 'schluessel', 'datenschluessel') };
}

test('der Schlüssel entsteht einmal, nur der Eigentümer liest ihn', (t) => {
  const { ort, lauf, datei } = sandkasten();
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

test('ein alter Schlüssel in data/ bleibt der einzige', (t) => {
  const { ort, lauf, datei } = sandkasten();
  t.after(() => fs.rmSync(ort, { recursive: true, force: true }));
  fs.writeFileSync(path.join(ort, 'data', '.datenschluessel'), Buffer.alloc(32, 7).toString('base64'));
  const r = lauf();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(datei), false, 'neben dem alten ein zweiter Schlüssel');
});
