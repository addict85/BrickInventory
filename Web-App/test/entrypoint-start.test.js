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
