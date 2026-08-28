/**
 * Erfassungsliste im Detail-Dialog manueller Teile und Minifiguren.
 *
 * ── Zwei gemeldete Fehlerbilder, eine Ursache ───────────────────────────────
 *   1. Teil, Menge ERHÖHEN, noch keine Erfassung für heute → es erschien keine
 *      neue Zeile in der Detail-Ansicht.
 *   2. Minifigur, Menge REDUZIEREN → der heutige Kaufpreis-Eintrag verschwand
 *      nicht aus der Detail-Ansicht.
 *
 * Beide kamen aus `if (qty > prevQty)` in manQtySave(): Die Erfassungsliste
 * wurde nur beim Erhöhen nachgeladen — und `prevQty` war unzuverlässig, weil es
 * bei Teilen nur über part_number gesucht wurde (ohne color_id) und im
 * Fehlerfall auf den bereits gesetzten NEUEN Wert zurückfiel.
 *
 * Der Server war in beiden Fällen korrekt; falsch war nur die Anzeige.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT  = path.join(__dirname, '..');
const read  = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

test('die Erfassungsliste wird in BEIDE Richtungen nachgeladen', () => {
  const src = strip(require('./helpers/sources').adminQuelle());
  const fn  = src.slice(src.indexOf('async function manQtySave'),
                        src.indexOf('function openManAcqModal'));
  assert.ok(fn.length > 0, 'manQtySave nicht gefunden');

  assert.doesNotMatch(fn, /if\s*\(\s*qty\s*>\s*prevQty\s*\)/,
    'Beim Reduzieren bliebe der gelöschte Eintrag sonst sichtbar');
  assert.doesNotMatch(fn, /\bprevQty\b/,
    'prevQty war unzuverlässig (Teile-Suche ohne color_id) und wird nicht mehr gebraucht');
  assert.match(fn, /\/acquisitions`/,
    'Nach dem Speichern muss die Erfassungsliste neu geholt werden');
  assert.match(fn, /man-acq-summary/,
    'Das Ergebnis muss in die Zusammenfassung des Detail-Dialogs zurückgeschrieben werden');
});

test('eine Mengenerhöhung legt auch ohne bestehende Erfassung eine Zeile an', () => {
  // `delta > 0 && acqs.length > 0` liess Altbestände ohne Erfassungszeile
  // stumm liegen: Die Menge stieg, die Liste blieb leer.
  for (const f of ['routes/parts.ts', 'routes/minifigs.ts']) {
    const src = strip(read(f));
    assert.doesNotMatch(src, /delta > 0 && acqs\.length > 0/,
      `${f}: ohne bestehende Erfassung passiert beim Erhöhen nichts`);
    // Die Tagesprüfung stand hier von Hand (`newest && isToday_(…)`) und galt
    // nur an dieser einen Stelle. Sie liegt jetzt in
    // recordAcquisitionForDay(): Der Helfer stockt die heutige Zeile auf oder
    // legt eine neue an — beides ohne Sonderfall für „gar keine Erfassung".
    assert.match(src, /recordAcquisitionForDay\('(part|fig)', uid,/,
      `${f}: die Erhöhung muss über den gemeinsamen Helfer laufen`);
    assert.doesNotMatch(src, /isToday_\(/,
      `${f}: eigene Tagesprüfung — die Regel gehört an eine Stelle`);
  }
});

test('die LIFO-Reduktion entfernt die neueste Erfassung zuerst', () => {
  // Reihenfolge DESC ist die Voraussetzung dafür, dass beim Reduzieren der
  // HEUTIGE Eintrag zuerst schrumpft bzw. wegfällt.
  for (const [f, table] of [['routes/parts.ts', 'part_acquisitions'],
                            ['routes/minifigs.ts', 'minifig_acquisitions']]) {
    const src = read(f);
    assert.match(src, new RegExp(`FROM ${table} WHERE[^']*ORDER BY created_at DESC, id DESC`),
      `${f}: ohne DESC würde beim Reduzieren die ÄLTESTE Erfassung zuerst abgebaut`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Pro Tag und Zustand EINE Erfassung (hardened-93)
// ═══════════════════════════════════════════════════════════════════════════
test('die Tagesregel steht an genau einer Stelle', () => {
  const acq = read('utils/acquisitions.ts');
  // Schlüssel: Benutzer + Eintrag + Tag. AUSDRÜCKLICH OHNE Zustand — zwei
  // Erfassungen mit verschiedenen Zuständen am selben Tag sollen gar nicht
  // erst entstehen können. Die Datums-Endpunkte aller drei Arten weisen einen
  // zweiten Eintrag am selben Tag ebenfalls ohne Blick auf den Zustand ab.
  assert.doesNotMatch(strip(acq), /WHERE[\s\S]{0,200}COALESCE\(condition, 'N'\) = \$/,
    'Der Zustand darf NICHT im Schlüssel stehen');
  // Verglichen wird der TAG, nicht der Zeitstempel — und zwar in UTC.
  //
  // Die Prüfung verlangte wörtlich `created_at::date`. Seit die Regel als
  // Unique-Index in der Datenbank steht (db/migrations/0008), muss der
  // Ausdruck unveränderlich sein: `created_at::date` hängt an der Zeitzone der
  // Sitzung und ist nicht indizierbar, `(created_at AT TIME ZONE 'UTC')::date`
  // schon. Geprüft wird deshalb die Aussage, nicht die alte Schreibweise.
  assert.match(acq, /\(created_at AT TIME ZONE 'UTC'\)::date\s*\n?\s*=\s*COALESCE\(/,
    'Verglichen wird der TAG (in UTC), nicht der Zeitstempel');
  // Beim Zusammenfassen trägt die Zeile einen Preis — mengengewichtet.
  assert.match(acq, /\(oldPrice \* oldQty \+ price \* qty\) \/ \(newQty \|\| 1\)/,
    'Zwei Käufe am selben Tag ergeben den gewichteten Preis');
  // …und EINEN Zustand: gebraucht gewinnt, wie überall sonst im Projekt.
  assert.match(acq, /existing\.condition === 'U' \|\| cond === 'U'/,
    'Eine gebrauchte Erfassung macht die Tageszeile gebraucht');

  // Und kein Anlege-Pfad schreibt mehr direkt in eine Erfassungstabelle.
  for (const f of ['routes/parts.ts', 'routes/minifigs.ts', 'routes/sets.ts']) {
    const src = strip(read(f));
    assert.doesNotMatch(src, /INSERT INTO (part|minifig|set)_acquisitions/,
      `${f}: Erfassungen gehören über recordAcquisitionForDay geschrieben`);
  }
});

test('der Anlege-Pfad erzeugt keinen Zustand, den der Bearbeiten-Pfad ablehnt', () => {
  // Der Datums-Endpunkt weist einen zweiten Eintrag am selben Tag ab. Der
  // Anlege-Pfad legte ihn trotzdem an — zwei Regeln, die sich widersprachen.
  const sets = require('./helpers/sources').setKernQuelle();
  assert.match(sets, /recordAcquisitionForDay\('set', userId, \[setNumber\]/,
    'recordAcquisition muss über den gemeinsamen Helfer schreiben');
  // Alle drei Datums-Endpunkte benutzen denselben Prüfer — die Abfrage stand
  // vorher dreimal wortgleich in den Routen. Anlegen und Bearbeiten müssen
  // dieselbe Regel haben, sonst erzeugt der eine Pfad, was der andere ablehnt.
  // Seit Nachtrag 70 steht die Kollisionsprüfung des BEARBEITEN-Pfads in der
  // gemeinsamen Fabrik (sie bedient Webapp und App); das ANLEGEN liegt weiter
  // in den Session-Routen. Geprüft wird deshalb: Beide Orte rufen denselben
  // Helfer, und keiner hält eine eigene Kopie der Tagesregel.
  // Die Fabrik bedient alle drei Elementarten mit EINEM Aufruf und gibt die Art
  // aus der Konfiguration mit (cfg.kind) — deshalb steht hier kein wörtliches
  // findSameDayAcquisition('set', … mehr. Geprüft wird die Regel, nicht die
  // Schreibweise: Der gemeinsame Helfer wird gerufen, und jede Elementart ist
  // in der Konfiguration hinterlegt.
  const fab = read('routes/api_v1/acquisitions.ts');
  assert.match(fab, /findSameDayAcquisition\(\s*cfg\.kind\s*,/,
    'routes/api_v1/acquisitions.ts: die Kollisionsprüfung muss über den gemeinsamen Helfer laufen');
  for (const kind of ['set', 'part', 'fig']) {
    assert.match(fab, new RegExp(`kind:\\s*'${kind}'`),
      `Elementart '${kind}' fehlt in der Konfiguration — dann liefe ihre Tagesprüfung ins Leere`);
  }
  for (const f of ['routes/sets.ts', 'routes/parts.ts', 'routes/minifigs.ts',
                   'routes/api_v1/acquisitions.ts']) {
    assert.doesNotMatch(strip(read(f)), /SELECT id FROM \w+_acquisitions WHERE[\s\S]{0,160}created_at[^\n]*::date/,
      `${f}: keine eigene Kopie der Tagesprüfung`);
  }

  // Und die Prüfung selbst geht auf den TAG, nicht auf den Zeitstempel.
  assert.match(read('utils/acquisitions.ts'),
    /AND id <> \$\$\{n \+ 2\} AND \(created_at AT TIME ZONE 'UTC'\)::date = \$\$\{n \+ 3\}::date/,
    'Verglichen wird der Tag (in UTC, damit der Index greifen kann)');
});

test('der Altbestand wird einmalig auf eine Zeile je Tag zusammengefasst', () => {
  // Die neue Regel greift erst beim nächsten Schreiben — bereits bestehende
  // Doppelzeilen verschwinden nicht von selbst.
  const mig = read('db/migrations/0004-erfassung-pro-tag.sql');
  for (const t of ['set_acquisitions', 'part_acquisitions', 'minifig_acquisitions']) {
    assert.ok(mig.includes(`FROM ${t}`), `${t} fehlt im Zusammenfassen`);
  }
  assert.match(mig, /HAVING COUNT\(\*\) > 1/,
    'Nur echte Doppelzeilen anfassen');
  assert.match(mig, /FILTER \(WHERE purchase_price IS NOT NULL\)/,
    'Preislose Zeilen dürfen den Nenner nicht aufblähen');
  assert.match(mig, /CASE WHEN g\.gebraucht = 1 THEN 'U' ELSE 'N' END/,
    'Gebraucht gewinnt — wie im Schreibpfad');
  // Gruppiert wird je Eintrag UND Tag; Käufe an verschiedenen Tagen bleiben
  // getrennt, sie sind der Grund für die Erfassungshistorie.
  assert.match(mig, /GROUP BY user_id, set_number, created_at::date/);
});

test('Teile und Minifiguren stehen in den Finanzen je Kaufpreis in einer Zeile', () => {
  const fc = read('utils/financeCalc.ts');
  // Drei: Sets, manuelle Teile, manuelle Minifiguren — alle drei Tabellen im
  // Finanzen-Reiter zeigen dieselbe Form.
  const acqLines = [...fc.matchAll(/acquisitions: rows,/g)];
  assert.equal(acqLines.length, 3,
    'Alle drei Bewertungen müssen die Einzelzeilen mitliefern');

  const fin = read('public/js/04-finance.js');
  assert.match(fin, /function pmRows\(it, label\)/,
    'Ein Eintrag ergibt eine Zeile je Erfassung');
  assert.match(fin, /const acqs = it\.acquisitions \|\| \[\];/,
    'Ohne Erfassungen (Altbestand) bleibt es bei der einen Zeile');
});

test('die Regel gilt für alle drei Elementarten gleich', () => {
  // „Pro Tag, Element und Benutzer genau EIN Kaufpreis." Ein Element ist ein
  // Set, ein manuell erfasstes Teil oder eine manuell erfasste Minifigur —
  // dieselbe Regel, nur ein anderer Schlüssel.
  const acq = read('utils/acquisitions.ts');
  assert.match(acq, /Pro Tag, Element und Benutzer gibt es genau EINEN Kaufpreis/,
    'Die Regel gehört im Wortlaut an den Anfang der Datei');

  // Die Schlüssel je Art stehen an EINER Stelle — sonst hiesse „Element" je
  // nach Aufrufer etwas anderes.
  const lineFor = kind => acq.split('\n').find(l => l.trim().startsWith(kind + ':'));
  for (const [kind, key] of [['set', "keys: ['set_number']"],
                             ['part', "keys: ['part_number', 'color_id']"],
                             ['fig', "keys: ['fig_number']"]]) {
    const line = lineFor(kind);
    assert.ok(line && line.includes(key), `Schlüssel für ${kind} fehlt oder weicht ab: ${line}`);
  }
});

test('die Mengenerhöhung mittelt den Kaufpreis, statt ihn stehen zu lassen', () => {
  // Der frühere Zweig erhöhte bei einer heutigen Erfassung NUR die Menge. Ein
  // heute dazugekauftes Exemplar zum aktuellen Marktpreis verschwand damit im
  // alten Stückpreis — die Zeile zeigte zwei Stück zum Preis des ersten.
  const src = require('./helpers/sources').setKernQuelle();
  const fn = src.slice(src.indexOf('async function adjustAcquisitionsToQuantity'),
                       src.indexOf('async function addSet'));
  assert.doesNotMatch(fn, /UPDATE set_acquisitions SET quantity = quantity \+ \$1/,
    'Kein direktes Aufstocken mehr — das entscheidet recordAcquisitionForDay');
  assert.match(fn, /await recordAcquisition\(userId, setNumber, delta, plan\.price, plan\.condition, dbh\);/,
    'Auch die Erhöhung läuft über den gemeinsamen Schreibweg');
  // Der Preis kommt aus priceForNewAcquisition() — ausgelagert, weil der
  // BrickLink-Abruf darin VOR dem Advisory-Lock laufen muss (ein Netzaufruf
  // in offener Transaktion hielte Sperre und Verbindung).
  assert.match(fn, /pricePlan \?\? await priceForNewAcquisition\(userId, setNumber, dbh\)/,
    'Ein vorab ermittelter Preis muss durchgereicht werden können');
  // Ziel der Mengenänderung ist seit Nachtrag 85 das EIGENE Konto (`uid`) und
  // nicht mehr der Besitzer irgendeiner Haushaltszeile: Angezeigt wird die
  // Gesamtmenge, geschrieben wird die Differenz auf das eigene Konto. Die
  // geprüfte REGEL ist unverändert: Preis ermitteln (Netzaufruf), DANN sperren.
  assert.match(src, /const plan = await priceForNewAcquisition\(uid, sn\)[\s\S]{0,300}withInventoryLock\(uid, sn/,
    'In updateSet muss der Preis VOR der Sperre stehen');
  assert.doesNotMatch(src, /function isToday\(/,
    'Die eigene Tagesprüfung gehört entfernt');
});

test('eine Mengenänderung läuft unter der Bestandssperre', () => {
  // ── Woher dieser Test kommt ─────────────────────────────────────────────
  // updateSet() setzte sets.quantity und rief danach
  // adjustAcquisitionsToQuantity(…).catch(() => {}) — zwei lose Statements,
  // ohne Transaktion, ohne Sperre, mit verschlucktem Fehler. Scheiterte der
  // zweite Schritt, blieb die Menge erhöht, während die Erfassungen auf dem
  // alten Stand standen: genau der Drift, gegen den es utils/txLock.ts gibt,
  // nur ohne jede Logzeile. Alle anderen Schreibwege am Bestand
  // (Kaufpreis-Routen in sets/parts/minifigs, die v1-Fabrik) laufen längst
  // unter dem Advisory-Lock.
  const src = require('./helpers/sources').setKernQuelle();
  const fn = src.slice(src.indexOf('async function updateSet'),
                       src.indexOf("router.put('/:setNumber'"))
    // Kommentare weg: Der Erklärtext oben zitiert den alten Aufruf samt
    // .catch(() => {}) und würde die Prüfung sonst selbst auslösen.
    .replace(/\/\/[^\n]*/g, '');
  // Ziel ist seit Nachtrag 85 das eigene Konto (`uid`) — die Regel bleibt:
  // EINE gesperrte Transaktion für Menge und Erfassungen.
  assert.match(fn, /withInventoryLock\(uid, sn/,
    'Menge und Erfassungen gehören in EINE gesperrte Transaktion');
  assert.doesNotMatch(fn, /adjustAcquisitionsToQuantity\([^)]*\)\.catch\(/,
    'Ein verschluckter Fehler hinterlässt eine Menge ohne passende Erfassungen');
  assert.doesNotMatch(fn, /await db\.run\('UPDATE sets SET quantity/,
    'Die Mengenänderung darf nicht an der Transaktion vorbei laufen');
  // Und die Differenz muss aus der GESAMTMENGE des Blickfelds kommen, nicht
  // aus der Zeile eines einzelnen Kontos — sonst zeigte das Detail eine
  // Haushaltszahl an, während das „+" gegen eine andere rechnete.
  assert.match(fn, /SUM\(quantity\)[\s\S]{0,120}user_id = ANY/,
    'Die Ausgangsmenge muss über das Blickfeld summiert werden');
});

