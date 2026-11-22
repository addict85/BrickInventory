/**
 * The container start (data-permissions.sh, docker-entrypoint.sh) runs with stubbed commands.
 *
 * Counter-checks, each in data-permissions.sh: the first message removed → red “the startup says what it
 * does”; repair also in the clean case → red “the owner change does not run on every start”; default
 * `always` instead of `auto` → red “whoever needs it differently can set it”; `mkdir` without su-exec → red
 * “the service creates the created directories itself, not root”; the marker check replaced by `false` →
 * red “a normal start does not even go through the files”; `|| true` removed from setzeMarke() → red
 * “the marker aborts no startup”; `-h` removed from the chown of /app/data → red “chown as root follows
 * no symlink”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// What root does to ./data is in data-permissions.sh (its own service before app and jobs).
const ep = fs.readFileSync(path.join(__dirname, '..', 'data-permissions.sh'), 'utf8');

/**
 * Runs data-permissions.sh (or, as root, docker-entrypoint.sh) with /app replaced by a temporary
 * directory and stubs for id, chown, find, mkdir and su-exec. Stubs and the script write into one
 * log, so the order of messages and work is visible.
 * @param {{ env?: Record<string, string>, marker?: string, root?: boolean, findHit?: string, failSu?: boolean }} o
 */
