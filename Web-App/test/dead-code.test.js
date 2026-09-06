/**
 * Funktionen ohne Aufrufer.
 *
 * ── Warum es diesen Test braucht ────────────────────────────────────────────
 * In drei Durchgängen hintereinander war toter Code der Ausgangspunkt eines
 * echten Fehlers: Eine 90-zeilige Zweitfassung des Rebrickable-Teileabrufs
 * lief am Tageskontingent vorbei, `getSetByBarcode` lag unbenutzt daneben
 * während die Route einen Namen aufrief, den es nicht gab, und im CSV-Abgleich
 * standen zwei vollständige Zweitfassungen des Download-Wegs samt eigener
 * CSV-Zerlegung. Solche Fassungen altern unbemerkt mit: Sie bekommen keine
 * Korrekturen, keine Sperren, keine Kontingentprüfung — und irgendwann ruft
 * sie doch jemand auf.
 *
 * Der Test ist bewusst grob: Er zählt Vorkommen des Namens im ganzen
 * Serverbaum plus Tests. Wer eine Funktion exportiert, „benutzt" sie damit
 * (die Exportzeile zählt) — das ist die Grenze dieses Tests und der Preis
 * dafür, dass er keine falschen Alarme schlägt.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const { ROOT, ohneKommentare } = require('./helpers/sources');

/** Alle .ts-Quellen des Servers plus die Tests als Referenzkorpus. */
function dateien(unterordner, endung) {
  const out = [];
  (function walk(d) {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git', 'public'].includes(e.name)) continue;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name.endsWith(endung)) out.push(abs);
    }
  })(path.join(ROOT, unterordner));
  return out;
}

test('keine Funktion ohne einen einzigen Aufrufer', () => {
  const quellen = ['routes', 'utils', 'jobs', 'db'].flatMap(d => dateien(d, '.ts'))
    .concat([path.join(ROOT, 'server.ts')]);
  const korpus = quellen.concat(dateien('test', '.js'))
    .map(f => ohneKommentare(fs.readFileSync(f, 'utf8')))
    .join('\n');

  assert.ok(quellen.length > 20, `nur ${quellen.length} Quelldateien gefunden — die Prüfung liefe ins Leere`);

  const tot = [];
  let geprueft = 0;
  for (const datei of quellen) {
    const src = ohneKommentare(fs.readFileSync(datei, 'utf8'));
    for (const m of src.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) {
      const name = m[1];
      geprueft++;
      const treffer = (korpus.match(new RegExp(`\\b${name}\\b`, 'g')) || []).length;
      // 1 Treffer = nur die Deklaration selbst.
      if (treffer <= 1) tot.push(`${path.relative(ROOT, datei)}: ${name}`);
    }
  }

  assert.ok(geprueft > 100, `nur ${geprueft} Funktionen geprüft — das Muster greift nicht mehr`);
  assert.deepEqual(tot, [], `Funktionen ohne Aufrufer:\n  ${tot.join('\n  ')}`);
});

/**
 * Die zweite Haelfte: EXPORTIERTE Namen ohne Aufrufer.
 *
 * ── Warum es sie braucht ────────────────────────────────────────────────────
 * Der Test darueber benennt seine eigene Grenze: „Wer eine Funktion
 * exportiert, ‚benutzt' sie damit (die Exportzeile zaehlt)." Genau in dieser
 * Grenze wohnten sechs Namen — nachgemessen, nicht geschaetzt:
 *
 *   db/migrate.ts: listMigrations                     versprach im Kommentar
 *                                                     eine Admin-Oberflaeche,
 *                                                     die es nicht gibt
 *   jobs/partsCatalogEnrich.ts: activeDownloads       Diagnosezaehler, kein Leser
 *   utils/handlers/sets.ts: updateSetQuantity         ueberholte Zweitfassung
 *   utils/sseRegistry.ts: openSseCount                „fuer Diagnose und Tests",
 *                                                     kein Test benutzte sie
 *   utils/thumbs.ts: generateThumbsBackground         seit dem ersten Commit
 *                                                     nie aufgerufen
 *   utils/lockNamespaces.ts: TXLOCK_NAMENSRAUM_…      eine Anmerkung in Form
 *                                                     eines Wertes
 *
 * Der gefaehrlichste war updateSetQuantity: eine vollstaendige, GEPFLEGTE
 * Mengenaenderung (ihr Kommentar beschreibt einen darin behobenen Fehler), die
 * niemand aufruft — waehrend die lebende Route ueber updateSet() laeuft und
 * dabei bewusst „bei den eigenen Exemplaren deckelt, fremde lassen sich nicht
 * wegnehmen". Die tote Fassung haette fremde Exemplare blind ueberschrieben.
 * Genau davor warnt der Absatz ganz oben: Solche Fassungen altern unbemerkt
 * mit — und irgendwann ruft sie doch jemand auf.
 *
 * ── Was diese Pruefung anders macht ─────────────────────────────────────────
 * Sie zaehlt Vorkommen OHNE die Deklarations- und die Exportlisten-Zeile. Damit
 * sieht sie, was der Test darueber nicht sehen kann — und bleibt trotzdem grob
 * genug, um keine Fehlalarme zu schlagen: Wer einen Namen auch nur EINMAL
 * irgendwo sonst schreibt, faellt hier nicht auf.
 *
 * TYPEN sind ausgenommen. Ein exportiertes `interface` ohne externen Nutzer
 * kostet zur Laufzeit nichts und traegt Lesbarkeit; es zu streichen waere ein
 * Verlust ohne Gewinn.
 */
