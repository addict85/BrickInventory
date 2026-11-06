/**
 * Erfassungsliste im Detail-Dialog manueller Teile und Minifiguren.
 * Ausführlich: docs/begruendungen/test/manual-acq-refresh.test.js.md#kopf
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const { pruefeParameter } = require('./helpers/sources');

const ROOT  = path.join(__dirname, '..');
const read  = f => require('./helpers/sources').dienstQuelle(f);
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
  for (const f of ['src/teile/manuelleTeile.ts', 'src/figuren/manuelleFiguren.ts']) {
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
  // Teile und Figuren kürzen über denselben Weg (src/bestand/manuelleMenge.ts).
  for (const f of ['src/teile/manuelleTeile.ts', 'src/figuren/manuelleFiguren.ts'])
    assert.match(read(f), /passeManuelleMengeAn\(/, `${f}: kürzt nicht über den gemeinsamen Weg`);
  assert.match(read('src/bestand/repository/manuelleMengen.ts'),
    /function erfassungenNeuesteZuerst[\s\S]*?ORDER BY created_at DESC, id DESC/,
    'ohne DESC würde beim Reduzieren die ÄLTESTE Erfassung zuerst abgebaut');
});

// ═══════════════════════════════════════════════════════════════════════════
// Pro Tag und Zustand EINE Erfassung (hardened-93)
// ═══════════════════════════════════════════════════════════════════════════
test('die Tagesregel steht an genau einer Stelle', () => {
  const acq = read('src/bestand/acquisitions.ts');
  // Schlüssel: Benutzer + Eintrag + Tag + ZUSTAND (seit dem 21.10.)
  // Ausführlich: docs/begruendungen/test/manual-acq-refresh.test.js.md#stelle
  assert.match(strip(acq), /WHERE[\s\S]{0,400}AND condition = \$/,
    'Der Zustand MUSS im Schlüssel stehen — sonst nimmt ein neuer Kauf einen ' +
    'gebrauchten vom selben Tag mit, samt Mischpreis aus zwei Käufen');
  // Verglichen wird der TAG — derselbe Ausdruck wie im Unique-Index
  // (erfassungsTagSql, Migration 0070), sonst greift ON CONFLICT nicht.
  assert.match(acq, /`\(\$\{erfassungsTagSql\(\)\}\)`, 'condition'/,
    'Verglichen wird der TAG, nicht der Zeitstempel');
  // Seit Migration 0047 gehören Preis, Herkunft und Währung zum Schlüssel: Zwei
  // verschiedene Käufe eines Tages bleiben zwei Zeilen statt eines Mischpreises.
  assert.doesNotMatch(strip(acq), /oldPrice \* oldQty/,
    'Kein gewichteter Mischpreis mehr');
  // …und ihren EIGENEN Zustand: Gefunden wird die Zeile genau über ihn, also
  // gibt es beim Aufstocken nichts mehr zu verschmelzen. Hier stand
  // `existing.condition === 'U' || cond === 'U'` — „gebraucht gewinnt" —, und
  // das war die Stelle, an der ein neuer Kauf einen gebrauchten mitnahm.
  // Ausführlich: docs/begruendungen/test/manual-acq-refresh.test.js.md#stelle-2
  assert.doesNotMatch(strip(acq), /existing\.condition === 'U' \|\| cond === 'U'/,
    'Der Zustand der Tageszeile darf sich beim Aufstocken nicht mehr ändern');

  // Und kein Anlege-Pfad schreibt mehr direkt in eine Erfassungstabelle.
  for (const f of ['src/teile/manuelleTeile.ts', 'src/figuren/manuelleFiguren.ts', 'routes/api_v1/sets.ts', 'src/sets/dienst.ts']) {
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
  // Seit steht die Kollisionsprüfung des BEARBEITEN-Pfads in der …
  // Ausführlich: docs/begruendungen/test/manual-acq-refresh.test.js.md#fab-stelle
  const fab = read('src/sammlung/erfassungen.ts');
  // Dies ist eine MUSTERregel: Sie faengt eine geloeschte Zeile. Dass der
  // Weg wirklich lebt, laeuft in test/verdrahtung-laeuft-db.test.js —
  // beides zusammen, nicht eines statt des anderen.
  assert.match(fab, /findSameDayAcquisition\(\s*art\s*,/,
    'src/sammlung/erfassungen.ts: die Kollisionsprüfung muss über den gemeinsamen Helfer laufen');
  for (const kind of ['set', 'part', 'fig']) {
    assert.match(fab, new RegExp(`\\b${kind}: \\{`),
      `Elementart '${kind}' fehlt in der Konfiguration — dann liefe ihre Tagesprüfung ins Leere`);
  }
  for (const f of ['routes/api_v1/sets.ts', 'src/teile/manuelleTeile.ts', 'src/figuren/manuelleFiguren.ts',
                   'routes/api_v1/acquisitions.ts', 'src/sammlung/erfassungen.ts']) {
    assert.doesNotMatch(strip(read(f)), /SELECT id FROM \w+_acquisitions WHERE[\s\S]{0,160}created_at[^\n]*::date/,
      `${f}: keine eigene Kopie der Tagesprüfung`);
  }

  // Und die Prüfung selbst geht auf den TAG, nicht auf den Zeitstempel.
  assert.match(read('src/bestand/acquisitions.ts'),
    /AND id <> \$\$\{n \+ 2\} AND \$\{erfassungsTagSql\(\)\} = \$\$\{n \+ 3\}::date/,
    'Verglichen wird der Tag (derselbe Ausdruck wie im Index)');
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
  const fc = require('./helpers/sources').finanzQuelle();
  // Drei: Sets, manuelle Teile, manuelle Minifiguren — alle drei Tabellen im
  // Finanzen-Reiter zeigen dieselbe Form.
  // Teile und Figuren teilen sich bewerteManuell(); zusammen mit bewerteSet() drei Wege.
  const acqLines = [...fc.matchAll(/acquisitions: rows,/g)];
  assert.equal(acqLines.length + (fc.match(/= bewerteManuell\(|\.\.\.bewerteManuell\(/g) || []).length - 1, 3,
    'Alle drei Bewertungen müssen die Einzelzeilen mitliefern');

  const fin = read('public/js/04-finance.js');
  pruefeParameter(fin, 'pmRows', ['it', 'label'],
    'ein Eintrag ergibt eine Zeile je Erfassung');
  assert.match(fin, /const acqs = it\.acquisitions \|\| \[\];/,
    'Ohne Erfassungen (Altbestand) bleibt es bei der einen Zeile');
});

test('die Regel gilt für alle drei Elementarten gleich', () => {
  // „Pro Tag, Element und Benutzer genau EIN Kaufpreis." Ein Element ist ein
  // Set, ein manuell erfasstes Teil oder eine manuell erfasste Minifigur —
  // dieselbe Regel, nur ein anderer Schlüssel.
  const acq = read('db/bestandsmenge.ts').split('ERFASSUNGS_TABELLEN = {')[1] ?? '';

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
  assert.match(fn, /await recordAcquisition\(userId, setNumber, delta, plan\.price, plan\.condition, dbh, !!plan\.geschaetzt, plan\.currency \?\? null\);/,
    'Auch die Erhöhung läuft über den gemeinsamen Schreibweg');
  // Der Preis kommt aus priceForNewAcquisition() — ausgelagert, weil der
  // BrickLink-Abruf darin VOR dem Advisory-Lock laufen muss (ein Netzaufruf
  // in offener Transaktion hielte Sperre und Verbindung).
  assert.match(fn, /pricePlan \?\? await priceForNewAcquisition\(userId, setNumber, dbh\)/,
    'Ein vorab ermittelter Preis muss durchgereicht werden können');
  // Ziel der Mengenänderung ist seit einer früheren Runde das EIGENE Konto (`uid`) und
  // nicht mehr der Besitzer irgendeiner Haushaltszeile: Angezeigt wird die
  // Gesamtmenge, geschrieben wird die Differenz auf das eigene Konto. Die
  // geprüfte REGEL ist unverändert: Preis ermitteln (Netzaufruf), DANN sperren.
  assert.match(src, /const plan = [\s\S]{0,80}await priceForNewAcquisition\(uid, sn\)[\s\S]{0,400}withInventoryLock\(uid, sn/,
    'In updateSet muss der Preis VOR der Sperre stehen');
  assert.doesNotMatch(src, /function isToday\(/,
    'Die eigene Tagesprüfung gehört entfernt');
});

test('eine Mengenänderung läuft unter der Bestandssperre', () => {
  // Woher dieser Test kommt
  // Ausführlich: docs/begruendungen/test/manual-acq-refresh.test.js.md#src-stelle
  const src = require('./helpers/sources').setKernQuelle();
  const fn = src.slice(src.indexOf('async function updateSet'),
                       src.indexOf("router.put('/:setNumber'"))
    // Kommentare weg: Der Erklärtext oben zitiert den alten Aufruf samt
    // .catch(() => {}) und würde die Prüfung sonst selbst auslösen.
    .replace(/\/\/[^\n]*/g, '');
  // Ziel ist seit einer früheren Runde das eigene Konto (`uid`) — die Regel bleibt:
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
  // Die Abfrage steht seit Migration 0036 in db/bestandsmenge.ts; hier …
  // Ausführlich: docs/begruendungen/test/manual-acq-refresh.test.js.md#stelle-3
  assert.match(fn, /repo\.setMenge\(dbh, 'blickfeld', leseFeld/,
    'Die Ausgangsmenge muss über das Blickfeld summiert werden');
});

