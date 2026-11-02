const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ep = fs.readFileSync(path.join(__dirname, '..', 'docker-entrypoint.sh'), 'utf8');

/**
 * Der Start des Containers schweigt nicht, und er arbeitet nicht umsonst.
 *
 * ── Marcos Befund ───────────────────────────────────────────────────────────
 * „Das Docker-Image scheint allgemein extrem lange zu benoetigen bis es
 * startet. Die anderen sind viel schneller gestartet. Meist dauert es um die
 * 5min bis der 1. Log-Eintrag erscheint."
 *
 * ── Die Beweiskette ─────────────────────────────────────────────────────────
 * Die erste Zeile des Servers steht unmittelbar nach den Importen, und
 * console.log schreibt synchron nach stdout (server.ts, _intercept). Minuten
 * ohne Ausgabe koennen also nicht vom Server kommen — sie kommen von dem, was
 * VOR ihm laeuft. Dazwischen stand genau ein Schritt, der mit der Zahl der
 * Dateien waechst: `chown -R` ueber das ganze Datenverzeichnis, bei jedem
 * Start, obwohl nach dem ersten Mal alles laengst richtig ist.
 */

test('der Start sagt, was er tut', () => {
  // Der eigentliche Schaden war nicht die Wartezeit, sondern die Stille: Man
  // kann nicht unterscheiden, ob etwas arbeitet oder haengt.
  const zeilen = [...ep.matchAll(/^echo "\[entrypoint\]/gm)].length;
  assert.ok(zeilen >= 2,
    `Nur ${zeilen} Ausgabe(n) im Entrypoint. Ohne sie beginnt jeder Start mit ` +
    'einer unbestimmten Zeit Schweigen.');
  const ersteAusgabe = ep.indexOf('echo "[entrypoint]');
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
  // ── Marcos Rueckfrage ────────────────────────────────────────────────────
  // „Kann dieser Schritt mit den Dateien nicht erfolgen nachdem der Server
  // gestartet ist?"
  //
  // Durch den Server nicht: Er laeuft via su-exec als brickinv und darf nicht
  // chownen. Die Frage DAHINTER — warum kostet ein normaler Start ueberhaupt
  // etwas? — hat aber eine bessere Antwort als Nebenlaeufigkeit: gar nicht
  // erst suchen.
  //
  // Die Suche schreibt zwar nichts, laeuft aber ueber jede Datei. Auf einem
  // Netzlaufwerk ist schon das Durchgehen teuer: jede Abfrage ein Paket.
  // Deshalb eine Marke — nach einem erfolgreichen Durchgang steht die Ziel-UID
  // in einer Datei, und der naechste Start liest sie statt zu suchen.
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
  const ep = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'docker-entrypoint.sh'), 'utf8')
    .split('\n').filter(z => !z.trimStart().startsWith('#')).join('\n');
  const aufrufe = [...ep.matchAll(/\bchown\b[^\n]*/g)].map(m => m[0]);
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