test('das Löschen eines manuellen Eintrags räumt die Kaufpreise mit ab', () => {
  // ── Woher dieser Test kommt ─────────────────────────────────────────────
  // Alle vier Löschrouten (Session und /api/v1, Teile und Minifiguren)
  // löschten die Erfassungshistorie mit `.catch(() => {})`. Verschluckt hiess:
  // Die Stammzeile ist weg, die Erfassungen bleiben — und Finanzsummen und
  // Portfoliokurve lesen die ERFASSUNGEN. Ein gelöschtes Teil hätte dort
  // dauerhaft weitergezählt, und zwar unsichtbar: Keine Ansicht zeigt
  // verwaiste Erfassungen, es fällt nur als „die Summe stimmt nicht" auf.
  const stellen = [
    ['routes/parts.ts',           'DELETE FROM part_acquisitions'],
    ['routes/minifigs.ts',        'DELETE FROM minifig_acquisitions'],
    ['routes/api_v1/parts.ts',    'DELETE FROM part_acquisitions'],
    ['routes/api_v1/minifigs.ts', 'DELETE FROM minifig_acquisitions'],
  ];
  for (const [datei, stmt] of stellen) {
    const src = strip(read(datei));
    const i = src.indexOf(stmt);
    assert.ok(i > 0, `${datei}: ${stmt} nicht gefunden`);
    // Bis zum Semikolon nach dem Statement darf kein leerer Catch stehen.
    const aufruf = src.slice(i, src.indexOf(';', i) + 1);
    assert.doesNotMatch(aufruf, /\.catch\(\(\)\s*=>\s*\{\}\)/,
      `${datei}: verwaiste Erfassungen zählen in den Finanzsummen weiter`);
  }
});

