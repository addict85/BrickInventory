const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// What root does to ./data is in daten-rechte.sh (its own service before app and jobs).
const ep = fs.readFileSync(path.join(__dirname, '..', 'daten-rechte.sh'), 'utf8');
const entry = fs.readFileSync(path.join(__dirname, '..', 'docker-entrypoint.sh'), 'utf8');

/**
 * The container start is not silent, and it does not work in vain.
 */

test('the startup says what it does', () => {
  // The actual damage was not the waiting time but the silence: one
  // cannot tell whether something is working or hanging.
  const zeilen = [...ep.matchAll(/^echo "\[daten-rechte\]/gm)].length;
  assert.ok(
    zeilen >= 2,
    `Nur ${zeilen} Ausgabe(n) im Entrypoint. Ohne sie beginnt jeder Start mit ` + 'einer unbestimmten Zeit Schweigen.',
  );
  const firstOutput = ep.indexOf('echo "[daten-rechte]');
  const firstWork = ep.indexOf('mkdir -p');
  assert.ok(
    firstOutput > 0 && firstOutput < firstWork,
    'Die erste Ausgabe steht hinter der ersten Arbeit — dann schweigt der Start ' +
      'wieder genau so lange, wie die Arbeit dauert.',
  );
});

test('the owner change does not run on every start', () => {
  // ── The rule ─────────────────────────────────────────────────────────────
  // `chown -R` over the data directory is a REPAIR STEP. It may
  // occur, but never unconditionally: every inode change is on an SD card
  // or a network drive a separate write, and data/images/ fills
  // up with every set, part and minifigure image.
  const rekursiv = [...ep.matchAll(/^\s*(chown -R |find \/app\/data -xdev ! -uid "\$ZIEL_UID" -exec chown )/gm)];
  assert.ok(
    rekursiv.length > 0,
    'Der Reparaturschritt fehlt ganz — ein frisch ' + 'eingehaengter Datentraeger waere dann nie zu retten',
  );
  for (const m of rekursiv) {
    // Indented, i.e. in a function or a branch; at the start of the line
    // it would run over all images at EVERY start.
    assert.match(m[0], /^\s+/, 'Der Reparaturschritt steht unbedingt am Zeilenanfang.');
  }
  // The search stops at the FIRST hit: in the normal case one pass without
  // a single write.
  assert.match(
    ep,
    /find \/app\/data -xdev ! -uid "\$ZIEL_UID" -print -quit/,
    'Die Vorabsuche fehlt oder laeuft ohne -quit durch — dann kostet sie den ' +
      'ganzen Baum, statt beim ersten Fund abzubrechen',
  );
});

test('whoever needs it differently can set it', () => {
  // `never` for mounts on which chown has no effect (SMB/CIFS with
  // fixed uid); `always` in case the search ever misses something.
  for (const wert of ['never', 'always']) {
    assert.ok(ep.includes(`  ${wert})`), `BRICKINV_CHOWN=${wert} gibt es nicht mehr`);
  }
  assert.match(
    ep,
    /\$\{BRICKINV_CHOWN:-auto\}/,
    'Die Vorgabe ist nicht mehr "auto" — dann entscheidet der Zufall der ' + 'Umgebung, ob ein Start Minuten kostet',
  );
});

// Counter-check (measured 02.11.2026): `su-exec brickinv` before mkdir deleted → red.
test('the service creates the created directories itself, not root', () => {
  // That way they belong to it even after BRICKINV_CHOWN=never, and a symlink of the
  // service under /app/data does not lead a mkdir by root outside.
  const code = ep
    .split('\n')
    .filter(z => !z.trimStart().startsWith('#'))
    .join('\n');
  assert.deepEqual(
    [...code.matchAll(/^.*\bmkdir\b.*$/gm)].map(m => m[0].trim()),
    ['su-exec brickinv mkdir -p \\'],
  );
  const flach = code.slice(code.indexOf('su-exec brickinv mkdir -p'));
  for (const ordner of [
    '/app/data',
    '/app/data/instructions',
    '/app/data/uploads',
    '/app/data/images/sets',
    '/app/data/images/parts',
    '/app/data/images/minifigs',
  ]) {
    assert.ok(
      flach.slice(0, 400).includes(ordner),
      `${ordner} wird nicht mehr unbedingt gesetzt — nach BRICKINV_CHOWN=never ` +
        'koennte der Dienst dort nicht schreiben',
    );
  }
});

test('a normal start does not even go through the files', () => {
  // Marco's follow-up question
  assert.match(
    ep,
    /MARKE=\/app\/data\/\.\w+/,
    'Die Marke fehlt — dann laeuft bei JEDEM Start die Suche ueber den ganzen ' +
      'Datenbestand, auch wenn nichts zu tun ist',
  );
  // It must be read BEFORE the search, otherwise it saves nothing.
  const readBrand = ep.indexOf('cat "$MARKE"');
  const gesucht = ep.indexOf('find /app/data -xdev ! -uid "$ZIEL_UID" -print');
  assert.ok(
    readBrand > 0 && readBrand < gesucht,
    'Die Marke wird erst nach der Suche gelesen. Dann ist die Suche schon ' + 'gelaufen, und die Marke spart nichts.',
  );
  // And it must carry the UID, not merely exist: a change of the UID
  // is exactly the case for which the repair step exists.
  assert.match(
    ep,
    /= "\$ZIEL_UID"/,
    'Die Marke wird nicht gegen die Ziel-UID geprueft — nach einem Wechsel der ' +
      'UID bliebe der Bestand dann fremd, und der Dienst koennte nicht schreiben',
  );
});

test('the marker aborts no startup', () => {
  // A read-only mounted volume cannot hold it. With
  // `set -e` that would otherwise be the end of the start — because of a shortcut.
  const fn = ep.slice(ep.indexOf('setzeMarke() {'), ep.indexOf('case "${BRICKINV_CHOWN'));
  assert.match(
    fn,
    /\|\| true/,
    'setzeMarke() faengt den Fehlschlag nicht ab. Auf einem nur lesbaren ' +
      'Datentraeger bricht `set -e` damit den ganzen Start ab.',
  );
});

// Counter-check (measured on 28.10.2026): `-h` removed from the marker's chown → red.
test('chown as root follows no symlink', () => {
  // /app/data belongs to the service. Without -h root would rewrite the TARGET of a
  // symlink placed there — a file outside, say /etc/passwd.
  const code = `${ep}\n${entry}`
    .split('\n')
    .filter(z => !z.trimStart().startsWith('#'))
    .join('\n');
  const aufrufe = [...code.matchAll(/\bchown\b[^\n]*/g)].map(m => m[0]);
  assert.ok(aufrufe.length >= 3, `nur ${aufrufe.length} chown gefunden`);
  assert.deepEqual(
    aufrufe.filter(z => !/\bchown (-R )?-h\b/.test(z)),
    [],
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
  const geaendert = fs.readFileSync(protokoll, 'utf8').split('\n').filter(Boolean);
  assert.ok(geaendert.includes(path.join(daten, 'images', 'bild.jpg')), geaendert.join('\n'));
  assert.ok(geaendert.includes(path.join(daten, 'verweis')), 'der Symlink selbst gehört dem Dienst');
  assert.equal(geaendert.filter(z => z.startsWith(aussen)).length, 0, 'root ändert eine Datei hinter dem Symlink');
  assert.ok(geaendert.includes('-h'));
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
// daten-rechte and su-exec” (the root branch looks for /app/daten-rechte.sh).
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
    env: { PATH: `${bin}:/usr/bin:/bin`, ROLLE: 'web' },
  });
  assert.equal(r.status, 0, `ohne root kein Weg über daten-rechte und su-exec: ${r.stderr}`);
  assert.match(
    r.stdout,
    /^umask=0077 node dist\/server\.js$/m,
    `der Server legt Dateien für andere lesbar an: ${r.stdout}`,
  );
  assert.doesNotMatch(r.stdout + r.stderr, /daten-rechte|Datenverzeichnisse/, 'als brickinv läuft kein root-Schritt');
});
