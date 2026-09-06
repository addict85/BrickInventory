/**
 * Jeder Pfad, mit dem ein Test eine QUELLDATEI liest, muss auch dorthin zeigen.
 *
 * ── Woher das kommt ─────────────────────────────────────────────────────────
 * test/baumbruecken.test.js tut genau das fuer den ANDEREN Baum: Es loest alle
 * Pfade auf, mit denen Web-Tests in den Android-Baum greifen, und meldet jeden,
 * der ins Leere zeigt. Fuer den EIGENEN Baum gab es nichts dergleichen — und
 * das ist die haeufiger benutzte Richtung: 56 Testdateien lesen Quelltext.
 *
 * Aufgefallen beim Verschieben von routes/thumbs.ts nach utils/: Neun Nutzer
 * waren umgehaengt, die Suite trotzdem rot. Der Grund war test/thumbs-sharp.js
 * mit
 *
 *     path.join(ROOT, 'routes', 'thumbs.ts')
 *
 * — derselbe Pfad in einer anderen SCHREIBWEISE, den meine Ersetzung
 * ('routes/thumbs.ts') nicht traf. Dieselbe Sache zweimal geschrieben, und nur
 * eine davon nachgezogen: die Fehlerart, gegen die dieser Baum sonst ueberall
 * angeht.
 *
 * Ohne diese Pruefung faellt so etwas erst auf, wenn ein Test SEINETWEGEN rot
 * wird. Schlimmer ist der andere Ausgang: Liest ein Test eine Datei, die es
 * nicht mehr gibt, mit einem `catch` daneben oder ueber einen `indexOf`, der
 * -1 liefert, dann prueft er nichts mehr und schweigt.
 *
 * ── Was hier geprueft wird und was nicht ────────────────────────────────────
 * Erkannt werden zwei Formen:
 *   read('utils/auth.ts')            — eine Zeichenkette mit Ordner und Endung
 *   path.join(ROOT, 'utils', 'x.ts') — Segmente, alle als Literal
 * Pfade mit einem variablen Segment sind nicht aufloesbar; sie werden GEZAEHLT
 * und gemeldet, nicht uebergangen — eine Pruefung, die verschweigt, was sie
 * ausgelassen hat, ist die naechste Luecke.
 *
 * Ausfuehren: npm test
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
 *
 * ── Warum die zweite Frage noetig ist ───────────────────────────────────────
 * Die DB-Tests laden ihre Module ueber `_req('db/database.js')`. Das ist ein
 * Pfad in dist/, nicht in den Quellbaum: Die .js entsteht erst beim Bauen.
 * Der erste Entwurf dieser Pruefung hielt alle 319 solchen Pfade fuer kaputt.
 *
 * Gegen dist/ zu pruefen waere der naheliegende Ausweg und der schlechtere:
 * dist/ ist ein Bauartefakt, das je nach Zeitpunkt Altbestand enthaelt — genau
 * daran ist in Nachtrag 148 ein Test monatelang gruen geblieben, der eine
 * laengst geloeschte Datei las. Geprueft wird deshalb die QUELLE: Gibt es
 * db/database.ts, dann ist db/database.js ein gueltiger Ladepfad.
 */
function existiertQuelle(rel) {
  if (fs.existsSync(path.join(ROOT, rel))) return true;
  if (!rel.endsWith('.js')) return false;
  return fs.existsSync(path.join(ROOT, rel.replace(/\.js$/, '.ts')));
}

/** Ordner, die es im Web-Baum wirklich gibt — alles andere ist kein Pfad von hier. */
const ORDNER = ['routes', 'utils', 'jobs', 'clients', 'db', 'startup', 'public', 'scripts', 'types'];

test('kein Test liest eine Quelldatei, die es nicht gibt', () => {
  const dateien = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort();
  assert.ok(dateien.length > 100, `Nur ${dateien.length} Testdateien gefunden — Ordner umbenannt?`);

  const kaputt = [];
  const offen = [];
  const abwesend = [];
  let geprueft = 0;

  /**
   * Steht der Pfad in einer ABWESENHEITS-Zusicherung?
   *
   * test/img-proxy.test.js prueft mit `assert.ok(!fs.existsSync(...))`, dass
   * ein ausgebauter Job restlos weg ist. Dort ist die fehlende Datei genau das
   * Ergebnis, das der Test verlangt — sie als Bruch zu melden hiesse, einen
   * gesunden Test fuer krank zu erklaeren. Der erste Entwurf dieser Pruefung
   * tat genau das.
   */
  const istAbwesenheitsPruefung = (src, bis) => /!\s*fs\.existsSync\($/.test(src.slice(0, bis).trimEnd());

  for (const datei of dateien) {
    const src = ohneKommentare(fs.readFileSync(path.join(__dirname, datei), 'utf8'));

    // ── Form 1: 'utils/auth.ts' als eine Zeichenkette ──────────────────────
    for (const m of src.matchAll(/['"]((?:[\w.-]+\/)+[\w.-]+)['"]/g)) {
      const p = m[1];
      if (!QUELLE.test(p)) continue;
      if (!ORDNER.includes(p.split('/')[0])) continue;
      geprueft++;
      if (!existiertQuelle(p)) kaputt.push(`${datei}: ${p}`);
    }

    // ── Form 2: path.join(ROOT, 'utils', 'auth.ts') ────────────────────────
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
  // ohne dass es jemand merkt.
  // Erwartete Abwesenheiten sind kein Fehler, aber auch nicht beliebig viele:
  // Jede ist eine Behauptung ueber Code, den es NICHT gibt, und die veraltet
  // genauso. GEMESSEN ist es derzeit eine.
  assert.ok(abwesend.length <= 3,
    `${abwesend.length} Abwesenheits-Zusicherungen (erlaubt: 3):\n  ` + abwesend.join('\n  '));

  // GEMESSEN: 62, und die Zahl ist nicht das Problem, das sie auf den ersten
  // Blick scheint. Fast alle sind SCHLEIFENVARIABLEN (`f`, `datei`, `rel`,
  // `ordner`) — Tests, die eine Liste von Dateien durchgehen. Das ist ein
  // gutes Muster; es auszuschreiben wuerde die Tests schlechter machen.
  //
  // Hier stand zuerst 12: eine Zahl, die ich GERATEN und nicht gemessen habe.
  // Sie haette die Pruefung von Anfang an rot gehalten und damit unbrauchbar
  // gemacht. Die Schranke sitzt jetzt knapp ueber dem gemessenen Stand — sie
  // fragt „ist es MEHR geworden", nicht „ist es viel".
  assert.ok(offen.length <= 70,
    `${offen.length} Pfade mit variablem Segment (gemessen waren es 62):\n  ` +
    offen.join('\n  ') + '\nWo es geht, gehoert der Pfad ausgeschrieben — ein ' +
    'variables Segment nimmt dieser Pruefung die Sicht.');
});