test('kein exportierter Wert ohne einen einzigen Aufrufer', () => {
  const quellen = ['routes', 'utils', 'jobs', 'db', 'clients', 'startup']
    .flatMap(d => dateien(d, '.ts')).concat([path.join(ROOT, 'server.ts')]);
  const mitTests = quellen.concat(dateien('test', '.js'));
  assert.ok(quellen.length > 20, `nur ${quellen.length} Quelldateien — die Pruefung liefe ins Leere`);

  const inhalt = new Map(mitTests.map(f => [f, ohneKommentare(fs.readFileSync(f, 'utf8'))]));

  // Je Schreibweise EIGENS gezaehlt — siehe den Selbstbeweis unten.
  const gefunden = { inline: 0, liste: 0 };

  /** Exportierte WERTE (keine Typen) einer Datei. */
  const exportierteWerte = (src) => {
    const namen = new Set();
    for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/gm)) {
      namen.add(m[1]); gefunden.inline++;
    }
    for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm))
      for (const roh of m[1].split(',')) {
        const n = roh.trim().split(' as ').pop().trim();
        // Grossgeschrieben und ohne Klammern: kann ein Typ sein — die
        // Unterscheidung ist hier nicht sicher moeglich, also im Zweifel
        // auslassen. Lieber ein Fund weniger als ein Fehlalarm.
        if (n && !/^[A-Z][A-Za-z]*$/.test(n)) { namen.add(n); gefunden.liste++; }
      }
    return namen;
  };

  /** Vorkommen in der eigenen Datei, ohne Deklaration und Exportliste. */
  const eigenNutzung = (src, name) => {
    let n = 0;
    let inExportListe = false;
    for (const z of src.split('\n')) {
      const t = z.trim();
      if (/^export\s*\{/.test(t)) { inExportListe = !t.includes('}'); continue; }
      if (inExportListe) { if (t.includes('}')) inExportListe = false; continue; }
      if (new RegExp(`^(export\\s+)?(async\\s+)?(function|const|class)\\s+${name}\\b`).test(t)) continue;
      n += (z.match(new RegExp(`\\b${name}\\b`, 'g')) || []).length;
    }
    return n;
  };

  const tot = [];
  let geprueft = 0;
  for (const datei of quellen) {
    const src = inhalt.get(datei);
    for (const name of exportierteWerte(src)) {
      geprueft++;
      const anderswo = [...inhalt].some(([f, t]) =>
        f !== datei && new RegExp(`\\b${name}\\b`).test(t));
      if (!anderswo && eigenNutzung(src, name) === 0)
        tot.push(`${path.relative(ROOT, datei)}: ${name}`);
    }
  }

  // ── Selbstbeweis, je Schreibweise EINZELN ────────────────────────────────
  //
  // Hier stand eine Summe ueber beide Muster. Die Gegenprobe hat sie
  // ueberlebt: Ich habe das erste Muster zerstoert, das zweite fand weiterhin
  // genug Namen, und die Schranke blieb erfuellt. Ein Selbstbeweis, der
  // Zahlen addiert, deckt das Sterben eines Summanden zu — genau die
  // Fehlerart, gegen die er gebaut ist.
  //
  // Beide Zahlen sind GEMESSEN; die Schranken liegen bei rund der Haelfte,
  // damit sie einen kaputten Ausdruck fangen und nicht jede neue Datei.
  assert.ok(gefunden.inline > 70,
    `Nur ${gefunden.inline} Exporte in der Form \`export function x\` gefunden ` +
    '(GEMESSEN: 139) — dieses Muster ist veraltet.');
  assert.ok(gefunden.liste > 125,
    `Nur ${gefunden.liste} Exporte in der Form \`export { x }\` gefunden ` +
    '(GEMESSEN: 252) — dieses Muster ist veraltet. Genau dieses fand upsert().');

  assert.deepEqual(tot, [],
    'Diese Namen werden exportiert und NIRGENDS aufgerufen — auch nicht in ihrer ' +
    'eigenen Datei. Entweder fehlt der Anschluss, oder die Fassung ist ueberholt; ' +
    'beides altert unbemerkt mit.');
});
