/**
 * Zustands-Aggregat eines Sets.
 * Ausführlich: docs/begruendungen/test/set-condition-aggregate.test.js.md#kopf
 *
 * Aggregat, Zustand beim Anlegen und im Marktpreis: set-zustand-aggregat-db.test.js.
 *
 * Gegenprobe (08.11.2026): in 00-theme-boot.js apply() ohne ALLOWED-Prüfung →
 * rot „ein unbekannter Theme-Wert setzt nichts zurück“.
 * Gegenprobe (08.11.2026): in acqSave `applySetAggregate(d.set)` gestrichen
 * bzw. applySetAggregate ohne renderGallery() → rot „die Kachel übernimmt den
 * Zustand aus der Antwort des Servers“.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { pruefeParameter } = require('./helpers/sources');
const { oeffneOberflaeche, warte } = require('./helpers/oberflaeche');

test('die Aggregat-Regel steht nur noch an einer Stelle', () => {
  const h = require('./helpers/sources').handlerQuelle();
  assert.match(h, /function getSetConditionAggregate/, 'Der gemeinsame Helfer fehlt');
  // Weder getSets()/getSet() noch die manuellen Listen dürfen die Regel je
  // eigen ausformulieren — sie steht in conditionFromAcquisitions().
  // Zwei Parameter, nicht drei: Der dritte war der gespeicherte Zustand der
  // Stammzeile. Migration 0032 hat ihn den Sets genommen, 0035 den Teilen und
  // Minifiguren — es gibt keinen Rueckfall mehr, auf den er zeigen koennte.
  pruefeParameter(h, 'conditionFromAcquisitions', ['acqCount', 'usedCount'], 'der gemeinsame Regel-Helfer fehlt');
  // Kommentare ausblenden: Der Erklärtext am Helfer zitiert die Regel selbst.
  const code = h.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  // Der Anker nennt bewusst KEINEN Variablennamen: Er hiess frueher
  // `usedCount`, und als das Typisieren daraus ein normalisiertes `used`
  // machte, fand das alte Muster nichts mehr — der Test meldete 0 statt 1.
  // Gemeint ist die REGEL, nicht ihre Schreibweise. So gefasst faengt er …
  // Ausführlich: docs/begruendungen/test/set-condition-aggregate.test.js.md#inlinerules
  const inlineRules = [...code.matchAll(/\b\w+ > 0 \? 'U'/g)];
  assert.equal(
    inlineRules.length,
    1,
    `Die Regel steht ${inlineRules.length}× im Code — sie gehört genau einmal in conditionFromAcquisitions()`,
  );
});

test('ein unbekannter Theme-Wert setzt nichts zurück', () => {
  // Das war die Ursache des Flackerns beim Login: showApp() reicht
  // d.settings.app_theme weiter, und ein fehlender Wert schaltete auf 'classic'
  // — samt Cache-Vergiftung.
  const jsdom = require(path.join(ROOT, 'node_modules', 'jsdom'));
  const dom = new jsdom.JSDOM('<!doctype html><html data-theme="brick"><head></head><body></body></html>', {
    runScripts: 'outside-only',
    url: 'http://localhost/',
  });
  const w = dom.window;
  w.fetch = () => new Promise(() => {});
  w.eval(fs.readFileSync(path.join(ROOT, 'public', 'js', '00-theme-boot.js'), 'utf8'));
  for (const wert of [undefined, null, '', 'gibtsnicht']) {
    assert.equal(w.__bimApplyTheme(wert), null, `${wert} wurde als Design angenommen`);
    assert.equal(
      w.document.documentElement.getAttribute('data-theme'),
      'brick',
      `${wert} hat das Design zurückgesetzt`,
    );
    assert.equal(w.localStorage.getItem('bim_theme'), 'brick', `${wert} hat den Cache überschrieben`);
  }
  w.close();
});

test('ein manuell erfasstes Teil bekommt Marktpreis und Erfassung', () => {
  // Zwei Lücken: Der Marktpreis wurde ohne Zustand geholt (also der Neupreis,
  // auch bei „Gebraucht"), und es entstand gar keine Zeile in
  // part_acquisitions — der Kaufpreis stand nur in der Stammtabelle, während
  // Detailansicht und Zustandsregel mit den Erfassungen arbeiten. …
  // Ausführlich: docs/begruendungen/test/set-condition-aggregate.test.js.md#src-stelle
  const src =
    fs.readFileSync(path.join(ROOT, 'src/finanzen/marketPrice.ts'), 'utf8') +
    '\n' +
    fs.readFileSync(path.join(ROOT, 'src/teile/manuelleTeile.ts'), 'utf8');
  const fn = src.slice(src.indexOf('async function addManualPart'), src.indexOf('async function updateManualPart'));

  // Der Zustand muss in die Preisermittlung — sonst kommt der Neupreis, auch
  // bei „Gebraucht".
  // Ausführlich: docs/begruendungen/test/set-condition-aggregate.test.js.md#ohnezustand
  const ohneZustand = [...src.matchAll(/getCurrentPartMarketPrice\(([^)]*)\)/g)]
    .filter(m => !m[1].includes('function')) // die Definition selbst nicht
    .filter(m => m[1].split(',').length < 4);
  assert.equal(
    ohneZustand.length,
    0,
    'Diese Aufrufe holen den Marktpreis OHNE Zustand:\n  ' +
      ohneZustand.map(m => m[0]).join('\n  ') +
      '\nDann fällt die Ermittlung intern auf den Standardzustand zurück, und ein ' +
      'als gebraucht erfasstes Teil bekommt den Neupreis.',
  );
  // Selbstbeweis: Ohne Fundstellen sagt eine leere Liste nichts.
  const alleAufrufe = [...src.matchAll(/getCurrentPartMarketPrice\(/g)];
  assert.ok(
    alleAufrufe.length >= 4,
    `Nur ${alleAufrufe.length} Vorkommen von getCurrentPartMarketPrice( — Muster veraltet?`,
  );
  // Zwei Pfade: neu angelegt und erneut erfasst — BEIDE brauchen eine
  // Erfassung. Der zweite endete früher mit `return { action: 'updated' }`,
  // ohne eine anzulegen; ein abweichendes Erfassungsdatum ging dabei verloren.
  //
  // Geschrieben wird seit hardened-93 über recordAcquisitionForDay(), das die
  // Zeile des Tages im selben Zustand aufstockt statt eine zweite anzulegen.
  const writes = [...fn.matchAll(/recordAcquisitionForDay\('part', uid,/g)];
  assert.equal(
    writes.length,
    2,
    `${writes.length} statt 2 Erfassungs-Schreibvorgänge — Neuanlage und Zweiterfassung brauchen je einen`,
  );
  assert.match(fn, /createdAt: acquiredAt/, 'Das Erfassungsdatum muss übernommen werden');
  // Die Regel, nicht ihre Schreibweise
  // Ausführlich: docs/begruendungen/test/set-condition-aggregate.test.js.md#stelle
  assert.match(
    fn,
    /price: erfassungsPreis/,
    'Die Erfassung nimmt nicht den Preis, der ohne Marktpreis NULL ist ' +
      '(src/finanzen/preisRegel.ts, erfassungsPreis) — in der Erfassung hiesse eine 0 ' +
      '„für null Franken gekauft"',
  );
  const regel = fs.readFileSync(path.join(ROOT, 'src/finanzen/preisRegel.ts'), 'utf8');
  assert.match(
    regel,
    /erfassungsPreis:\s*kaufpreis > 0 \? kaufpreis : null/,
    'src/finanzen/preisRegel.ts wandelt die 0 der Stammzeile nicht mehr in NULL für die Erfassung',
  );
  assert.match(fn, /condition: effectiveCondition/, 'Die Erfassung braucht den Zustand');
});

test('der Minifiguren-Marktpreis fragt BrickLink auch ohne separate BL-Nummer', () => {
  // Der Abruf lief nur, wenn eine abweichende bl_fig_number hinterlegt war.
  // Bei manuell erfassten Figuren ist das die Ausnahme — meist stimmt die
  // eigene Nummer mit der BrickLink-Nummer überein. Der Abruf wurde
  // übersprungen, die Teile-Schätzung übernahm, und die liefert ohne
  // Teile-Zusammensetzung von Rebrickable nichts: gar kein Preis.
  const src = fs.readFileSync(path.join(ROOT, 'src/finanzen/marketPrice.ts'), 'utf8');
  // Der Abruf heisst seit einer früheren Runde figMarktpreisMitHerkunft: Er liefert
  // neben dem Preis den Zustand, aus dem dieser stammt. getCurrentFigMarketPrice
  // steht als duenne Huelle daneben und gibt nur die Zahl weiter — geprueft
  // wird hier der Abruf selbst, nicht die Huelle.
  const fn = src.slice(
    src.indexOf('async function figMarktpreisMitHerkunft'),
    src.indexOf('async function resolveManualFigPurchase'),
  );
  assert.ok(fn.length > 0, 'Der Minifiguren-Preisabruf ist nicht mehr zu finden');

  assert.match(fn, /for \(const num of \[blFigNumber, figNumber\]\)/, 'Beide Nummern müssen versucht werden');
  assert.doesNotMatch(
    fn,
    /if \(blFigNumber\) \{\s*const priceData/,
    'Der Abruf darf nicht mehr an einer separaten BL-Nummer hängen',
  );

  // Reihenfolge: BrickLink zuerst, Teile-Schätzung nur als Rückfall
  const iLoop = fn.indexOf('for (const num of');
  const iEst = fn.indexOf('schaetzeFigurenpreis');
  assert.ok(iLoop > 0 && iEst > iLoop, 'Die Teile-Schätzung gehört hinter den BrickLink-Abruf');

  // Und sie schätzt im ERMITTELTEN Zustand, nicht im Standardzustand: Ohne
  // BrickLink-Nummer ist die Schätzung der einzige Preis, den es gibt — lief
  // sie fest auf „Neu", bekam eine gebraucht erfasste Figur den Neupreis
  // ihrer Teile. Für Figuren MIT Nummer war der Zustand längst berücksichtigt;
  // genau der Fall ohne Nummer fiel durch.
  assert.match(
    fn,
    /schaetzeFigurenpreis\(figNumber, userId, effCond\)/,
    'Der ermittelte Zustand muss in die Schätzung',
  );

  const est = src.slice(
    src.indexOf('async function estimateFigPriceFromParts'),
    src.indexOf('async function getCurrentFigMarketPrice'),
  );
  assert.match(
    est,
    /fetchPartPrice\(blPartNum, p\.color_id \?\? KEINE_FARBE, cond,/,
    'Die Teilepreise müssen im übergebenen Zustand geholt werden',
  );
  assert.doesNotMatch(
    est.replace(/\/\/[^\n]*/g, ''),
    /fetchPartPrice\([^)]*DEFAULT_PRICE_CONDITION/,
    'Kein fester Standardzustand mehr in der Schätzung',
  );

  // Und die Bewertung ruft sie je Zustand auf — sonst zeigten zwei Zeilen mit
  // verschiedenen Zuständen denselben Marktpreis.
  const fc = require('./helpers/sources').finanzQuelle();
  // viewerId statt uid: Seit der Haushaltssicht sind „wessen Einstellungen"
  // und „wessen Daten" zwei Grössen. Die Schätzung braucht die EINSTELLUNGEN
  // (Währung) des fragenden Kontos — und weiterhin den Zustand.
  // Geschätzt wird im Auftrag preise_nachladen; die Bewertung merkt den Zustand vor.
  assert.match(
    fc,
    /art: 'schaetzung', nummer: key, zustand: cond/,
    'Die Minifiguren-Bewertung muss den Zustand mitgeben',
  );
});

