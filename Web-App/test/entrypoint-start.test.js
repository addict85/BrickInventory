const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Was root an ./data tut, steht in daten-rechte.sh (eigener Dienst vor app und jobs).
const ep = fs.readFileSync(path.join(__dirname, '..', 'daten-rechte.sh'), 'utf8');
const einstieg = fs.readFileSync(path.join(__dirname, '..', 'docker-entrypoint.sh'), 'utf8');

/**
 * Der Start des Containers schweigt nicht, und er arbeitet nicht umsonst.
 */

test('der Start sagt, was er tut', () => {
  // Der eigentliche Schaden war nicht die Wartezeit, sondern die Stille: Man
  // kann nicht unterscheiden, ob etwas arbeitet oder haengt.
  const zeilen = [...ep.matchAll(/^echo "\[daten-rechte\]/gm)].length;
  assert.ok(zeilen >= 2,
    `Nur ${zeilen} Ausgabe(n) im Entrypoint. Ohne sie beginnt jeder Start mit ` +
    'einer unbestimmten Zeit Schweigen.');
  const ersteAusgabe = ep.indexOf('echo "[daten-rechte]');
  const ersteArbeit = ep.indexOf('mkdir -p');
  assert.ok(ersteAusgabe > 0 && ersteAusgabe < ersteArbeit,
    'Die erste Ausgabe steht hinter der ersten Arbeit — dann schweigt der Start ' +
    'wieder genau so lange, wie die Arbeit dauert.');
});

test('der Eigentuemerwechsel laeuft nicht bei jedem Start', () => {
  // ── Die Regel ────────────────────────────────────────────────────────────
  // `chown -R` ueber das Datenverzeichnis ist ein REPARATURSCHRITT. Er darf
  // vorkommen, aber nie unbedingt: Jede Inode-Aenderung ist auf einer SD-Karte
  // oder einem Netzlaufwerk ein eigener Schreibvorgang, und data/images/ fuellt
  // sich mit jedem Set-, Teile- und Minifigurenbild.
  const rekursiv = [...ep.matchAll(/^\s*(chown -R |find \/app\/data -xdev ! -uid "\$ZIEL_UID" -exec chown )/gm)];
  assert.ok(rekursiv.length > 0, 'Der Reparaturschritt fehlt ganz — ein frisch ' +
    'eingehaengter Datentraeger waere dann nie zu retten');
  for (const m of rekursiv) {
    // Eingerückt, also in einer Funktion oder einem Zweig; am Zeilenanfang
    // liefe er bei JEDEM Start über alle Bilder.
    assert.match(m[0], /^\s+/, 'Der Reparaturschritt steht unbedingt am Zeilenanfang.');
  }
  // Die Suche haelt beim ERSTEN Treffer an: im Normalfall ein Durchlauf ohne
  // einen einzigen Schreibvorgang.
  assert.match(ep, /find \/app\/data -xdev ! -uid "\$ZIEL_UID" -print -quit/,
    'Die Vorabsuche fehlt oder laeuft ohne -quit durch — dann kostet sie den ' +
    'ganzen Baum, statt beim ersten Fund abzubrechen');
});

test('wer es anders braucht, kann es stellen', () => {
  // `never` fuer Einhaengungen, auf denen chown nichts bewirkt (SMB/CIFS mit
  // festem uid); `always`, falls die Suche einmal etwas nicht sieht.
  for (const wert of ['never', 'always']) {
    assert.ok(ep.includes(`  ${wert})`),
      `BRICKINV_CHOWN=${wert} gibt es nicht mehr`);
  }
  assert.match(ep, /\$\{BRICKINV_CHOWN:-auto\}/,
    'Die Vorgabe ist nicht mehr "auto" — dann entscheidet der Zufall der ' +
    'Umgebung, ob ein Start Minuten kostet');
});

// Gegenprobe (02.11.2026 gemessen): `su-exec brickinv` vor mkdir gestrichen → rot.
test('die angelegten Verzeichnisse legt der Dienst selbst an, nicht root', () => {
  // So gehören sie ihm auch nach BRICKINV_CHOWN=never, und ein Symlink des
  // Dienstes unter /app/data führt kein mkdir von root nach aussen.
  const code = ep.split('\n').filter(z => !z.trimStart().startsWith('#')).join('\n');
  assert.deepEqual([...code.matchAll(/^.*\bmkdir\b.*$/gm)].map(m => m[0].trim()), ['su-exec brickinv mkdir -p \\']);
  const flach = code.slice(code.indexOf('su-exec brickinv mkdir -p'));
  for (const ordner of ['/app/data', '/app/data/instructions', '/app/data/uploads',
                        '/app/data/images/sets', '/app/data/images/parts',
                        '/app/data/images/minifigs']) {
    assert.ok(flach.slice(0, 400).includes(ordner),
      `${ordner} wird nicht mehr unbedingt gesetzt — nach BRICKINV_CHOWN=never ` +
      'koennte der Dienst dort nicht schreiben');
  }
});

test('ein normaler Start geht gar nicht erst durch die Dateien', () => {
  // Marcos Rueckfrage
  assert.match(ep, /MARKE=\/app\/data\/\.\w+/,
    'Die Marke fehlt — dann laeuft bei JEDEM Start die Suche ueber den ganzen ' +
    'Datenbestand, auch wenn nichts zu tun ist');
  // Sie muss VOR der Suche gelesen werden, sonst spart sie nichts.
  const markeGelesen = ep.indexOf('cat "$MARKE"');
  const gesucht = ep.indexOf('find /app/data -xdev ! -uid "$ZIEL_UID" -print');
  assert.ok(markeGelesen > 0 && markeGelesen < gesucht,
    'Die Marke wird erst nach der Suche gelesen. Dann ist die Suche schon ' +
    'gelaufen, und die Marke spart nichts.');
  // Und sie muss die UID tragen, nicht bloss existieren: Ein Wechsel der UID
  // ist genau der Fall, fuer den es den Reparaturschritt gibt.
  assert.match(ep, /= "\$ZIEL_UID"/,
    'Die Marke wird nicht gegen die Ziel-UID geprueft — nach einem Wechsel der ' +
    'UID bliebe der Bestand dann fremd, und der Dienst koennte nicht schreiben');
});

test('die Marke bricht keinen Start ab', () => {
  // Ein nur lesbar eingehaengter Datentraeger kann sie nicht aufnehmen. Mit
  // `set -e` waere das sonst das Ende des Starts — wegen einer Abkuerzung.
  const fn = ep.slice(ep.indexOf('setzeMarke() {'), ep.indexOf('case "${BRICKINV_CHOWN'));
  assert.match(fn, /\|\| true/,
    'setzeMarke() faengt den Fehlschlag nicht ab. Auf einem nur lesbaren ' +
    'Datentraeger bricht `set -e` damit den ganzen Start ab.');
});

// Gegenprobe (am 28.10.2026 gemessen): `-h` am chown der Marke entfernt → rot.
test('chown als root folgt keinem Symlink', () => {
  // /app/data gehört dem Dienst. Ohne -h schriebe root das ZIEL eines dort
  // abgelegten Symlinks um — eine Datei ausserhalb, etwa /etc/passwd.
  const code = `${ep}\n${einstieg}`.split('\n').filter(z => !z.trimStart().startsWith('#')).join('\n');
  const aufrufe = [...code.matchAll(/\bchown\b[^\n]*/g)].map(m => m[0]);
  assert.ok(aufrufe.length >= 3, `nur ${aufrufe.length} chown gefunden`);
  assert.deepEqual(aufrufe.filter(z => !/\bchown (-R )?-h\b/.test(z)), []);
});

// Gegenproben (02.11.2026 gemessen): in berichtige() `find -L` → rot (die Datei
// hinter dem Symlink wird umgeschrieben); `-xdev` gestrichen → rot (fehlt im Aufruf).
test('der Reparaturschritt folgt keinem Symlink und bleibt im Datenträger', (t) => {
  const os = require('node:os');
  const { spawnSync } = require('node:child_process');
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-chown-'));
  t.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
  const daten = path.join(ordner, 'data'), aussen = path.join(ordner, 'aussen');
  fs.mkdirSync(path.join(daten, 'images'), { recursive: true });
  fs.mkdirSync(aussen);
  fs.writeFileSync(path.join(daten, 'images', 'bild.jpg'), 'x');
  fs.writeFileSync(path.join(aussen, 'passwd'), 'root');
  fs.symlinkSync(aussen, path.join(daten, 'verweis'));
  const bin = path.join(ordner, 'bin'), protokoll = path.join(ordner, 'chown.log');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'chown'), `#!/bin/sh\nfor a in "$@"; do echo "$a"; done >> '${protokoll}'\n`, { mode: 0o755 });
  const fn = ep.slice(ep.indexOf('berichtige() {'), ep.indexOf('setzeMarke() {')).replaceAll('/app/data', daten);
  assert.match(fn, /find \S+ -xdev /, 'find bleibt nicht im Datenträger');
  const r = spawnSync('sh', ['-c', `${fn}\nberichtige`],
    { env: { PATH: `${bin}:${process.env.PATH}`, ZIEL_UID: '424242' }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const geaendert = fs.readFileSync(protokoll, 'utf8').split('\n').filter(Boolean);
  assert.ok(geaendert.includes(path.join(daten, 'images', 'bild.jpg')), geaendert.join('\n'));
  assert.ok(geaendert.includes(path.join(daten, 'verweis')), 'der Symlink selbst gehört dem Dienst');
  assert.equal(geaendert.filter(z => z.startsWith(aussen)).length, 0, 'root ändert eine Datei hinter dem Symlink');
  assert.ok(geaendert.includes('-h'));
});

// Gegenprobe (01.11.2026 gemessen): setzeMarke wieder mit `printf … > "$MARKE"`
// als root → rot: „die Marke schreibt nicht durch einen Symlink“.
test('die Marke schreibt nicht durch einen Symlink', (t) => {
  const os = require('node:os');
  const { spawnSync } = require('node:child_process');
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-marke-'));
  t.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
  const fremd = path.join(ordner, 'fremd'), marke = path.join(ordner, '.eigentuemer');
  fs.writeFileSync(fremd, 'unberuehrt');
  fs.symlinkSync(fremd, marke);
  const fn = ep.slice(ep.indexOf('setzeMarke() {'), ep.indexOf('case "${BRICKINV_CHOWN'));
  // su-exec gibt es nur im Image; hier wechselt es den Nutzer nicht.
  fs.mkdirSync(path.join(ordner, 'bin'));
  fs.writeFileSync(path.join(ordner, 'bin', 'su-exec'), '#!/bin/sh\nshift\nexec "$@"\n', { mode: 0o755 });
  const r = spawnSync('sh', ['-c', `${fn}\nsetzeMarke`],
    { env: { PATH: `${path.join(ordner, 'bin')}:${process.env.PATH}`, MARKE: marke, ZIEL_UID: '1234' }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(fremd, 'utf8'), 'unberuehrt');
  assert.equal(fs.lstatSync(marke).isSymbolicLink(), false);
  assert.equal(fs.readFileSync(marke, 'utf8'), '1234');
});

// Gegenproben (04.11.2026 gemessen, Runde 12 H2): nach `umask 077` wieder
// `umask 022` → rot (neue Ordner 755); das chmod der Uploads gestrichen → rot
// (alte Datei 644).
test('was der Dienst anlegt und hochgeladen hat, liest nur er', (t) => {
  const os = require('node:os');
  const { spawnSync } = require('node:child_process');
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-umask-'));
  t.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
  const daten = path.join(ordner, 'data'), alt = path.join(daten, 'uploads', '3', 'rechnung.pdf');
  fs.mkdirSync(path.dirname(alt), { recursive: true });
  fs.writeFileSync(alt, '%PDF');
  fs.chmodSync(alt, 0o644);
  fs.mkdirSync(path.join(ordner, 'bin'));
  fs.writeFileSync(path.join(ordner, 'bin', 'su-exec'), '#!/bin/sh\nshift\nexec "$@"\n', { mode: 0o755 });
  const teil = ep.slice(ep.indexOf('umask 077'), ep.indexOf('echo "[daten-rechte] fertig')).replaceAll('/app/data', daten);
  const r = spawnSync('sh', ['-c', `umask 022\n${teil}`],
    { env: { PATH: `${path.join(ordner, 'bin')}:${process.env.PATH}` }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const rechte = (p) => (fs.statSync(p).mode & 0o777).toString(8);
  assert.deepEqual([rechte(path.join(daten, 'images', 'sets')), rechte(alt), rechte(path.dirname(alt))], ['700', '600', '700']);
});

// Gegenproben (11.11.2026 gemessen, je einzeln): im Entrypoint `umask 077`
// gestrichen → rot „der Server legt Dateien für andere lesbar an“; die Abfrage
// `[ "$(id -u)" = 0 ]` durch `true` ersetzt → rot „ohne root kein Weg über
// daten-rechte und su-exec“ (der root-Zweig sucht /app/daten-rechte.sh).
test('als brickinv gestartet geht der Entrypoint ohne root-Schritt direkt zum Server', (t) => {
  const os = require('node:os');
  const { spawnSync } = require('node:child_process');
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-einstieg-'));
  t.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
  const bin = path.join(ordner, 'bin');
  fs.mkdirSync(bin);
  // compose.yaml startet app und jobs mit `user: brickinv`; `id` und `node` stehen hier dafür.
  fs.writeFileSync(path.join(bin, 'id'), '#!/bin/sh\necho 100\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'node'), '#!/bin/sh\necho "umask=$(umask) node $*"\n', { mode: 0o755 });
  const r = spawnSync('sh', [path.join(__dirname, '..', 'docker-entrypoint.sh')], { cwd: ordner, encoding: 'utf8',
    env: { PATH: `${bin}:/usr/bin:/bin`, ROLLE: 'web' } });
  assert.equal(r.status, 0, `ohne root kein Weg über daten-rechte und su-exec: ${r.stderr}`);
  assert.match(r.stdout, /^umask=0077 node dist\/server\.js$/m, `der Server legt Dateien für andere lesbar an: ${r.stdout}`);
  assert.doesNotMatch(r.stdout + r.stderr, /daten-rechte|Datenverzeichnisse/, 'als brickinv läuft kein root-Schritt');
});
