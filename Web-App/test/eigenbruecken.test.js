/**
 * Jeder Pfad, mit dem ein Test eine QUELLDATEI liest, muss auch dorthin zeigen.
 * Ausführlich: docs/begruendungen/test/eigenbruecken.test.js.md#kopf
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/** Zeilenweise Kommentarentfernung — siehe test/baumbruecken.test.js. */
function ohneKommentare(s) {
  const zeilen = [];
  let imBlock = false;
  for (const z of String(s).split('\n')) {
    const t = z.trim();
    if (imBlock) { zeilen.push(''); if (t.endsWith('*/')) imBlock = false; continue; }
    if (t.startsWith('/*')) { zeilen.push(''); if (!t.includes('*/')) imBlock = true; continue; }
    zeilen.push(t.startsWith('//') || t.startsWith('*') ? '' : z);
  }
  return zeilen.join('\n');
}

/** Endungen, die auf eine Quelldatei dieses Baums zeigen. */
const QUELLE = /\.(ts|js|sql|html|json|yml|xml)$/;

/**
 * Gibt es diese Datei — oder die Quelle, aus der sie gebaut wird?
 * Ausführlich: docs/begruendungen/test/eigenbruecken.test.js.md#existiertquelle
 */
function existiertQuelle(rel) {
  if (fs.existsSync(path.join(ROOT, rel))) return true;
  if (!rel.endsWith('.js')) return false;
  return fs.existsSync(path.join(ROOT, rel.replace(/\.js$/, '.ts')));
}

/** Ordner, die es im Web-Baum wirklich gibt — alles andere ist kein Pfad von hier. */
const ORDNER = ['routes', 'src', 'jobs', 'clients', 'db', 'startup', 'public', 'scripts', 'types'];