function runPermissions(o = {}) {
  const os = require('node:os');
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-perm-'));
  try {
    const app = path.join(dir, 'app');
    const bin = path.join(dir, 'bin');
    const log = path.join(dir, 'log');
    fs.mkdirSync(path.join(app, 'data'), { recursive: true });
    fs.mkdirSync(path.join(app, 'schluessel'), { recursive: true });
    fs.mkdirSync(bin);
    if (o.marker !== undefined) fs.writeFileSync(path.join(app, 'data', '.eigentuemer'), o.marker);
    const stub = (name, body) =>
      fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "+ ${name} $*" >> '${log}'\n${body}\n`, { mode: 0o755 });
    stub('id', o.root ? 'echo 0' : 'echo 4242');
    stub('chown', '');
    stub('mkdir', '');
    stub('find', `case "$*" in *-print*) printf '%s' "$FIND_HIT";; esac`);
    stub('su-exec', o.failSu ? 'exit 1' : '');
    const script = name =>
      fs.writeFileSync(
        path.join(app, name),
        fs.readFileSync(path.join(__dirname, '..', name), 'utf8').replaceAll('/app', app),
      );
    script('data-permissions.sh');
    script('docker-entrypoint.sh');
    const r = spawnSync(
      'sh',
      ['-c', `sh '${path.join(app, o.root ? 'docker-entrypoint.sh' : 'data-permissions.sh')}' >> '${log}' 2>&1`],
      {
        env: { PATH: `${bin}:/usr/bin:/bin`, FIND_HIT: o.findHit ?? '', ...o.env },
        encoding: 'utf8',
      },
    );
    const lines = fs.readFileSync(log, 'utf8').replaceAll(app, '/app').split('\n').filter(Boolean);
    return { status: r.status, lines, calls: lines.filter(z => z.startsWith('+ ')) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const repairs = (/** @type {string[]} */ calls) => calls.filter(z => /^\+ find .*-exec chown/.test(z));
const searches = (/** @type {string[]} */ calls) => calls.filter(z => /^\+ find .*-print -quit/.test(z));

test('the startup says what it does', () => {
  // The damage was not the waiting time but the silence: one cannot tell working from hanging.
  const { status, lines } = runPermissions();
  assert.equal(status, 0, lines.join('\n'));
  assert.match(lines[0], /^\[daten-rechte\]/, `the start begins with work instead of a message:\n${lines.join('\n')}`);
  assert.ok(lines.filter(z => z.startsWith('[daten-rechte]')).length >= 2, 'the start says too little');
  assert.match(lines.at(-1), /^\[daten-rechte\] fertig/, 'the end of the start is not announced');
});

test('the owner change does not run on every start', () => {
  // The recursive chown is a repair step: every inode change is a write on an SD card.
  const clean = runPermissions();
  assert.equal(clean.status, 0);
  assert.equal(searches(clean.calls).length, 1, 'without a marker the start must look first, once');
  assert.deepEqual(repairs(clean.calls), [], 'the repair step runs although nothing is foreign');
  const foreign = runPermissions({ findHit: '/app/data/images/x.jpg' });
  assert.equal(repairs(foreign.calls).length, 1, 'a foreign owner is found but not repaired');
});

test('whoever needs it differently can set it', () => {
  const never = runPermissions({ env: { BRICKINV_CHOWN: 'never' }, findHit: '/app/data/x' });
  assert.deepEqual([...searches(never.calls), ...repairs(never.calls)], [], 'never still searches or repairs');
  const always = runPermissions({ env: { BRICKINV_CHOWN: 'always' }, marker: '4242' });
  assert.equal(repairs(always.calls).length, 1, 'always does not force the repair');
  const auto = runPermissions({ marker: '4242', findHit: '/app/data/x' });
  assert.deepEqual(repairs(auto.calls), [], 'without BRICKINV_CHOWN the default is not auto');
});

test('the service creates the created directories itself, not root', () => {
  // That way they belong to it even after BRICKINV_CHOWN=never, and a symlink does not lead root outside.
  const { calls } = runPermissions({ env: { BRICKINV_CHOWN: 'never' } });
  assert.deepEqual(
    calls.filter(z => /^\+ mkdir/.test(z)),
    [],
    'root creates directories itself',
  );
  const made = calls.find(z => z.startsWith('+ su-exec brickinv mkdir -p')) ?? '';
  for (const d of ['instructions', 'uploads', 'images/sets', 'images/parts', 'images/minifigs'])
    assert.ok(made.split(' ').includes(`/app/data/${d}`), `/app/data/${d} is not created by the service: ${made}`);
});

test('a normal start does not even go through the files', () => {
  // The marker carries the UID: with it no search at all; after a UID change the search runs again.
  assert.deepEqual(searches(runPermissions({ marker: '4242' }).calls), [], 'the marker saves nothing');
  assert.equal(searches(runPermissions({ marker: '1000' }).calls).length, 1, 'a marker of another UID is trusted');
});

test('the marker aborts no startup', () => {
  // On a read-only volume the marker cannot be written; with `set -e` that must not end the start.
  const { status, lines } = runPermissions({ failSu: true });
  assert.equal(status, 0, `a failed marker ends the start:\n${lines.join('\n')}`);
  assert.match(lines.at(-1), /fertig/);
});

test('chown as root follows no symlink', () => {
  // Without -h root would rewrite the TARGET of a symlink placed in /app/data, say /etc/passwd.
  const { status, calls } = runPermissions({ root: true, findHit: '/app/data/x' });
  assert.equal(status, 0);
  const chowns = calls.filter(z => /^\+ chown|-exec chown/.test(z));
  assert.ok(chowns.length >= 3, `only ${chowns.length} chown calls ran:\n${calls.join('\n')}`);
  assert.deepEqual(
    chowns.filter(z => !/chown -h /.test(z)),
    [],
    'chown without -h',
  );
});

// Counter-checks (measured 02.11.2026): in berichtige() `find -L` → red (the file
// behind the symlink is rewritten); `-xdev` deleted → red (missing in the call).
test('the repair step follows no symlink and stays on the volume', t => {
  const os = require('node:os');
  const { spawnSync } = require('node:child_process');
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-chown-'));
  t.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
  const daten = path.join(ordner, 'data'),
    aussen = path.join(ordner, 'aussen');
  fs.mkdirSync(path.join(daten, 'images'), { recursive: true });
  fs.mkdirSync(aussen);
  fs.writeFileSync(path.join(daten, 'images', 'bild.jpg'), 'x');
  fs.writeFileSync(path.join(aussen, 'passwd'), 'root');
  fs.symlinkSync(aussen, path.join(daten, 'verweis'));
  const bin = path.join(ordner, 'bin'),
    protokoll = path.join(ordner, 'chown.log');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'chown'), `#!/bin/sh\nfor a in "$@"; do echo "$a"; done >> '${protokoll}'\n`, {
    mode: 0o755,
  });
  const fn = ep.slice(ep.indexOf('berichtige() {'), ep.indexOf('setzeMarke() {')).replaceAll('/app/data', daten);
  assert.match(fn, /find \S+ -xdev /, 'find bleibt nicht im Datenträger');
  const r = spawnSync('sh', ['-c', `${fn}\nberichtige`], {
    env: { PATH: `${bin}:${process.env.PATH}`, ZIEL_UID: '424242' },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  const changed = fs.readFileSync(protokoll, 'utf8').split('\n').filter(Boolean);
  assert.ok(changed.includes(path.join(daten, 'images', 'bild.jpg')), changed.join('\n'));
  assert.ok(changed.includes(path.join(daten, 'verweis')), 'der Symlink selbst gehört dem Dienst');
  assert.equal(changed.filter(z => z.startsWith(aussen)).length, 0, 'root ändert eine Datei hinter dem Symlink');
  assert.ok(changed.includes('-h'));
});