test('die Teile-Schätzung landet in Cache und Verlauf', () => {
  // Gemeldet: Im Detail-Dialog einer Minifigur OHNE BrickLink-Nummer standen
  // bei Marktpreis (Neu) und (Gebraucht) nur Striche, der Verlauf blieb leer —
  // obwohl Kaufpreise in beiden Zuständen erfasst waren.
  // Ausführlich: docs/begruendungen/test/set-condition-aggregate.test.js.md#src-stelle-2
  const src =
    fs.readFileSync(path.join(ROOT, 'src/finanzen/marketPrice.ts'), 'utf8') +
    '\n' +
    fs.readFileSync(path.join(ROOT, 'src/figuren/manuelleFiguren.ts'), 'utf8');
  const est = src.slice(
    src.indexOf('async function estimateFigPriceFromParts'),
    src.indexOf('async function getCurrentFigMarketPrice'),
  );

  // Cache und Verlauf je Zustand prüft test/figurenschaetzung-ablage-db.test.js.
  // Nur mit echtem Preis: Ein Nullpunkt sähe im Diagramm aus wie ein Kurssturz.
  assert.match(est, /if \(priced === 0\) return null;/, 'Ohne bepreiste Teile darf nichts geschrieben werden');

  // Und beim Anlegen muss der ermittelte Preis in die Erfassung
  // created_at gehört seit der Datumsübernahme zur Spaltenliste.
  // Beide Wege (Neuanlage und Zweiterfassung), ohne Kommentare gelesen.
  const ohneKommentar = src.replace(/\/\/[^\n]*/g, '');
  const erfassungen = [
    ...ohneKommentar.matchAll(
      /recordAcquisitionForDay\('fig', uid, \[num\], \{\s*quantity,\s*price: (?:re\.)?erfassungsPreis/g,
    ),
  ];
  assert.equal(erfassungen.length, 2, 'Die Erfassung muss den tatsächlich verwendeten Kaufpreis tragen');
});

test('auch manuelle Minifiguren legen bei jeder Erfassung eine Zeile an', () => {
  // Gleicher früher Ausstieg wie bei den Teilen: `if (existing) { … return }`
  // beendete den Pfad, bevor eine Erfassung entstand. Menge stieg, aber kein
  // Kaufpreis und kein abweichendes Erfassungsdatum.
  const src = fs.readFileSync(path.join(ROOT, 'src/figuren/manuelleFiguren.ts'), 'utf8');
  const fn = src.slice(src.indexOf('async function addManualFig'), src.indexOf('async function addManualFig') + 6000);

  const writes = [...fn.matchAll(/recordAcquisitionForDay\('fig', uid, \[num\]/g)];
  assert.equal(
    writes.length,
    2,
    `${writes.length} statt 2 Erfassungs-Schreibvorgänge — Neuanlage und Zweiterfassung brauchen je einen`,
  );
  assert.match(fn, /createdAt: acquiredAt/, 'Das Erfassungsdatum muss übernommen werden');
  // Die Zweiterfassung muss den Preis über dieselbe Funktion ermitteln
  assert.match(
    fn,
    /const re = await resolveManualFigPurchase\(uid, \{/,
    'Die Zweiterfassung darf die Preislogik nicht neu ausformulieren',
  );
});

test('Erfassungen ohne Kaufpreis werden nachgetragen', () => {
  // Beim CSV-Import ist das Set oft noch nicht im Preis-Cache, und der
  // BrickLink-Abruf scheitert bei vielen Sets am Tageskontingent. Die Erfassung
  // entstand dann ohne Kaufpreis — der Marktpreis erschien später trotzdem,
  // sobald der Preis-Job den Cache füllte. Genau diese Abweichung war gemeldet.
  const job =
    fs.readFileSync(path.join(ROOT, 'src/bestand/kaufpreisNachtrag.ts'), 'utf8') +
    fs.readFileSync(path.join(ROOT, 'src/bestand/repository/nachtrag.ts'), 'utf8');

  assert.match(job, /async function backfillAcquisitions\(\)/, 'Nachtrag fehlt');
  // Unabhängig von der Set-Zeile: backfillSets() sieht nur Sets mit NULL-Preis
  assert.match(
    job,
    /FROM set_acquisitions\s+WHERE purchase_price IS NULL/,
    'Der Nachtrag muss alle preislosen Erfassungen finden',
  );
  // Der Zustand der ERFASSUNG bestimmt den Preis, nicht der des Sets
  assert.match(
    job,
    /getCurrentMarketPrice\(row\.set_number, row\.user_id, row\.condition \|\| null\)/,
    'Ein gebraucht erfasstes Exemplar braucht den Gebrauchtpreis',
  );
  // Hier stand eine Regel auf die Spiegelung
  // Ausführlich: docs/begruendungen/test/set-condition-aggregate.test.js.md#stelle-2
  assert.doesNotMatch(
    job.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, ''),
    /UPDATE sets SET/,
    'Der Nachtrag schreibt wieder in die sets-Zeile — dort gibt es seit ' +
      'Migration 0032 weder Kaufpreis noch Zustand',
  );
  assert.match(job, /await backfillAcquisitions\(\)/, 'Der Durchlauf ist nicht eingehängt');

  // Und der Import selbst soll seltener ohne Preis enden
  const sets = require('./helpers/sources').setKernQuelle();
  assert.match(
    sets,
    /FROM price_history[\s\S]{0,200}ORDER BY \(condition = \$3\) DESC, recorded_at DESC/,
    'Die Historie fehlt als letzter Rückfall beim Import',
  );
});

test('neue Sets holen den richtigen Zustand, nicht den Standard', () => {
  // Beim Anlegen eines neuen Sets existiert weder die sets- noch die
  // set_acquisitions-Zeile schon. conditionsNeededFor() fand daher nichts und
  // fiel auf 'N' zurück — ein als „Gebraucht" importiertes Set bekam den
  // Neupreis als Kaufpreis, weil die anschliessende Preisabfrage für 'U' noch …
  // Ausführlich: docs/begruendungen/test/set-condition-aggregate.test.js.md#job-stelle
  const job = fs.readFileSync(path.join(ROOT, 'src/finanzen/preisLauf.ts'), 'utf8');
  const { hatParameter } = require('./helpers/sources');
  assert.ok(hatParameter(job, 'conditionsNeededFor', 'hintCondition', true), 'Der Hinweis-Parameter fehlt');
  assert.match(
    job,
    /if \(hintCondition === 'U' \|\| hintCondition === 'N'\) eigene\.add\(hintCondition\);/,
    'Der Hinweis muss in die Liste der zu holenden Zustände einfliessen',
  );
  assert.ok(
    hatParameter(job, 'refreshPriceForSet', 'hintCondition', true),
    'refreshPriceForSet muss den Hinweis annehmen',
  );
  assert.match(
    job,
    /conditionsNeededFor\(setNumber, userId, hintCondition\)/,
    'refreshPriceForSet muss den Hinweis weiterreichen',
  );

  // Und getCurrentMarketPrice muss ihn beim Anlegen mitgeben — genau an der
  // Stelle, wo die Zeile noch nicht existiert.
  const preis = fs.readFileSync(path.join(ROOT, 'src/finanzen/marketPrice.ts'), 'utf8');
  assert.match(
    preis,
    /preisFuerSetHolen\(setNumber, userId, condition\)/,
    'getCurrentMarketPrice muss den angefragten Zustand als Hinweis übergeben',
  );
});

test('der Preisverlauf-Graph benutzt den Zustand DES SETS, nicht den globalen Standard', () => {
  // Gemeldet: Kaufpreis und Marktpreis stimmen überein (0.0% Entwicklung),
  // der Graph zeigt trotzdem einen Abfall am selben Tag. Ursache:
  // `const condition = DEFAULT_PRICE_CONDITION` — fest 'U', unabhängig vom
  // tatsächlichen Zustand des Sets. Für ein als „Neu" geführtes Set bevorzugte …
  // Ausführlich: docs/begruendungen/test/set-condition-aggregate.test.js.md#src-stelle-4
  const src = fs.readFileSync(path.join(ROOT, 'routes/api_v1/sets.ts'), 'utf8');
  const i = src.indexOf("router.get('/sets/:setNumber/price-history'");
  assert.ok(i > 0, 'Die Preisverlauf-Route ist nicht mehr auffindbar');
  const fn = src.slice(i, i + 1200);

  assert.doesNotMatch(
    fn,
    /const condition = DEFAULT_PRICE_CONDITION;/,
    'Der globale Standard darf nicht mehr direkt als Zustand des Sets gelten',
  );
  assert.match(
    fn,
    /getSetPriceHistory\(sichtVon\(req\), sn, currency\)/,
    'Die Route muss den gemeinsamen Helfer benutzen — mit Blickfeld',
  );
  assert.doesNotMatch(
    fn,
    /FROM price_history/,
    'Die Abfrage gehört in src/finanzen/priceHistory.ts, nicht in die Route',
  );

  const helper = fs.readFileSync(path.join(ROOT, 'src/finanzen/priceHistory.ts'), 'utf8');
  assert.match(
    helper,
    /const condition = await resolveSetCondition\(uids, setNumber\);/,
    'Der Helfer muss den Zustand über resolveSetCondition() auflösen',
  );
});

test('Android-API: Marktpreis benutzt den Zustand des Sets, nicht den globalen Standard', () => {
  // Gemeldet per Screenshot: Android zeigte Marktpreis 110.48 CHF (Gebraucht)
  // für ein als „Neu" geführtes Set mit Kaufpreis 162.42 CHF — „-32.0%
  // Entwicklung", obwohl sich der Preis nie bewegt hatte. Ursache identisch zur
  // Webapp-Route: `fetchPrice(sn, DEFAULT_PRICE_CONDITION, …)` — fest 'U'.
  const src = fs.readFileSync(path.join(ROOT, 'routes/api_v1/sets.ts'), 'utf8');
  // Die Route ruft setPreis() im Dienst; dort wird der Zustand aufgelöst.
  const dienst = fs.readFileSync(path.join(ROOT, 'src/sets/dienst.ts'), 'utf8');
  const priceRoute = dienst.slice(
    dienst.indexOf('export async function setPreis'),
    dienst.indexOf('export async function rebrickableListe'),
  );
  assert.ok(priceRoute.length > 0, 'setPreis() nicht gefunden');
  assert.doesNotMatch(
    priceRoute,
    /fetchPrice\(sn, DEFAULT_PRICE_CONDITION/,
    'Der globale Standard darf nicht mehr direkt an fetchPrice gehen',
  );
  // seit einer früheren Runde mit Blickfeld (uids aus scopeIds) — sonst 404 im Haushalt
  assert.match(
    priceRoute,
    /fetchPrice\(sn, await resolveSetCondition\(blickfeld, sn\), /,
    'Der Zustand muss über den gemeinsamen Helfer aufgelöst werden',
  );

  const historyRoute = src.slice(
    src.indexOf("router.get('/sets/:setNumber/price-history'"),
    src.indexOf("router.get('/sets/:setNumber'", src.indexOf('price-history')),
  );
  assert.doesNotMatch(
    historyRoute,
    /const condition = DEFAULT_PRICE_CONDITION;/,
    'Auch der Verlauf darf nicht mehr den globalen Standard nehmen',
  );
  // Seit der Zusammenführung teilt sich diese Route src/finanzen/priceHistory.ts mit
  // der Webapp — die rund fünfzig Zeilen, die dort standen, waren eine Kopie.
  assert.match(
    historyRoute,
    /getSetPriceHistory\(sichtVon\(req\), sn, currency\)/,
    'Der Verlauf muss den gemeinsamen Helfer benutzen',
  );
  assert.doesNotMatch(
    historyRoute,
    /FROM price_history/,
    'Die Abfrage gehört in src/finanzen/priceHistory.ts, nicht in die Route',
  );
});

test('genau EINE Zustandsauflösung für Einzelsets — resolveSetCondition', () => {
  // Fünfter Fundort desselben Fehlers in dieser Sitzung: computeSetsValuation,
  // getCurrentMarketPrice, computePnl, die Webapp-Verlaufsroute und jetzt die
  // Android-API hatten je eine eigene Fassung. Ab jetzt genau eine Funktion für
  // Aufrufer ohne bereits geladene acq_count/used_count-Felder.
  const fc = require('./helpers/sources').finanzQuelle();
  // Nimmt seit der Haushaltssicht auch eine Liste von Konten entgegen — der
  // Hauptaccount fragt den Zustand eines Sets ab, das einem Unterkonto gehört.
  pruefeParameter(fc, 'resolveSetCondition', ['uid', 'setNumber'], 'der gemeinsame Helfer fehlt');
  assert.match(fc, /export async function resolveSetCondition\(/, 'Der Helfer muss exportiert sein');

  // Beide Aufrufer müssen ihn tatsächlich importieren, nicht eine eigene
  // Abfrage danebenstellen.
  // Die Verlaufsrouten rufen ihn nur noch mittelbar auf — über
  // src/finanzen/priceHistory.ts, das sich Webapp und Android teilen.
  const helper = fs.readFileSync(path.join(ROOT, 'src/finanzen/priceHistory.ts'), 'utf8');
  // UMFORMULIERT in: Geprüft wurde die Importzeile WÖRTLICH.
  // Seit dem Fix für die BrickLink-Schlüssel holt priceHistory.ts aus derselben
  // Datei zwei weitere Namen — die Zeile lautet jetzt
  //     import { resolveSetCondition, resolveBlColorId, resolveBlPartNumber } … …
  // Ausführlich: docs/begruendungen/test/set-condition-aggregate.test.js.md#stelle-4
  assert.match(
    helper,
    /import \{[^}]*\bresolveSetCondition\b[^}]*\} from '\.\/financeCalc';/,
    'src/finanzen/priceHistory.ts muss den gemeinsamen Helfer benutzen',
  );

  // Die Preis-Route der Android-API löst weiterhin selbst auf (sie holt einen
  // Preis, keinen Verlauf) — genau ein Vorkommen.
  const apiV1 = fs.readFileSync(path.join(ROOT, 'src/sets/dienst.ts'), 'utf8');
  const uses = (apiV1.match(/resolveSetCondition\(blickfeld, sn\)/g) || []).length;
  assert.equal(uses, 1, 'Die /price-Route muss ihn benutzen; der Verlauf geht über priceHistory.ts');
});

// Die Datenbank-Sperre des Neuaufbaus prüft test/teile-zusammenfassung-sperre-db.test.js.

test('CDN-Anfragen erzwingen IPv4', () => {
  // Ohne IPv6-Route liefen Bildabrufe stumm bis zur Frist. Der Set-Bild-Download
  // beim Import geht über den gemeinsamen Abrufhelfer; dass der und der Pool
  // der Bild-CDNs IPv4 erzwingen, prüft der Test darunter am laufenden Code.
  // Ausführlich: docs/begruendungen/test/set-condition-aggregate.test.js.md#server
  const setsFile = fs.readFileSync(path.join(ROOT, 'src/katalog/bilder/setImages.ts'), 'utf8');
  assert.match(
    setsFile,
    /await hole(?:Https|Bild)\(url, \{/,
    'Der Hintergrund-Download beim Import muss ebenfalls IPv4 erzwingen — dieselbe Ursache, derselbe Ort',
  );
});

test('IPv4 wird an ALLEN ausgehenden HTTPS-Aufrufen erzwungen, nicht nur beim Bild-Proxy', async () => {
  // Der Server hat keine IPv6-Route; ohne family: 4 hängt jede ausgehende
  // Verbindung stumm bis zur Frist. abruf.ts ist der eine Weg nach draussen.
  // Ausführlich: docs/begruendungen/test/set-condition-aggregate.test.js.md#ohne
  // Gegenprobe (05.11.2026): family: 4 aus https.get in abruf.ts oder aus dem Pool gestrichen → rot.
  const _req = require('./helpers/sources').buildAndRequire();
  const { holeHttps } = _req('src/infra/abruf.js');
  const { oeffneBild } = _req('clients/bildCdn.js');
  const { mitschnitt } = require('./helpers/https-mitschnitt');
  const hosts = ['cdn.rebrickable.com'];
  const url = 'https://cdn.rebrickable.com/media/sets/1-1.jpg';
  const aufrufe = await mitschnitt(async () => {
    await holeHttps(url, { hosts, maxBytes: 1000, zeitlimitMs: 5000 }).catch(() => {});
    await holeHttps(url, { hosts, maxBytes: 1000, zeitlimitMs: 5000, methode: 'POST', rumpf: '{}' }).catch(() => {});
    await oeffneBild(url, { maxBytes: 1000, pool: true }).catch(() => {});
  });
  assert.deepEqual(
    aufrufe.map(a => [a.art, a.optionen.family]),
    [
      ['get', 4],
      ['request', 4],
      ['get', 4],
    ],
  );
  assert.equal(aufrufe[2].optionen.agent?.options?.family, 4, 'der Pool der Bild-CDNs erzwingt IPv4 nicht');
});

test('der Hintergrund-Job für Teile und Minifiguren erzeugt jetzt Vorschaubilder', () => {
  // Gemeldet: manuell erfasste Teile (und dasselbe Muster traf auch auf
  // Minifiguren zu) bekamen nie eine Vorschau. Ursache: Der stündliche
  // Hintergrund-Job lud das Bild herunter und aktualisierte image_local,
  // rief aber nie generateThumb() auf — anders als bei Sets (dieselbe …
  // Ausführlich: docs/begruendungen/test/set-condition-aggregate.test.js.md#src-stelle-5
  const src = require('./helpers/sources').serverAll();

  const partsLoop = src.slice(
    src.indexOf('for (const p of manualParts) {'),
    src.indexOf('for (const f of figsToFetch) {'),
  );
  // UMFORMULIERT in: Geprüft wurde der WORTLAUT der Zeile
  //     const { generateThumb } = require('./src/katalog/bilder/thumbs');
  // Beim Umbau der späten require() auf echte import-Anweisungen wurde daraus
  // ein Import am Dateikopf — die Prüfung wurde rot, ohne dass sich ihre …
  // Ausführlich: docs/begruendungen/test/set-condition-aggregate.test.js.md#stelle-5
  assert.match(src, /generateThumb/, 'generateThumb ist in server.ts nicht mehr verfügbar');
  assert.match(
    partsLoop,
    /generateThumb\(local\)\.catch\(logAndContinue\('[^']+'\)\);/,
    'Die Teile-Schleife muss generateThumb() nach einem erfolgreichen Download aufrufen',
  );

  const figsLoop = src.slice(
    src.indexOf('for (const f of figsToFetch) {'),
    src.lastIndexOf("await monitor.update('imgDl', { status: 'idle', sub: 'Alle Bilder gecacht'"),
  );
  assert.match(
    figsLoop,
    /generateThumb\(local\)\.catch\(logAndContinue\('[^']+'\)\);/,
    'Die Minifiguren-Schleife muss generateThumb() nach einem erfolgreichen Download aufrufen',
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// Welche Plaketten die Kachel zeigt (hardened-91)
// ═══════════════════════════════════════════════════════════════════════════
// utils/handlers.ts gibt es seit nicht mehr (aufgeteilt nach …
// Ausführlich: docs/begruendungen/test/set-condition-aggregate.test.js.md#stelle-6
const { buildAndRequire, handlerModul } = require('./helpers/sources');
const { conditionsFromAcquisitions, conditionFromAcquisitions } = handlerModul(buildAndRequire());

test('gemischte Erfassungen ergeben ZWEI Plaketten', () => {
  // Der gemeldete Fall: ein Exemplar neu, eines gebraucht. Bisher zeigte die
  // Kachel nur „Gebraucht" — die Neu-Erfassung war unsichtbar, obwohl sie mit
  // ihrem eigenen Preis in die Bewertung eingeht.
  assert.deepEqual(conditionsFromAcquisitions(2, 1), ['N', 'U']);
  // Und die Einzelangabe bleibt daneben, was sie war.
  assert.equal(conditionFromAcquisitions(2, 1), 'U');
});

test('nur ein Zustand ergibt eine Plakette', () => {
  assert.deepEqual(conditionsFromAcquisitions(3, 0), ['N'], 'alle Erfassungen neu → nur Neu');
  assert.deepEqual(conditionsFromAcquisitions(2, 2), ['U'], 'alle Erfassungen gebraucht → nur Gebraucht');
});

test('ohne Erfassungen gilt „Neu"', () => {
  // Hier stand „ohne Erfassungen zählt der gespeicherte Wert" mit einem
  // dritten Parameter. Den gibt es seit Migration 0035 nicht mehr: Fuer
  // manuelle Positionen traegt sie eine Erfassung nach und prueft danach
  // nach, dass keine ohne geblieben ist; fuer Teile und Figuren aus einem Set …
  // Ausführlich: docs/begruendungen/test/set-condition-aggregate.test.js.md#stelle-7
  assert.deepEqual(conditionsFromAcquisitions(0, 0), ['N']);
  assert.equal(conditionFromAcquisitions(0, 0), 'N');
});

test('die Reihenfolge ist fest: Neu vor Gebraucht', () => {
  // Nach Häufigkeit sortiert würden die Plaketten beim nächsten Kauf die
  // Plätze tauschen — auf einer Kachel, die man überfliegt, fällt genau das
  // als „hat sich was geändert?" auf.
  assert.deepEqual(conditionsFromAcquisitions(5, 4), ['N', 'U']);
  assert.deepEqual(conditionsFromAcquisitions(5, 1), ['N', 'U']);
});

test('die Kacheln rechnen die Plaketten nicht selbst aus', () => {
  const gal = fs.readFileSync(path.join(ROOT, 'public', 'js', '01-bausteine.js'), 'utf8');
  assert.match(gal, /export function condBadges/, 'Eine gemeinsame Fassung für Set-, Teile- und Minifiguren-Kacheln');
  // Vorher stand dieselbe Plakette viermal im Code, dreimal mit fest
  // eingetragenen Farben statt der CSS-Klassen. Geprüft wird genau das:
  // keine Zeile darf eine Zustands-Beschriftung UND eine eigene Farbe tragen.
  for (const f of ['public/js/03-parts.js', 'public/js/06-minifigs.js', 'public/js/04-finance.js']) {
    const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n');
    const inline = lines.filter(l => /common\.condition_(used|new)/.test(l) && /background:\s*var\(/.test(l));
    assert.equal(inline.length, 0, `${f}: Zustandsfarben gehören in die CSS-Klassen cond-new/cond-used`);
  }
});

test('der Kaufpreis auf der Kachel ist mengengewichtet, nicht das Maximum', () => {
  // MAX(purchase_price) zeigte bei 2x100 und 1x160 den Wert 160.
  const h = require('./helpers/sources').handlerQuelle();
  assert.match(h, /avg_purchase_price/, 'Der gewichtete Kaufpreis fehlt im Aggregat');
  const gal = fs.readFileSync(path.join(ROOT, 'public', 'js', '02-gallery.js'), 'utf8');
  assert.match(
    gal,
    /s\.avg_purchase_price \?\? s\.max_purchase_price/,
    'Die Kachel muss den gewichteten Wert bevorzugen',
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// Anmelden mit E-Mail (hardened-100)
// ═══════════════════════════════════════════════════════════════════════════
const authModul = buildAndRequire()('src/konto/auth.js');
const { isValidLoginIdentifier, USERNAME_RE, EMAIL_RE } = authModul;

test('der Anmeldename darf eine E-Mail-Adresse sein', () => {
  // Über dem Feld steht „Benutzername oder E-Mail", und die Abfrage sucht in
  // beiden Spalten — davor stand aber ein Wächter, der nur das
  // Benutzernamen-Muster zuliess. Das @ fiel durch, und die Meldung sprach von
  // erlaubten Zeichen im Benutzernamen.
  assert.ok(isValidLoginIdentifier('marco@example.com'));
  assert.ok(isValidLoginIdentifier('marco.meier+lego@sub.example.co.uk'));
  assert.ok(isValidLoginIdentifier('marco'), 'Benutzername muss weiterhin gehen');
  assert.ok(isValidLoginIdentifier('mar_co.1-x'));
});

test('offensichtlicher Unsinn kommt weiterhin nicht bis zur Abfrage', () => {
  // Der Wächter ist nicht überflüssig: Er hält Müll von der Abfrage und vom
  // Brute-Force-Zähler fern, der je IP und Anmeldename zählt.
  for (const bad of [
    '',
    'ab',
    'marco meier',
    'kein@at',
    '@example.com',
    'a'.repeat(300) + '@example.com',
    "' OR 1=1 --",
  ]) {
    assert.equal(isValidLoginIdentifier(bad), false, `\`${bad}\` sollte abgelehnt werden`);
  }
});

test('Registrieren und Profil bleiben beim Benutzernamen-Muster', () => {
  // Sonst könnte jemand die E-Mail-Adresse eines anderen als Benutzernamen
  // eintragen und dessen Anmeldung an sich ziehen — der Login sucht in beiden
  // Spalten.
  assert.equal(USERNAME_RE.test('marco@example.com'), false);
  assert.ok(EMAIL_RE.test('marco@example.com'));

  const src = require('./helpers/sources').anmeldeQuelle();
  const register = src.slice(src.indexOf("router.post('/register'"));
  assert.match(register, /USERNAME_RE\.test\(username\)/, 'Registrieren muss beim Benutzernamen-Muster bleiben');
  assert.doesNotMatch(
    register,
    /isValidLoginIdentifier/,
    'Beim Registrieren darf keine E-Mail als Benutzername durchgehen',
  );
});

test('beide Login-Wege prüfen gleich', () => {
  // Webapp und Android-API müssen dieselbe Regel haben — sonst funktioniert
  // die Anmeldung per E-Mail nur auf einem der beiden Wege.
  // Ausführlich: docs/begruendungen/test/set-condition-aggregate.test.js.md#zentral
  const zentral = fs.readFileSync(path.join(ROOT, 'src/konto/auth.ts'), 'utf8');
  const rumpf = zentral.slice(zentral.indexOf('async function pruefeAnmeldedaten'));
  assert.match(
    rumpf.slice(0, rumpf.indexOf('\n}\n')),
    /isValidLoginIdentifier\(username\)/,
    'pruefeAnmeldedaten() prüft die Form des Anmeldenamens nicht',
  );

  const dateien = dir =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? dateien(p) : e.name.endsWith('.ts') ? [p] : [];
    });
  const alle = [...dateien(path.join(ROOT, 'routes')), ...dateien(path.join(ROOT, 'src'))];
  assert.ok(alle.length >= 30, `nur ${alle.length} Dateien durchsucht — Pfade veraltet?`);

  const kopien = alle
    .filter(f => /\/\^\[A-Za-z0-9_\.-\]\{3,32\}\$\/\.test\(\s*username\s*\)/.test(fs.readFileSync(f, 'utf8')))
    .map(f => path.relative(ROOT, f));
  assert.deepEqual(kopien, [], `eigene Kopie des Benutzernamen-Musters statt USERNAME_RE: ${kopien.join(', ')}`);
});

test('die Kachel übernimmt den Zustand aus der Antwort des Servers', async () => {
  // Die Webapp rechnet die Regel nicht nach: Sie nimmt das Aggregat der PUT-Antwort. Die Liste der Galerie
  // antwortet danach absichtlich nicht mehr — die Kachel darf nur aus der Antwort auf die Änderung kommen.
  const SET = { set_number: '10294-1', name: 'Titanic', year: 2021, quantity: 1, conditions: ['N'], condition: 'N' };
  let listen = 0;
  const { w, d } = await oeffneOberflaeche({
    '/v1/sets': () => (++listen === 1 ? { success: true, total: 1, themes: [], sets: [SET] } : new Promise(() => {})),
    '/v1/sets/10294-1': { success: true, set: SET },
    '/v1/sets/10294-1/acquisitions': {
      success: true,
      acquisitions: [
        {
          id: 7,
          quantity: 1,
          purchase_price: 100,
          condition: 'N',
          currency: 'EUR',
          created_at: '2026-10-01T10:00:00Z',
          user_id: 1,
        },
      ],
      totals: { quantity: 1, amount: 100, currency: 'EUR' },
    },
    '/v1/sets/10294-1/acquisitions/7': {
      success: true,
      set: { set_number: '10294-1', conditions: ['U'], condition: 'U' },
    },
  });
  const plaketten = () => d.querySelector('#gallery .sc .splaketten')?.textContent ?? '';
  try {
    assert.ok(await warte(() => /Neu/.test(plaketten())), `vorher: ${plaketten()}`);
    d.querySelector('#gallery [data-click="openModal"]').click();
    assert.ok(await warte(() => d.querySelector('[data-click="openAcqModal"]')));
    d.querySelector('[data-click="openAcqModal"]').click();
    assert.ok(
      await warte(() => d.querySelector('select[data-change="acqSave"][data-arg3="cond"]')),
      'Keine Zustandswahl',
    );
    const wahl = d.querySelector('select[data-change="acqSave"][data-arg3="cond"]');
    wahl.value = 'U';
    wahl.dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.ok(await warte(() => /Gebraucht/.test(plaketten()) && !/Neu/.test(plaketten())), `nachher: ${plaketten()}`);
  } finally {
    w.close();
  }
});