test('kein stiller Fehler mehr auf Bestandstabellen', () => {
  // ── Woher dieser Test kommt ─────────────────────────────────────────────
  // Ein leerer Catch sagt zwei Dinge gleichzeitig: „darf scheitern" und
  // „niemand erfährt davon". Das erste ist oft richtig, das zweite fast nie —
  // eine Spiegelung, die seit Wochen jedes Mal scheitert, sieht von aussen
  // identisch aus wie eine, die funktioniert.
  //
  // Für Schreibvorgänge auf den BESTANDSTABELLEN gilt deshalb: entweder den
  // Fehler durchreichen (Pflichtschritt) oder logAndContinue() aus
  // utils/httpError.ts (bewusst optionaler Schritt). Ein leerer Catch ist
  // keine der beiden Möglichkeiten. Anderswo — Bild-Caches, Aufräumen,
  // Fremd-APIs — bleibt er erlaubt; dieser Test greift nur die Tabellen ab,
  // aus denen Bestand und Finanzsummen gelesen werden.
  const TABELLEN = ['sets', 'parts', 'minifigs', 'set_acquisitions',
                    'part_acquisitions', 'minifig_acquisitions', 'instructions'];
  const schreibt = new RegExp(`\\b(UPDATE|INSERT INTO|DELETE FROM)\\s+(${TABELLEN.join('|')})\\b`);
  const dateien = ['routes/sets.ts', 'routes/parts.ts', 'routes/minifigs.ts',
                   'routes/api_v1/sets.ts', 'routes/api_v1/parts.ts',
                   'routes/api_v1/minifigs.ts', 'routes/api_v1/acquisitions.ts',
                   'utils/setMove.ts', 'utils/acquisitions.ts',
                   // Seit Nachtrag 133 nach Domänen aufgeteilt.
                   'utils/handlers/sets.ts', 'utils/handlers/parts.ts', 'utils/handlers/minifigs.ts'];
  const fundstellen = [];
  for (const datei of dateien) {
    const zeilen = strip(read(datei)).split('\n');
    zeilen.forEach((zeile, i) => {
      if (!/\.catch\(\(\)\s*=>\s*\{\}\)/.test(zeile)) return;
      // Das Statement steht oft ein paar Zeilen über dem Catch (mehrzeilige
      // Aufrufe) — deshalb der Blick nach oben.
      const umfeld = zeilen.slice(Math.max(0, i - 4), i + 1).join('\n');
      if (schreibt.test(umfeld)) fundstellen.push(`${datei}:${i + 1}`);
    });
  }
  assert.deepEqual(fundstellen, [],
    `Stiller Fehler auf einer Bestandstabelle: ${fundstellen.join(', ')} — ` +
    'entweder durchreichen oder logAndContinue() aus utils/httpError.ts');
});