test('kein Test liest eine Quelldatei, die es nicht gibt', () => {
  const dateien = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort();
  assert.ok(dateien.length > 100, `Nur ${dateien.length} Testdateien gefunden — Ordner umbenannt?`);

  const kaputt = [];
  const offen = [];
  const abwesend = [];
  let geprueft = 0;

  /**
   * Steht der Pfad in einer ABWESENHEITS-Zusicherung?
   * Ausführlich: docs/begruendungen/test/eigenbruecken.test.js.md#istabwesenheitspruefung
   */
  const istAbwesenheitsPruefung = (src, bis) => /!\s*fs\.existsSync\($/.test(src.slice(0, bis).trimEnd());

  for (const datei of dateien) {
    const src = ohneKommentare(fs.readFileSync(path.join(__dirname, datei), 'utf8'));

    // ── Form 1: 'src/konto/auth.ts' als eine Zeichenkette ──────────────────────
    for (const m of src.matchAll(/['"]((?:[\w.-]+\/)+[\w.-]+)['"]/g)) {
      const p = m[1];
      if (!QUELLE.test(p)) continue;
      if (!ORDNER.includes(p.split('/')[0])) continue;
      geprueft++;
      if (!existiertQuelle(p)) kaputt.push(`${datei}: ${p}`);
    }

    // ── Form 2: path.join(ROOT, 'src/konto/auth.ts') ────────────────────────
    for (const m of src.matchAll(/path\.join\(\s*ROOT\s*,([^)]*)\)/g)) {
      const roh = m[1].split(',').map(s => s.trim()).filter(Boolean);
      const segmente = roh.map(s => /^['"]([^'"]*)['"]$/.exec(s)?.[1]);
      if (segmente.some(s => s === undefined)) {
        // Nicht aufloesbar — gemeldet, nicht uebergangen.
        offen.push(`${datei}: ${roh.find((s, i) => segmente[i] === undefined)}`);
        continue;
      }
      const p = segmente.join('/');
      if (!QUELLE.test(p)) continue;
      if (istAbwesenheitsPruefung(src, m.index)) { abwesend.push(`${datei}: ${p}`); continue; }
      geprueft++;
      if (!existiertQuelle(p)) kaputt.push(`${datei}: ${p}`);
    }
  }

  // Selbstbeweis: Findet die Suche nichts, waere die Zusicherung darunter
  // still gruen. GEMESSEN sind es ueber hundert.
  // GEMESSEN: 768. Die Schranke liegt bei der Haelfte — sie soll einen kaputten
  // Suchausdruck fangen, nicht bei jeder neuen Testdatei anschlagen.
  assert.ok(geprueft > 380,
    `Nur ${geprueft} Quellpfade gefunden (gemessen waren es 768) — die Muster sind ` +
    'veraltet, und diese Pruefung sieht damit fast nichts mehr an.');

  assert.deepEqual(kaputt, [],
    'Diese Testdateien lesen eine Quelldatei, die es nicht (mehr) gibt. Je nach ' +
    'Test heisst das ein Absturz — oder, schlimmer, eine Pruefung, die nichts ' +
    'mehr findet und deshalb schweigt.');

  // Zweite Schreibweise desselben Pfades ist erlaubt; ein VARIABLES Segment
  // nimmt der Pruefung aber die Sicht. Ein paar Faelle sind legitim (ein Test,
  // der eine Liste von Dateien durchgeht) — die Zahl darf nur nicht wachsen,
  // ohne dass es jemand merkt. …
  // Ausführlich: docs/begruendungen/test/eigenbruecken.test.js.md#stelle
  assert.ok(abwesend.length <= 3,
    `${abwesend.length} Abwesenheits-Zusicherungen (erlaubt: 3):\n  ` + abwesend.join('\n  '));

  // GEMESSEN: 62, und die Zahl ist nicht das Problem, das sie auf den ersten
  // Blick scheint. Fast alle sind SCHLEIFENVARIABLEN (`f`, `datei`, `rel`,
  // `ordner`) — Tests, die eine Liste von Dateien durchgehen. Das ist ein
  // gutes Muster; es auszuschreiben wuerde die Tests schlechter machen.
  // Ausführlich: docs/begruendungen/test/eigenbruecken.test.js.md#stelle-2
  assert.ok(offen.length <= 76,
    `${offen.length} Pfade mit variablem Segment (gemessen waren es 76):\n  ` +
    offen.join('\n  ') + '\nWo es geht, gehoert der Pfad ausgeschrieben — ein ' +
    'variables Segment nimmt dieser Pruefung die Sicht.');
});

/**
 * Wer die Bild-Warteschlange abarbeitet, leert sie vorher.
 * Ausführlich: docs/begruendungen/test/eigenbruecken.test.js.md#wer-die-bild-warteschlange-abarbeitet-le
 *
 * Gegenprobe (durchgefuehrt): den Aufruf aus image-throttle-db.test.js
 * entfernt → dieser Schritt wird rot und nennt die Datei.
 */
test('wer die Bild-Warteschlange abarbeitet, leert sie vorher', () => {
  const dir = __dirname;
  const BENUTZT = /_arbeiteStapel|_taktDurchgang/;
  const LEERT = /leereWarteschlange\s*\(/;

  const betroffen = [];
  const ohne = [];
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.test.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    // Kommentare raus: Die Erklaerbloecke dieser Dateien nennen die
    // Funktionsnamen im Fliesstext, sonst gilt eine Datei als betroffen,
    // weil sie ueber den Stapel SCHREIBT.
    const code = src.split('\n')
      .map(z => { const t = z.trim(); return (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) ? '' : z; })
      .join('\n');
    if (!BENUTZT.test(code)) continue;
    betroffen.push(f);
    if (!LEERT.test(code)) ohne.push(f);
  }

  // Selbstbeweis: Ohne Fund prueft die Zusicherung darunter nichts.
  assert.ok(betroffen.length >= 5,
    `Nur ${betroffen.length} Dateien arbeiten die Warteschlange ab — Muster veraltet? ` +
    'Ohne Fund besteht diese Pruefung stillschweigend.');

  assert.deepEqual(ohne, [],
    'Diese Testdateien arbeiten die Bild-Warteschlange ab, ohne sie vorher zu leeren:\n  ' +
    ohne.join('\n  ') +
    '\n\n_arbeiteStapel() nimmt die aeltesten Notizen der GANZEN Tabelle. Bleibt aus ' +
    'einer frueher gelaufenen Datei etwas liegen, arbeitet der Stapel DEREN Zeilen ab ' +
    'und der Test misst etwas anderes, als er glaubt — und zwar nur manchmal, je ' +
    'nachdem, was vorher lief. Abhilfe: `await leereWarteschlange(db)` nach dem ' +
    'Schema-Vorbau (helpers/bildwarteschlange.js).');
});