// Counter-check (measured 01.11.2026): setzeMarke again with `printf … > "$MARKE"`
// as root → red: “the marker does not write through a symlink”.
test('the marker does not write through a symlink', t => {
  const os = require('node:os');
  const { spawnSync } = require('node:child_process');
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-marke-'));
  t.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
  const fremd = path.join(ordner, 'fremd'),
    marke = path.join(ordner, '.eigentuemer');
  fs.writeFileSync(fremd, 'unberuehrt');
  fs.symlinkSync(fremd, marke);
  const fn = ep.slice(ep.indexOf('setzeMarke() {'), ep.indexOf('case "${BRICKINV_CHOWN'));
  // su-exec only exists in the image; here it does not switch the user.
  fs.mkdirSync(path.join(ordner, 'bin'));
  fs.writeFileSync(path.join(ordner, 'bin', 'su-exec'), '#!/bin/sh\nshift\nexec "$@"\n', { mode: 0o755 });
  const r = spawnSync('sh', ['-c', `${fn}\nsetzeMarke`], {
    env: { PATH: `${path.join(ordner, 'bin')}:${process.env.PATH}`, MARKE: marke, ZIEL_UID: '1234' },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(fremd, 'utf8'), 'unberuehrt');
  assert.equal(fs.lstatSync(marke).isSymbolicLink(), false);
  assert.equal(fs.readFileSync(marke, 'utf8'), '1234');
});

// Counter-checks (measured 04.11.2026, round 12 H2): after `umask 077` again
// `umask 022` → red (new folders 755); the chmod of the uploads deleted → red
// (old file 644).
test('what the service created and uploaded only it reads', t => {
  const os = require('node:os');
  const { spawnSync } = require('node:child_process');
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-umask-'));
  t.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
  const daten = path.join(ordner, 'data'),
    alt = path.join(daten, 'uploads', '3', 'rechnung.pdf');
  fs.mkdirSync(path.dirname(alt), { recursive: true });
  fs.writeFileSync(alt, '%PDF');
  fs.chmodSync(alt, 0o644);
  fs.mkdirSync(path.join(ordner, 'bin'));
  fs.writeFileSync(path.join(ordner, 'bin', 'su-exec'), '#!/bin/sh\nshift\nexec "$@"\n', { mode: 0o755 });
  const teil = ep
    .slice(ep.indexOf('umask 077'), ep.indexOf('echo "[daten-rechte] fertig'))
    .replaceAll('/app/data', daten);
  const r = spawnSync('sh', ['-c', `umask 022\n${teil}`], {
    env: { PATH: `${path.join(ordner, 'bin')}:${process.env.PATH}` },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  const rechte = p => (fs.statSync(p).mode & 0o777).toString(8);
  assert.deepEqual(
    [rechte(path.join(daten, 'images', 'sets')), rechte(alt), rechte(path.dirname(alt))],
    ['700', '600', '700'],
  );
});

// Counter-checks (measured 11.11.2026, each alone): in the entrypoint `umask 077`
// deleted → red “the server creates files readable for others”; the query
// `[ "$(id -u)" = 0 ]` replaced by `true` → red “without root no path via
// daten-rechte and su-exec” (the root branch looks for /app/data-permissions.sh).
test('started as brickinv the entrypoint goes directly to the server without a root step', t => {
  const os = require('node:os');
  const { spawnSync } = require('node:child_process');
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-einstieg-'));
  t.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
  const bin = path.join(ordner, 'bin');
  fs.mkdirSync(bin);
  // compose.yaml starts app and jobs with `user: brickinv`; `id` and `node` stand in for that here.
  fs.writeFileSync(path.join(bin, 'id'), '#!/bin/sh\necho 100\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'node'), '#!/bin/sh\necho "umask=$(umask) node $*"\n', { mode: 0o755 });
  const r = spawnSync('sh', [path.join(__dirname, '..', 'docker-entrypoint.sh')], {
    cwd: ordner,
    encoding: 'utf8',
    env: { PATH: `${bin}:/usr/bin:/bin`, ROLE: 'web' },
  });
  assert.equal(r.status, 0, `ohne root kein Weg über daten-rechte und su-exec: ${r.stderr}`);
  assert.match(
    r.stdout,
    /^umask=0077 node dist\/server\.js$/m,
    `der Server legt Dateien für andere lesbar an: ${r.stdout}`,
  );
  assert.doesNotMatch(r.stdout + r.stderr, /daten-rechte|Datenverzeichnisse/, 'als brickinv läuft kein root-Schritt');
});