test('das Löschen eines manuellen Eintrags räumt die Kaufpreise mit ab', () => {
  // Woher dieser Test kommt
  // Ausführlich: docs/begruendungen/test/manual-acq-refresh.test.js.md#stellen
  const stellen = [
    // Die beiden v1-Routen und „alles löschen" gehen über src/sammlung/loeschen.ts.
    ['src/sammlung/loeschen.ts',         'DELETE FROM part_acquisitions'],
    ['src/sammlung/loeschen.ts',         'DELETE FROM minifig_acquisitions'],
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
  // Woher dieser Test kommt
  // Ausführlich: docs/begruendungen/test/manual-acq-refresh.test.js.md#tabellen
  const TABELLEN = ['sets', 'parts', 'minifigs', 'set_acquisitions',
                    'part_acquisitions', 'minifig_acquisitions', 'instructions'];
  const schreibt = new RegExp(`\\b(UPDATE|INSERT INTO|DELETE FROM)\\s+(${TABELLEN.join('|')})\\b`);
  const dateien = ['routes/api_v1/sets.ts', 'src/sets/dienst.ts', 'src/sammlung/erfassungen.ts',
                   'src/teile/manuelleTeile.ts', 'src/figuren/manuelleFiguren.ts',
                   'routes/api_v1/sets.ts', 'routes/api_v1/parts.ts',
                   'routes/api_v1/minifigs.ts', 'routes/api_v1/acquisitions.ts',
                   'src/sets/setMove.ts', 'src/bestand/acquisitions.ts',
                   // Seit einer früheren Runde nach Domänen aufgeteilt.
                   'src/sets/abfragen.ts', 'src/teile/abfragen.ts', 'src/figuren/abfragen.ts'];
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
    'entweder durchreichen oder logAndContinue() aus src/infra/fehler.ts');
});
