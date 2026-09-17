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
  const rekursiv = [...ep.matchAll(/^\s*chown -R /gm)];
  assert.ok(rekursiv.length > 0, 'Der Reparaturschritt fehlt ganz — ein frisch ' +
    'eingehaengter Datentraeger waere dann nie zu retten');
  for (const m of rekursiv) {
    // Jedes `chown -R` muss eingerueckt stehen, also in einem Zweig. Auf
    // Spaltenposition 0 waere es wieder unbedingt.
    assert.notEqual(m[0], 'chown -R ',
      'Ein `chown -R` steht unbedingt am Zeilenanfang. Damit laeuft es bei ' +
      'JEDEM Start ueber alle Bilder — genau der Fehler, der fuenf Minuten ' +
      'Stille verursacht hat.');
  }
  // Die Suche haelt beim ERSTEN Treffer an: im Normalfall ein Durchlauf ohne
  // einen einzigen Schreibvorgang.
  assert.match(ep, /find \/app\/data ! -uid "\$ZIEL_UID" -print -quit/,
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

test('die angelegten Verzeichnisse gehoeren trotzdem immer dem Dienst', () => {
  // Sie entstehen als root. Ohne diesen Schritt koennte der Server nach
  // BRICKINV_CHOWN=never nichts hineinschreiben — die Ersparnis waere dann
  // ein kaputter Container.
  const flach = ep.slice(ep.indexOf('chown brickinv:brickinv'));
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
  const gesucht = ep.indexOf('find /app/data ! -uid');
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
