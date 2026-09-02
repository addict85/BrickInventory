/**
 * Zustands-Aggregat eines Sets.
 *
 * Fehlerbild: Ändert man im Kaufpreis-Dialog den Zustand von "neu" auf
 * "gebraucht" und verlässt den Dialog, zeigt die Galerie-Kachel weiter "neu" —
 * erst ein Neuladen der Liste korrigiert es. Ursache waren zwei Dinge:
 *
 *   1. Die Android-App aktualisierte nach dem Schreiben nur _setDetailState,
 *      nie die Liste in _state.sets.
 *   2. Die Webapp hatte zwar eine lokale Aktualisierung, benutzte aber die
 *      falsche Regel: sie nahm die Bedingung der ZULETZT erfassten Position.
 *      Der Server sagt dagegen "sobald EINE Erfassung U ist, gilt das Set als
 *      gebraucht". Bei der Reihenfolge [U, N] widersprachen sich beide.
 *
 * Die Regel liegt jetzt einmal in utils/handlers.ts und wird von den
 * Schreib-Endpunkten mitgeliefert. Dieser Test hält sie fest und stellt sicher,
 * dass die Clients sie nicht wieder nachbauen.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { ohneKommentare } = require('./helpers/sources');
const { pruefeParameter } = require('./helpers/sources');

test('die Aggregat-Regel steht nur noch an einer Stelle', () => {
  const h = require('./helpers/sources').handlerQuelle();
  assert.match(h, /function getSetConditionAggregate/,
    'Der gemeinsame Helfer fehlt');
  // Weder getSets()/getSet() noch die manuellen Listen dürfen die Regel je
  // eigen ausformulieren — sie steht in conditionFromAcquisitions().
  pruefeParameter(h, 'conditionFromAcquisitions', ['acqCount', 'usedCount', 'stored'],
    'der gemeinsame Regel-Helfer fehlt');
  // Kommentare ausblenden: Der Erklärtext am Helfer zitiert die Regel selbst.
  const code = h.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  // Der Anker nennt bewusst KEINEN Variablennamen: Er hiess frueher
  // `usedCount`, und als das Typisieren daraus ein normalisiertes `used`
  // machte, fand das alte Muster nichts mehr — der Test meldete 0 statt 1.
  // Gemeint ist die REGEL, nicht ihre Schreibweise. So gefasst faengt er
  // ausserdem eine Ausformulierung unter anderem Namen, die er vorher
  // durchgelassen haette.
  const inlineRules = [...code.matchAll(/\b\w+ > 0 \? 'U'/g)];
  assert.equal(inlineRules.length, 1,
    `Die Regel steht ${inlineRules.length}× im Code — sie gehört genau einmal in conditionFromAcquisitions()`);
});

test('getSet liefert dieselben Aggregatfelder wie getSets', () => {
  const h = require('./helpers/sources').handlerQuelle();
  const agg = h.slice(h.indexOf('function getSetConditionAggregate'), h.indexOf('async function getSet(userId'));
  for (const field of ['condition', 'acq_count', 'used_count', 'max_purchase_price']) {
    assert.match(agg, new RegExp(`${field}:`),
      `${field} fehlt im Aggregat — sonst verliert ein Client diese Werte, wenn er die Kachel aus dem Detail-Objekt aktualisiert`);
  }
});

test('BEIDE Routenfamilien liefern das Aggregat mit', () => {
  // Genau hier lag der zweite Anlauf: Der Wrapper existierte zuerst nur in der
  // v1-Datei, die Webapp benutzt aber ihren eigenen Handler in routes/sets.ts
  // — und bekam deshalb kein `set` in der Antwort.
  const v1  = fs.readFileSync(path.join(ROOT, 'routes', 'api_v1', 'acquisitions.ts'), 'utf8');
  const web = require('./helpers/sources').setKernQuelle();
  const h   = require('./helpers/sources').handlerQuelle();

  assert.match(h, /async function withSetAggregate/,
    'Der Wrapper gehört in utils/handlers.ts, damit ihn beide Routenfamilien teilen');

  assert.equal([...v1.matchAll(/res\.json\(await withSetAggregate\(/g)].length, 2,
    'v1: PUT und DELETE müssen beide das Aggregat zurückgeben');
  // Die Webapp-Erfassungsrouten sind mit Nachtrag 70 entfallen — sie leben in
  // der v1-Fabrik, die jetzt beide Clients bedient. Geprüft wird deshalb die
  // Gegenrichtung: In routes/sets.ts darf KEINE Zweitfassung zurückkehren.
  // Die Aussage („jede Antwort trägt das Aggregat") gilt unverändert, sie hat
  // nur noch einen Ort statt zwei.
  assert.ok(!/router\.(put|delete)\('\/:sn\/acquisitions/.test(web),
    'routes/sets.ts hat wieder eigene Erfassungs-Routen — das Aggregat und alle ' +
    'übrigen Regeln würden dann erneut doppelt gepflegt');

  assert.match(v1, /cfgTable !== 'set_acquisitions'/,
    'Nur Set-Erfassungen haben ein Set-Aggregat — Teile und Minifiguren nicht');
});

test('ein unbekannter Theme-Wert setzt nichts zurück', () => {
  // Das war die Ursache des Flackerns beim Login: showApp() ruft
  // applyTheme(d.settings.app_theme) auf, und ein fehlender Wert schaltete die
  // Seite sichtbar auf 'classic' — inklusive Cache-Vergiftung.
  const boot = fs.readFileSync(path.join(ROOT, 'public', 'js', '00-theme-boot.js'), 'utf8');
  const core = require('./helpers/sources').coreQuelle();

  assert.doesNotMatch(boot, /:\s*'classic';/,
    "00-theme-boot.js darf bei unbekanntem Wert nicht auf 'classic' zurückfallen");
  assert.match(boot, /if \(!val\) return null;/,
    'Ein ungültiger Wert darf den localStorage-Cache nicht überschreiben');

  const fn = core.slice(core.indexOf('function applyTheme'), core.indexOf('function applyTheme') + 500);
  assert.match(fn, /theme !== 'brick' && theme !== 'classic'/,
    "applyTheme() muss unbekannte Werte ignorieren statt auf 'classic' zu setzen");
});

test('die Webapp rechnet die Regel nicht mehr selbst nach', () => {
  const admin = require('./helpers/sources').adminQuelle();
  assert.doesNotMatch(admin, /latestCond/,
    'Die Bedingung der zuletzt erfassten Position ist nicht die Regel des Servers');
  assert.match(admin, /applySetAggregate\(d\.set\)/,
    'Die PUT-Antwort muss in die Galerie-Liste übernommen werden');

  const gallery = fs.readFileSync(path.join(ROOT, 'public', 'js', '02-gallery.js'), 'utf8');
  assert.match(gallery, /function applySetAggregate/,
    'Der Helfer gehört dorthin, wo allSets lebt');
  assert.match(gallery, /renderGallery\(\)/,
    'Ohne Neuzeichnen bleibt die Kachel trotz aktualisierter Daten stehen');
});

test('der im Formular gewählte Zustand kommt beim Anlegen an', () => {
  // addSet() nimmt den Zustand als sechsten Parameter. Beide Webapp-Routen
  // haben ihn nicht weitergereicht: /api/sets las ihn gar nicht aus dem Body,
  // /api/sets/add-stream las ihn und benutzte ihn nie. Ein als „Gebraucht"
  // erfasstes Set landete dadurch als „Neu" in der Datenbank — die
  // Android-API übergab ihn korrekt, die Webapp nicht.
  // Seit Nachtrag 74 liegt der Anlege-Weg der Clients in der v1-Fabrik, während
  // add-stream und der CSV-Import weiter in routes/sets.ts stehen. Die Regel
  // („jeder addSet-Aufruf reicht den Zustand durch") gilt für ALLE Aufrufer —
  // deshalb werden beide Dateien zusammen betrachtet.
  const raw = require('./helpers/sources').setKernQuelle()
    + '\n' + fs.readFileSync(path.join(ROOT, 'routes', 'api_v1', 'sets.ts'), 'utf8');
  // Kommentare entfernen: Der Erklärtext nennt addSet() selbst.
  const src = raw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

  // Auf die Parameter geprüft, nicht auf den Wortlaut des Kopfes: Typannotationen
  // sagen über die Zusicherung nichts (siehe funktionsKopf() im Helfer).
  const { funktionsKopf } = require('./helpers/sources');
  const addSetKopf = funktionsKopf(src, 'addSet');
  for (const p of ['setNumber', 'quantity', 'userId', 'sendProgress', 'purchasePrice', 'condition']) {
    assert.match(addSetKopf, new RegExp(`\\b${p}\\b`),
      `addSet nimmt '${p}' nicht mehr entgegen: ${addSetKopf}`);
  }
  assert.match(addSetKopf, /condition[^,)]*=\s*null/,
    `Der Zustand muss die Vorgabe null behalten: ${addSetKopf}`);

  // Jeder addSet-Aufruf muss sechs Argumente übergeben. Klammerbewusst zählen:
  // Ein Aufruf enthält eine Pfeilfunktion mit eigenen Kommas und Semikolons.
  const calls = [];
  for (let i = src.indexOf('addSet('); i !== -1; i = src.indexOf('addSet(', i + 1)) {
    if (/[\w.]/.test(src[i - 1] || '')) continue;            // function addSet(...)
    let depth = 0, top = 1, j = i + 'addSet('.length - 1;
    for (; j < src.length; j++) {
      const c = src[j];
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) { depth--; if (depth === 0) break; }
      else if (c === ',' && depth === 1) top++;
    }
    calls.push({ args: top, text: src.slice(i, Math.min(j + 1, i + 100)) });
  }
  assert.ok(calls.length >= 3, `Nur ${calls.length} addSet-Aufrufe gefunden`);
  for (const c of calls) {
    assert.ok(c.args >= 6,
      `addSet-Aufruf mit nur ${c.args} Argumenten — der Zustand fehlt: ${c.text.slice(0, 80)}`);
  }

  // Und der Body muss ihn überhaupt hergeben. Seit der Haushaltssicht steht
  // dahinter noch owner_user_id (Kontoauswahl beim Erfassen) — geprüft wird
  // deshalb der Anfang der Zerlegung, nicht die vollständige Zeile.
  assert.match(src, /const \{ set_number, quantity=1, purchase_price, condition[,}]/,
    'POST /api/sets liest den Zustand nicht aus dem Body');
});

test('der Marktpreis als Kaufpreis richtet sich nach dem gewählten Zustand', () => {
  // Gemeldet: Set als „Gebraucht" erfasst, Marktpreis gebraucht 33 CHF, neu
  // 55 CHF — eingetragen wurden 55. getCurrentMarketPrice() nimmt den Zustand
  // als dritten Parameter; ohne ihn fällt es auf den Standardzustand des
  // Nutzers zurück, also in aller Regel „Neu".
  const raw = require('./helpers/sources').setKernQuelle();
  const src = raw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

  for (const m of src.matchAll(/getCurrentMarketPrice\(([^)]*)\)/g)) {
    const args = m[1].split(',').length;
    assert.ok(args >= 3,
      `getCurrentMarketPrice mit nur ${args} Argumenten — der Zustand fehlt: ${m[0]}`);
  }

  // Der Zustand muss VOR JEDER Preisermittlung feststehen.
  //
  // Diese Prüfung suchte bis zuletzt die Zeichenfolge
  // `const effectiveCondition = condition ||` — also die FORMULIERUNG einer
  // bestimmten Fassung. Sie brach, als die Staffelung nach utils/settings.ts
  // wanderte und `addSet()` den Zustand einmal oben für beide Zweige bestimmt.
  // Die Regel war dabei nicht verletzt, im Gegenteil: Sie wird jetzt früher
  // erfüllt als vorher.
  //
  // Geprüft wird deshalb die Reihenfolge selbst: Wo auch immer der Zustand
  // bestimmt wird, es muss vor dem ERSTEN Preisabruf geschehen.
  // GEMESSEN WIRD IN addSet(), nicht über den ganzen Quelltext.
  //
  // setKernQuelle() verkettet vier Dateien, und setService.ts enthält weitere
  // Preisabrufe in anderen Funktionen — der erste steht in
  // priceForNewAcquisition() und hat mit dieser Regel nichts zu tun. Ein
  // indexOf über alles vergleicht Positionen quer durch fremde Funktionen und
  // misst damit nichts. (Genau so ist der erste Entwurf dieser Fassung
  // fehlgeschlagen.)
  const fnStart = src.indexOf('async function addSet(');
  assert.ok(fnStart > 0, 'addSet() ist nicht mehr zu finden');
  const fnEnde = src.indexOf('\nasync function ', fnStart + 10);
  const addSetSrc = src.slice(fnStart, fnEnde > fnStart ? fnEnde : undefined);

  const iCond = addSetSrc.indexOf('zustandFuerPreis(');
  const iPrice = addSetSrc.indexOf('getCurrentMarketPrice(');
  assert.ok(iCond >= 0,
    'addSet() bestimmt den Zustand nicht mehr über zustandFuerPreis() — steht ' +
    'die Staffelung wieder ausgeschrieben da, womöglich zweimal?');
  assert.ok(iPrice >= 0, 'addSet() ruft keinen Marktpreis mehr ab — Muster veraltet?');
  assert.ok(iCond < iPrice,
    'Der Zustand wird erst NACH dem ersten Preisabruf bestimmt. Dann holt der ' +
    'Abruf den Preis für den falschen Zustand — genau der gemeldete Fall ' +
    '(55 statt 33 CHF).');

  // Beim Ändern zählt der Zustand der letzten Erfassung — die wird aktualisiert
  assert.match(src, /SELECT condition FROM set_acquisitions[\s\S]{0,140}ORDER BY created_at DESC, id DESC LIMIT 1/,
    'Der Update-Pfad muss den Zustand der letzten Erfassung heranziehen');
});

test('ein ausdrücklich angefragter Zustand schlägt die Erfassungs-Bewertung', () => {
  // Der eigentliche Grund, warum das Durchreichen des Zustands zunächst
  // wirkungslos blieb: getCurrentMarketPrice() rief getSetValue() OHNE ihn auf.
  // Diese Funktion entscheidet anhand der Erfassungen — beim Anlegen eines
  // neuen Sets gibt es aber noch keine, und sets.condition ist ebenfalls noch
  // nicht geschrieben. Sie fiel damit auf 'N' zurück und lieferte den
  // Neupreis, obwohl „Gebraucht" angefragt war. Der berechnete effectiveCond
  // wurde nur im unerreichbaren Rückfall darunter benutzt.
  // Fundort seit Nachtrag 125: utils/marketPrice.ts. Die Funktion hatte sieben
  // Aufrufer, von denen keiner sie importieren konnte, solange sie im Router
  // lag. Die AUSSAGE dieser Prüfung ist unverändert.
  const raw = fs.readFileSync(path.join(ROOT, 'utils', 'marketPrice.ts'), 'utf8');
  const fn = raw.slice(raw.indexOf('async function getCurrentMarketPrice'));
  assert.match(fn, /if \(!condition\) \{/,
    'Die Erfassungs-Bewertung darf nur ohne ausdrücklichen Zustand greifen');

  // getSetValue muss INNERHALB dieser Bedingung liegen
  const iGuard = fn.indexOf('if (!condition) {');
  const iValue = fn.indexOf('getSetValue(userId, setNumber, currency)');
  assert.ok(iGuard > 0 && iValue > iGuard,
    'getSetValue darf einen angefragten Zustand nicht überstimmen');

  // Und die Preisabfrage darunter muss den angefragten Zustand bevorzugen
  assert.match(fn, /ORDER BY \(condition = \$2\) DESC LIMIT 1/,
    'Der angefragte Zustand muss Vorrang haben');
});

test('manuelle Teile und Minifiguren nutzen dieselbe Zustandsregel wie Sets', () => {
  // Gemeldet: Auf der Kachel eines manuell erfassten Teils stand „Neu",
  // obwohl alle Kaufpreise mit „Gebraucht" erfasst waren. Beide Funktionen
  // lasen nur die Stammtabelle — parts.condition bleibt beim Anlegen auf dem
  // Vorgabewert stehen, die Erfassungen wurden nie befragt.
  const src = require('./helpers/sources').handlerQuelle();

  pruefeParameter(src, 'applyManualCondition', ['userId', 'rows', 'kind'],
    'gemeinsame Regel für manuelle Einträge fehlt');

  // Dieselbe Regel wie getSetConditionAggregate: eine gebrauchte Erfassung genügt
  // Der Ausschnitt endet jetzt an der Funktion selbst, nicht an der nächsten:
  // applyManualCondition steht seit Nachtrag 133 in utils/handlers/shared.ts,
  // getManualParts in utils/handlers/parts.ts — die Reihenfolge im
  // zusammengefügten Quelltext ist damit eine andere.
  const anfang = src.indexOf('async function applyManualCondition');
  const fn = src.slice(anfang, src.indexOf('\n}', anfang));
  // Nicht neu ausformulieren, sondern denselben Helfer benutzen wie Sets.
  assert.match(fn, /conditionFromAcquisitions\(acqCount, usedCount, r\.condition\)/,
    'Manuelle Einträge müssen denselben Regel-Helfer benutzen wie Sets');
  assert.match(fn, /COUNT\(\*\) FILTER \(WHERE condition = 'U'\) AS used_count/,
    'Ohne used_count kann die Regel nicht greifen');

  // Beide Listen müssen sie anwenden
  assert.match(src, /applyManualCondition\(uids, rows, 'part'\)/,
    'getManualParts wendet die Regel nicht an');
  assert.match(src, /applyManualCondition\(uids, mapped, 'fig'\)/,
    'getManualMinifigs wendet die Regel nicht an');

  // Eine Abfrage für die ganze Seite, nicht eine je Zeile
  const queries = (fn.match(/db\.all\(/g) || []).length;
  assert.equal(queries, 1, `${queries} Abfragen — eine je Seite genügt`);
});

test('ein manuell erfasstes Teil bekommt Marktpreis und Erfassung', () => {
  // Zwei Lücken: Der Marktpreis wurde ohne Zustand geholt (also der Neupreis,
  // auch bei „Gebraucht"), und es entstand gar keine Zeile in
  // part_acquisitions — der Kaufpreis stand nur in der Stammtabelle, während
  // Detailansicht und Zustandsregel mit den Erfassungen arbeiten.
  const src = fs.readFileSync(path.join(ROOT, 'routes', 'parts.ts'), 'utf8');
  const fn = src.slice(src.indexOf('async function addManualPart'),
                       src.indexOf('async function updateManualPart'));

  // Der Zustand muss in die Preisermittlung — sonst kommt der Neupreis, auch
  // bei „Gebraucht".
  //
  // Geprüft wird das an JEDEM Aufruf, nicht an einer Fundstelle in
  // addManualPart. Die Zusicherung stand hier wörtlich als
  // `getCurrentPartMarketPrice(part_number, color_id, uid, condition)` und
  // wurde rot, als die Rechnung in resolveManualPartPurchase zusammenzog —
  // obwohl der Zustand dort sehr wohl mitgeht. Eine Regel, die an einem Ort
  // festgeschrieben ist, meldet den Umzug als Fehler und verpasst dafür die
  // vier anderen Aufrufer.
  const ohneZustand = [...src.matchAll(/getCurrentPartMarketPrice\(([^)]*)\)/g)]
    .filter(m => !m[1].includes('function'))          // die Definition selbst nicht
    .filter(m => m[1].split(',').length < 4);
  assert.equal(ohneZustand.length, 0,
    'Diese Aufrufe holen den Marktpreis OHNE Zustand:\n  ' +
    ohneZustand.map(m => m[0]).join('\n  ') +
    '\nDann fällt die Ermittlung intern auf den Standardzustand zurück, und ein ' +
    'als gebraucht erfasstes Teil bekommt den Neupreis.');
  // Selbstbeweis: Ohne Fundstellen sagt eine leere Liste nichts.
  const alleAufrufe = [...src.matchAll(/getCurrentPartMarketPrice\(/g)];
  assert.ok(alleAufrufe.length >= 4,
    `Nur ${alleAufrufe.length} Vorkommen von getCurrentPartMarketPrice( — Muster veraltet?`);
  // Zwei Pfade: neu angelegt und erneut erfasst — BEIDE brauchen eine
  // Erfassung. Der zweite endete früher mit `return { action: 'updated' }`,
  // ohne eine anzulegen; ein abweichendes Erfassungsdatum ging dabei verloren.
  //
  // Geschrieben wird seit hardened-93 über recordAcquisitionForDay(), das die
  // Zeile des Tages im selben Zustand aufstockt statt eine zweite anzulegen.
  const writes = [...fn.matchAll(/recordAcquisitionForDay\('part', uid,/g)];
  assert.equal(writes.length, 2,
    `${writes.length} statt 2 Erfassungs-Schreibvorgänge — Neuanlage und Zweiterfassung brauchen je einen`);
  assert.match(fn, /createdAt: acquiredAt/,
    'Das Erfassungsdatum muss übernommen werden');
  assert.match(fn, /effectivePurchasePrice > 0 \? effectivePurchasePrice : null/,
    'Ohne Marktpreis gehört NULL in die Erfassung, nicht 0');
  assert.match(fn, /condition: effectiveCondition/, 'Die Erfassung braucht den Zustand');
});

test('der Minifiguren-Marktpreis fragt BrickLink auch ohne separate BL-Nummer', () => {
  // Der Abruf lief nur, wenn eine abweichende bl_fig_number hinterlegt war.
  // Bei manuell erfassten Figuren ist das die Ausnahme — meist stimmt die
  // eigene Nummer mit der BrickLink-Nummer überein. Der Abruf wurde
  // übersprungen, die Teile-Schätzung übernahm, und die liefert ohne
  // Teile-Zusammensetzung von Rebrickable nichts: gar kein Preis.
  const src = fs.readFileSync(path.join(ROOT, 'routes', 'minifigs.ts'), 'utf8');
  const fn = src.slice(src.indexOf('async function getCurrentFigMarketPrice'),
                       src.indexOf('async function resolveManualFigPurchase'));

  assert.match(fn, /for \(const num of \[blFigNumber, figNumber\]\)/,
    'Beide Nummern müssen versucht werden');
  assert.doesNotMatch(fn, /if \(blFigNumber\) \{\s*const priceData/,
    'Der Abruf darf nicht mehr an einer separaten BL-Nummer hängen');

  // Reihenfolge: BrickLink zuerst, Teile-Schätzung nur als Rückfall
  const iLoop = fn.indexOf('for (const num of');
  const iEst  = fn.indexOf('estimateFigPriceFromParts');
  assert.ok(iLoop > 0 && iEst > iLoop,
    'Die Teile-Schätzung gehört hinter den BrickLink-Abruf');

  // Und sie schätzt im ERMITTELTEN Zustand, nicht im Standardzustand: Ohne
  // BrickLink-Nummer ist die Schätzung der einzige Preis, den es gibt — lief
  // sie fest auf „Neu", bekam eine gebraucht erfasste Figur den Neupreis
  // ihrer Teile. Für Figuren MIT Nummer war der Zustand längst berücksichtigt;
  // genau der Fall ohne Nummer fiel durch.
  assert.match(fn, /estimateFigPriceFromParts\(figNumber, userId, effCond\)/,
    'Der ermittelte Zustand muss in die Schätzung');

  const est = src.slice(src.indexOf('async function estimateFigPriceFromParts'),
                        src.indexOf('async function getCurrentFigMarketPrice'));
  assert.match(est, /fetchPartPrice\(blPartNum, p\.color_id \|\| 0, cond,/,
    'Die Teilepreise müssen im übergebenen Zustand geholt werden');
  assert.doesNotMatch(est.replace(/\/\/[^\n]*/g, ''),
    /fetchPartPrice\([^)]*DEFAULT_PRICE_CONDITION/,
    'Kein fester Standardzustand mehr in der Schätzung');

  // Und die Bewertung ruft sie je Zustand auf — sonst zeigten zwei Zeilen mit
  // verschiedenen Zuständen denselben Marktpreis.
  const fc = fs.readFileSync(path.join(ROOT, 'utils', 'financeCalc.ts'), 'utf8');
  // viewerId statt uid: Seit der Haushaltssicht sind „wessen Einstellungen"
  // und „wessen Daten" zwei Grössen. Die Schätzung braucht die EINSTELLUNGEN
  // (Währung) des fragenden Kontos — und weiterhin den Zustand.
  assert.match(fc, /estimateFigPriceFromParts\(fig\.fig_number, viewerId, cond\)/,
    'Die Minifiguren-Bewertung muss den Zustand mitgeben');
});

test('die Teile-Schätzung landet in Cache und Verlauf', () => {
  // Gemeldet: Im Detail-Dialog einer Minifigur OHNE BrickLink-Nummer standen
  // bei Marktpreis (Neu) und (Gebraucht) nur Striche, der Verlauf blieb leer —
  // obwohl Kaufpreise in beiden Zuständen erfasst waren.
  //
  // Marktpreis-Zeile und Diagramm lesen minifig_price_cache bzw.
  // minifig_price_history (utils/priceHistory.ts). Ein echter BrickLink-Abruf
  // schreibt beide (fetchMinifigPrice); der Schätzpfad rechnete nur und legte
  // nichts ab — für genau diese Figuren blieb dort für immer alles leer.
  const src = fs.readFileSync(path.join(ROOT, 'routes', 'minifigs.ts'), 'utf8');
  const est = src.slice(src.indexOf('async function estimateFigPriceFromParts'),
                        src.indexOf('async function getCurrentFigMarketPrice'));

  assert.match(est, /INSERT INTO minifig_price_cache[\s\S]{0,200}ON CONFLICT \(fig_number,condition,currency_code\)/,
    'Die Schätzung muss im Preis-Cache landen');
  assert.match(est, /INSERT INTO minifig_price_history[\s\S]{0,200}ON CONFLICT DO NOTHING/,
    'Ohne Verlaufspunkt bleibt das Diagramm für immer leer');
  // Je ZUSTAND ein Eintrag — sonst stünde derselbe Wert in beiden Zeilen.
  assert.match(est, /VALUES \(\$1,\$2,\$3,\$4,\$4\)/,
    'fig_number, condition, currency gehören in den Schlüssel');
  assert.match(est, /\[figNumber, cond, currency, total\]/,
    'Geschrieben wird der geschätzte Wert im angefragten Zustand');
  // Nur mit echtem Preis: Ein Nullpunkt sähe im Diagramm aus wie ein Kurssturz.
  assert.match(est, /if \(priced === 0\) return null;/,
    'Ohne bepreiste Teile darf nichts geschrieben werden');

  // Und beim Anlegen muss der ermittelte Preis in die Erfassung
  // created_at gehört seit der Datumsübernahme zur Spaltenliste.
  assert.match(src, /recordAcquisitionForDay\('fig', uid, \[num\][\s\S]{0,200}effectivePurchasePrice/,
    'Die Erfassung muss den tatsächlich verwendeten Kaufpreis tragen');
});

test('auch manuelle Minifiguren legen bei jeder Erfassung eine Zeile an', () => {
  // Gleicher früher Ausstieg wie bei den Teilen: `if (existing) { … return }`
  // beendete den Pfad, bevor eine Erfassung entstand. Menge stieg, aber kein
  // Kaufpreis und kein abweichendes Erfassungsdatum.
  const src = fs.readFileSync(path.join(ROOT, 'routes', 'minifigs.ts'), 'utf8');
  const fn = src.slice(src.indexOf('async function addManualFig'),
                       src.indexOf('async function addManualFig') + 6000);

  const writes = [...fn.matchAll(/recordAcquisitionForDay\('fig', uid, \[num\]/g)];
  assert.equal(writes.length, 2,
    `${writes.length} statt 2 Erfassungs-Schreibvorgänge — Neuanlage und Zweiterfassung brauchen je einen`);
  assert.match(fn, /createdAt: acquiredAt/,
    'Das Erfassungsdatum muss übernommen werden');
  // Die Zweiterfassung muss den Preis über dieselbe Funktion ermitteln
  assert.match(fn, /const re = await resolveManualFigPurchase\(uid, \{/,
    'Die Zweiterfassung darf die Preislogik nicht neu ausformulieren');
});

test('Erfassungen ohne Kaufpreis werden nachgetragen', () => {
  // Beim CSV-Import ist das Set oft noch nicht im Preis-Cache, und der
  // BrickLink-Abruf scheitert bei vielen Sets am Tageskontingent. Die Erfassung
  // entstand dann ohne Kaufpreis — der Marktpreis erschien später trotzdem,
  // sobald der Preis-Job den Cache füllte. Genau diese Abweichung war gemeldet.
  const job = fs.readFileSync(path.join(ROOT, 'jobs', 'purchasePriceBackfill.ts'), 'utf8');

  assert.match(job, /async function backfillAcquisitions\(\)/, 'Nachtrag fehlt');
  // Unabhängig von der Set-Zeile: backfillSets() sieht nur Sets mit NULL-Preis
  assert.match(job, /FROM set_acquisitions\s+WHERE purchase_price IS NULL/,
    'Der Nachtrag muss alle preislosen Erfassungen finden');
  // Der Zustand der ERFASSUNG bestimmt den Preis, nicht der des Sets
  assert.match(job, /getCurrentMarketPrice\(row\.set_number, row\.user_id, row\.condition \|\| null\)/,
    'Ein gebraucht erfasstes Exemplar braucht den Gebrauchtpreis');
  // Ein gepflegter Set-Preis darf nicht überschrieben werden
  assert.match(job, /UPDATE sets SET purchase_price=\$1\s+WHERE user_id=\$2 AND set_number=\$3 AND purchase_price IS NULL/,
    'Nur setzen, wo noch nichts steht');
  assert.match(job, /await backfillAcquisitions\(\)/, 'Der Durchlauf ist nicht eingehängt');

  // Und der Import selbst soll seltener ohne Preis enden
  const sets = require('./helpers/sources').setKernQuelle();
  assert.match(sets, /FROM price_history[\s\S]{0,200}ORDER BY \(condition = \$3\) DESC, recorded_at DESC/,
    'Die Historie fehlt als letzter Rückfall beim Import');
});

test('neue Sets holen den richtigen Zustand, nicht den Standard', () => {
  // Beim Anlegen eines neuen Sets existiert weder die sets- noch die
  // set_acquisitions-Zeile schon. conditionsNeededFor() fand daher nichts und
  // fiel auf 'N' zurück — ein als „Gebraucht" importiertes Set bekam den
  // Neupreis als Kaufpreis, weil die anschliessende Preisabfrage für 'U' noch
  // nichts im Cache fand und auf den gerade gecachten Neupreis auswich.
  // Gemeldeter Fall: CSV-Zeile "10214-1,1,,U,01.08.2026" (kein Preis, Zustand
  // U) bekam CHF 216.24 (den Neupreis) statt CHF 135.11 (Gebraucht).
  const job = fs.readFileSync(path.join(ROOT, 'jobs', 'priceJob.ts'), 'utf8');
  const { hatParameter } = require('./helpers/sources');
  assert.ok(hatParameter(job, 'conditionsNeededFor', 'hintCondition', true),
    'Der Hinweis-Parameter fehlt');
  assert.match(job, /if \(hintCondition === 'U' \|\| hintCondition === 'N'\) list\.push\(hintCondition\);/,
    'Der Hinweis muss in die Liste der zu holenden Zustände einfliessen');
  assert.ok(hatParameter(job, 'refreshPriceForSet', 'hintCondition', true),
    'refreshPriceForSet muss den Hinweis annehmen');
  assert.match(job, /conditionsNeededFor\(setNumber, userId, hintCondition\)/,
    'refreshPriceForSet muss den Hinweis weiterreichen');

  // Und getCurrentMarketPrice muss ihn beim Anlegen mitgeben — genau an der
  // Stelle, wo die Zeile noch nicht existiert.
  const preis = fs.readFileSync(path.join(ROOT, 'utils', 'marketPrice.ts'), 'utf8');
  assert.match(preis, /refreshPriceForSet\(setNumber, userId, condition\)/,
    'getCurrentMarketPrice muss den angefragten Zustand als Hinweis übergeben');
});

test('die Preis-Probe läuft ohne Serverfehler', () => {
  // Frühere Fassung fragte set_acquisitions.added_at ab — die Spalte heisst
  // created_at. Jede Probe endete in "Interner Serverfehler".
  const admin = fs.readFileSync(path.join(ROOT, 'routes', 'api_v1', 'admin.ts'), 'utf8');
  const code = admin.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /added_at/, 'set_acquisitions kennt keine Spalte added_at');
  assert.match(admin, /FROM set_acquisitions WHERE user_id=\$1 AND set_number=\$2 ORDER BY created_at/,
    'Die Probe muss über created_at sortieren');

  // Die Erklärung zur Zustandswahl war seit der effectiveCondition-Umstellung
  // veraltet — sie hätte fälschlich auf sets.condition verwiesen.
  assert.doesNotMatch(admin, /Die Bewertung richtet sich nach sets\.condition, nicht nach den Erfassungen/,
    'Die alte Erklärung passt nicht mehr zur tatsächlichen Regel');
  assert.match(admin, /const chosen = anyUsed \? 'U' : \(acqCount > 0 \? 'N' : /,
    'Die Probe muss dieselbe Regel zeigen wie die tatsächliche Bewertung');
});

test('computePnl liest acq_count/used_count — sonst gewinnt immer sets.condition', () => {
  // Die SELECT-Abfrage in computePnl (finance/pnl → Galerie-Kachel und
  // Detail-Dialog) selektierte kein acq_count/used_count. effectiveCondition()
  // liest genau diese Felder; ohne sie war set.acq_count immer undefined,
  // parseInt(undefined) ergab NaN, und die Funktion fiel IMMER auf
  // sets.condition zurück — unabhängig davon, was die Erfassungen tatsächlich
  // sagten. Bei einem veralteten sets.condition oder gemischten Erfassungen
  // (1× Neu, 1× Gebraucht) zeigte der P&L-Pfad einen anderen Marktpreis als
  // computeSetsValuation() (Finanzen-Reiter), die das schon korrekt machte.
  const src = fs.readFileSync(path.join(ROOT, 'utils', 'financeCalc.ts'), 'utf8');
  // Fenster grosszügiger: Der Blickfeld-Kommentar (Haushalt) steht am
  // Funktionsanfang und hat die geprüften Zeilen nach hinten geschoben. Ein
  // knapp bemessener Ausschnitt macht die Prüfung von jeder eingefügten Zeile
  // abhängig und meldet dann einen Fehler, den es nicht gibt.
  const fn = src.slice(src.indexOf('async function computePnl'),
                       src.indexOf('async function computePnl') + 3200);

  assert.match(fn, /COUNT\(\*\)\s+AS acq_count,/, 'acq_count fehlt in der Unterabfrage');
  assert.match(fn, /COUNT\(\*\) FILTER \(WHERE condition = 'U'\)\s+AS used_count/,
    'used_count fehlt in der Unterabfrage');
  assert.match(fn, /COALESCE\(a\.acq_count, 0\)\s+AS acq_count,/,
    'acq_count muss auch im äusseren SELECT stehen');
  assert.match(fn, /COALESCE\(a\.used_count, 0\)\s+AS used_count/,
    'used_count muss auch im äusseren SELECT stehen');
});

test('der Preisverlauf-Graph benutzt den Zustand DES SETS, nicht den globalen Standard', () => {
  // Gemeldet: Kaufpreis und Marktpreis stimmen überein (0.0% Entwicklung),
  // der Graph zeigt trotzdem einen Abfall am selben Tag. Ursache:
  // `const condition = DEFAULT_PRICE_CONDITION` — fest 'U', unabhängig vom
  // tatsächlichen Zustand des Sets. Für ein als „Neu" geführtes Set bevorzugte
  // die Graph-Abfrage trotzdem den Gebraucht-Preis, sobald beide Zustände am
  // selben Tag im Verlauf standen — der injizierte Kaufpreis-Punkt (Neu,
  // korrekt) und der Verlaufspunkt (fälschlich Gebraucht) erzeugten einen
  // Abfall, der real nicht stattfand.
  // Seit Etappe 5 gibt es die Route nur noch einmal (routes/api_v1/sets.ts);
  // die Webapp ruft dieselbe auf. Die Aussage bleibt: Die Route löst den
  // Zustand NICHT selbst auf, sondern überlässt das dem gemeinsamen Helfer —
  // genau das war das Ziel, vorher hatte jede Route ihre eigene Auflösung.
  const src = fs.readFileSync(path.join(ROOT, 'routes', 'api_v1', 'sets.ts'), 'utf8');
  const i = src.indexOf("router.get('/sets/:setNumber/price-history'");
  assert.ok(i > 0, 'Die Preisverlauf-Route ist nicht mehr auffindbar');
  const fn = src.slice(i, i + 1200);

  assert.doesNotMatch(fn, /const condition = DEFAULT_PRICE_CONDITION;/,
    'Der globale Standard darf nicht mehr direkt als Zustand des Sets gelten');
  assert.match(fn, /getSetPriceHistory\(await scopeIds\(uid, parseScopeMode\(req\.query\.accounts\)\), sn, currency\)/,
    'Die Route muss den gemeinsamen Helfer benutzen — mit Blickfeld');
  assert.doesNotMatch(fn, /FROM price_history/,
    'Die Abfrage gehört in utils/priceHistory.ts, nicht in die Route');

  const helper = fs.readFileSync(path.join(ROOT, 'utils', 'priceHistory.ts'), 'utf8');
  assert.match(helper, /const condition = await resolveSetCondition\(uids, setNumber\);/,
    'Der Helfer muss den Zustand über resolveSetCondition() auflösen');
});

test('Android-API: Marktpreis benutzt den Zustand des Sets, nicht den globalen Standard', () => {
  // Gemeldet per Screenshot: Android zeigte Marktpreis 110.48 CHF (Gebraucht)
  // für ein als „Neu" geführtes Set mit Kaufpreis 162.42 CHF — „-32.0%
  // Entwicklung", obwohl sich der Preis nie bewegt hatte. Ursache identisch zur
  // Webapp-Route: `fetchPrice(sn, DEFAULT_PRICE_CONDITION, …)` — fest 'U'.
  const src = fs.readFileSync(path.join(ROOT, 'routes', 'api_v1', 'sets.ts'), 'utf8');

  const priceRoute = src.slice(src.indexOf("router.get('/sets/:setNumber/price'"),
                               src.indexOf("router.get('/sets/:setNumber/price-history'"));
  assert.doesNotMatch(priceRoute, /fetchPrice\(sn, DEFAULT_PRICE_CONDITION/,
    'Der globale Standard darf nicht mehr direkt an fetchPrice gehen');
  // seit Nachtrag 33 mit Blickfeld (uids aus scopeIds) — sonst 404 im Haushalt
  assert.match(priceRoute, /const cond = await resolveSetCondition\(uids, sn\);/,
    'Der Zustand muss über den gemeinsamen Helfer aufgelöst werden');
  assert.match(priceRoute, /fetchPrice\(sn, cond, /, 'fetchPrice muss den aufgelösten Zustand bekommen');

  const historyRoute = src.slice(src.indexOf("router.get('/sets/:setNumber/price-history'"),
                                 src.indexOf("router.get('/sets/:setNumber'", src.indexOf("price-history")));
  assert.doesNotMatch(historyRoute, /const condition = DEFAULT_PRICE_CONDITION;/,
    'Auch der Verlauf darf nicht mehr den globalen Standard nehmen');
  // Seit der Zusammenführung teilt sich diese Route utils/priceHistory.ts mit
  // der Webapp — die rund fünfzig Zeilen, die dort standen, waren eine Kopie.
  assert.match(historyRoute, /getSetPriceHistory\(await scopeIds\(uid, parseScopeMode\(req\.query\.accounts\)\), sn, currency\)/,
    'Der Verlauf muss den gemeinsamen Helfer benutzen');
  assert.doesNotMatch(historyRoute, /FROM price_history/,
    'Die Abfrage gehört in utils/priceHistory.ts, nicht in die Route');
});

test('genau EINE Zustandsauflösung für Einzelsets — resolveSetCondition', () => {
  // Fünfter Fundort desselben Fehlers in dieser Sitzung: computeSetsValuation,
  // getCurrentMarketPrice, computePnl, die Webapp-Verlaufsroute und jetzt die
  // Android-API hatten je eine eigene Fassung. Ab jetzt genau eine Funktion für
  // Aufrufer ohne bereits geladene acq_count/used_count-Felder.
  const fc = fs.readFileSync(path.join(ROOT, 'utils', 'financeCalc.ts'), 'utf8');
  // Nimmt seit der Haushaltssicht auch eine Liste von Konten entgegen — der
  // Hauptaccount fragt den Zustand eines Sets ab, das einem Unterkonto gehört.
  pruefeParameter(fc, 'resolveSetCondition', ['uid', 'setNumber'],
    'der gemeinsame Helfer fehlt');
  assert.match(fc, /resolveSetCondition,\n\};/, 'Der Helfer muss exportiert sein');

  // Beide Aufrufer müssen ihn tatsächlich importieren, nicht eine eigene
  // Abfrage danebenstellen.
  // Die Verlaufsrouten rufen ihn nur noch mittelbar auf — über
  // utils/priceHistory.ts, das sich Webapp und Android teilen.
  const helper = fs.readFileSync(path.join(ROOT, 'utils', 'priceHistory.ts'), 'utf8');
  // UMFORMULIERT in Nachtrag 143: Geprüft wurde die Importzeile WÖRTLICH.
  // Seit dem Fix für die BrickLink-Schlüssel holt priceHistory.ts aus derselben
  // Datei zwei weitere Namen — die Zeile lautet jetzt
  //     import { resolveSetCondition, resolveBlColorId, resolveBlPartNumber } …
  // und die Prüfung wurde rot, ohne dass sich ihre Aussage geändert hätte.
  // Es zählt, DASS der gemeinsame Helfer von dort kommt.
  assert.match(helper, /import \{[^}]*\bresolveSetCondition\b[^}]*\} from '\.\/financeCalc';/,
    'utils/priceHistory.ts muss den gemeinsamen Helfer benutzen');

  // Die Preis-Route der Android-API löst weiterhin selbst auf (sie holt einen
  // Preis, keinen Verlauf) — genau ein Vorkommen.
  const apiV1 = fs.readFileSync(path.join(ROOT, 'routes', 'api_v1', 'sets.ts'), 'utf8');
  const uses = (apiV1.match(/resolveSetCondition\(uids, sn\)/g) || []).length;
  assert.equal(uses, 1, 'Die /price-Route muss ihn benutzen; der Verlauf geht über priceHistory.ts');
});

test('die Sparkline zeichnet avg_price, nicht qty_avg_price', () => {
  // Der Server wählte längst den richtigen Zustand (resolveSetCondition),
  // aber die Sparkline zeichnete `qty_avg_price` — eine andere Preisspalte
  // desselben, korrekt aufgelösten Zustands. qty_avg_price kann fehlen oder
  // 0 sein, während avg_price vorhanden ist; das erzeugte einen Graphen-Abfall,
  // der mit dem tatsächlichen Marktpreis nichts zu tun hatte. Android hatte
  // dieselbe Stelle (SetDetailComponents.kt) längst richtig — der Webapp fehlte
  // der Fix.
  const src = require('./helpers/sources').adminQuelle();
  const fn = src.slice(src.indexOf('function sparklineSVG'),
                       src.indexOf('function sparklineSVG') + 1000);
  assert.match(fn, /const vals = data\.map\(d=>d\.avg_price\|\|d\.qty_avg_price\|\|d\.total\|\|0\);/,
    'avg_price muss vor qty_avg_price stehen');
  assert.doesNotMatch(fn, /const vals = data\.map\(d=>d\.qty_avg_price\|\|d\.total\|\|0\);/,
    'Die alte, fehlerhafte Reihenfolge darf nicht mehr vorkommen');
});

test('parts_summary-Neuaufbau ist über eine Datenbank-Sperre vor Cluster-Workern geschützt', () => {
  // Gemeldet: "duplicate key value violates unique constraint
  // parts_summary_pkey" beim Hintergrundaufbau. Ursache: Der Server läuft im
  // Cluster-Modus mit mehreren Worker-Prozessen (server.ts, cluster.fork());
  // die In-Memory-Sperre (_rebuilding-Map) schützt nur INNERHALB eines
  // Prozesses. Fragen zwei Worker fast gleichzeitig für denselben Nutzer an,
  // können beide DELETE+INSERT ausführen — unter READ COMMITTED verpasst der
  // zweite Workers DELETE die vom ersten gerade committeten neuen Zeilen
  // (sie kamen nach Beginn seines Scans hinzu), sein anschliessender INSERT
  // versucht dieselben Zeilen erneut anzulegen und verletzt den Primärschlüssel.
  const src = fs.readFileSync(path.join(ROOT, 'utils', 'partsSummary.ts'), 'utf8');
  const fn = src.slice(src.indexOf('export async function rebuild'),
                       src.indexOf('export async function rebuild') + 3000);

  // Auf die ART der Sperre geprüft, nicht auf die Zahl: Seit Nachtrag 149
  // stehen alle Namensräume in utils/lockNamespaces.ts, und dass sie sich
  // nicht überschneiden, prüft test/lock-namespaces-db.test.js gegen eine
  // echte Datenbank. Hier zählt nur, dass die Sperre eine DATENBANK-Sperre ist
  // — die alte In-Memory-Map schützte nur innerhalb eines Workers.
  assert.match(fn, /pg_try_advisory_xact_lock\(/,
    'Die Sperre muss prozessübergreifend in der Datenbank liegen, nicht nur im Node-Prozess');
  assert.match(fn, /LOCKS\.TEILE_SUMMARY/,
    'Der Namensraum gehört aus utils/lockNamespaces.ts, nicht eingetippt');
  assert.match(fn, /if \(!lock\?\.ok\) \{\s*\/\//,
    'Ohne die Sperre muss der Aufbau abgebrochen werden, statt zu kollidieren');
  // Sperre muss VOR dem DELETE erworben werden, sonst nützt sie nichts.
  const lockIdx = fn.indexOf('pg_try_advisory_xact_lock');
  const deleteIdx = fn.indexOf('DELETE FROM parts_summary');
  assert.ok(lockIdx > 0 && lockIdx < deleteIdx,
    'Die Sperre muss vor dem DELETE erworben werden');
});

test('CDN-Anfragen erzwingen IPv4', () => {
  // Gemeldet: mehrere völlig unterschiedliche Set-Nummern liefen ALLE exakt
  // bis zur eingestellten Zeitgrenze, ohne je eine Antwort zu bekommen — kein
  // Fehler, kein TCP-Reset, einfach nichts. Das ist das typische Bild einer
  // kaputten oder nicht gerouteten IPv6-Verbindung des Hosters: Node versucht
  // zuerst eine IPv6-Adresse von Cloudflares Edge, der Verbindungsaufbau
  // dorthin hängt lautlos, und ohne Happy-Eyeballs-Rückfall wird nie auf IPv4
  // gewechselt, bevor der eigene Timeout zuschlägt.
  const server = require('./helpers/sources').serverAll();
  const agentBlock = server.slice(server.indexOf('const _cdnAgent ='), server.indexOf('const _cdnAgent =') + 1000);
  assert.match(agentBlock, /family: 4,/,
    'Der Bild-Proxy muss IPv4 für CDN-Anfragen erzwingen');

  // Der lokale Set-Bild-Download liegt seit Nachtrag 125 in utils/setImages.ts.
  const setsFile = fs.readFileSync(path.join(ROOT, 'utils', 'setImages.ts'), 'utf8');
  const dlFn = setsFile.slice(setsFile.indexOf('async function downloadSetImage'),
                             setsFile.indexOf('async function downloadSetImage') + 700);
  assert.match(dlFn, /https\.get\(u, \{ timeout:10000, family: 4,/,
    'Der Hintergrund-Download beim Import muss ebenfalls IPv4 erzwingen — dieselbe Ursache, derselbe Ort');
});

test('IPv4 wird an ALLEN ausgehenden HTTPS-Aufrufen erzwungen, nicht nur beim Bild-Proxy', () => {
  // Bestätigt per curl auf dem Server selbst: "Immediate connect fail ...
  // Network is unreachable" für IPv6 — der Server hat GAR KEINE IPv6-Route.
  // Das betrifft jede ausgehende Verbindung dieses Prozesses, nicht nur
  // Bilder. Jede Stelle, die roh gegen Rebrickable, BrickLink, Brickset oder
  // UPCitemdb spricht, braucht denselben `family: 4`.
  //
  // Diese Prüfung zählte früher je Datei eine feste Anzahl Fundstellen. Das
  // hat zweimal Aufräumarbeiten rot gemacht, obwohl sich am Verhalten nichts
  // änderte: Wer eine tote Zweitfassung entfernt, senkt die Zahl. Geprüft wird
  // deshalb jetzt die REGEL — jeder ausgehende Aufruf trägt family: 4 —
  // unabhängig davon, wie viele es gerade sind.
  const dateien = ['routes/imgProxy.ts', 'routes/sets.ts', 'jobs/partsCatalogEnrich.ts',
    'jobs/backfillBlPartNumbers.ts', 'jobs/rebrickableCsvSync.ts', 'clients/brickset.ts',
    'routes/parts.ts', 'clients/bricklink.ts', 'routes/api_v1/admin.ts', 'routes/api_v1/sets.ts'];

  const ohne = [];
  let gefunden = 0;
  for (const rel of dateien) {
    const src = ohneKommentare(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    // Jeder Aufruf von get(...) / request(...) mit Optionsobjekt als zweitem
    // Argument. Der Bereich bis zur schliessenden Klammer des Objekts muss
    // family: 4 enthalten.
    for (const m of src.matchAll(/\b(?:https?\.)?(?:get|request)\(\s*[^,()]*,\s*\{([^}]*)\}/g)) {
      gefunden++;
      // `agent: _cdnAgent` ist ebenfalls in Ordnung — der Agent trägt das
      // family: 4 selbst, geprüft im Test darüber.
      if (!/family:\s*4/.test(m[1]) && !/agent:/.test(m[1])) {
        ohne.push(`${rel}: ${m[0].slice(0, 70).replace(/\s+/g, ' ')}…`);
      }
    }
  }
  assert.ok(gefunden >= 8, `nur ${gefunden} ausgehende Aufrufe erkannt — das Muster greift nicht mehr`);
  assert.deepEqual(ohne, [], `ausgehende Aufrufe ohne family: 4:\n  ${ohne.join('\n  ')}`);
});

test('der Hintergrund-Job für Teile und Minifiguren erzeugt jetzt Vorschaubilder', () => {
  // Gemeldet: manuell erfasste Teile (und dasselbe Muster traf auch auf
  // Minifiguren zu) bekamen nie eine Vorschau. Ursache: Der stündliche
  // Hintergrund-Job lud das Bild herunter und aktualisierte image_local,
  // rief aber nie generateThumb() auf — anders als bei Sets (dieselbe
  // Datei, "set-img-bg"-Job weiter oben), wo das schon immer korrekt
  // geschah. Der einmalige Startup-Job ("Generate missing thumbnails")
  // hätte es irgendwann nachgeholt, aber erst beim NÄCHSTEN Neustart.
  const src = require('./helpers/sources').serverAll();

  const partsLoop = src.slice(src.indexOf('for (const p of manualParts) {'),
                              src.indexOf('for (const f of figsToFetch) {'));
  // UMFORMULIERT in Nachtrag 132: Geprüft wurde der WORTLAUT der Zeile
  //     const { generateThumb } = require('./routes/thumbs');
  // Beim Umbau der späten require() auf echte import-Anweisungen wurde daraus
  // ein Import am Dateikopf — die Prüfung wurde rot, ohne dass sich ihre
  // Aussage geändert hätte. Es zählt, DASS die Schleife verkleinert, und dass
  // generateThumb in der Datei überhaupt zu haben ist.
  assert.match(src, /generateThumb/,
    'generateThumb ist in server.ts nicht mehr verfügbar');
  assert.match(partsLoop, /generateThumb\(local\)\.catch\(\(\) => \{\}\);/,
    'Die Teile-Schleife muss generateThumb() nach einem erfolgreichen Download aufrufen');

  const figsLoop = src.slice(src.indexOf('for (const f of figsToFetch) {'),
                             src.lastIndexOf("await monitor.update('imgDl', { status: 'idle', sub: 'Alle Bilder gecacht'"));
  assert.match(figsLoop, /generateThumb\(local\)\.catch\(\(\) => \{\}\);/,
    'Die Minifiguren-Schleife muss generateThumb() nach einem erfolgreichen Download aufrufen');
});

// ═══════════════════════════════════════════════════════════════════════════
// Welche Plaketten die Kachel zeigt (hardened-91)
// ═══════════════════════════════════════════════════════════════════════════
// utils/handlers.ts gibt es seit Nachtrag 133 nicht mehr (aufgeteilt nach
// utils/handlers/{shared,parts,sets,minifigs,stats}.ts). Der Aufruf blieb hier
// stehen und liess die DATEI beim Laden sterben — die zehn Prüfungen unterhalb
// dieser Zeile liefen dadurch nie, ohne dass jemand ein rotes Ergebnis sah,
// solange in dist/ noch eine alte handlers.js lag. handlerModul() ist genau
// dafür da: den GEGENSTAND nennen, nicht den Ablageort.
const { buildAndRequire, handlerModul } = require('./helpers/sources');
const { conditionsFromAcquisitions, conditionFromAcquisitions } =
  handlerModul(buildAndRequire());

test('gemischte Erfassungen ergeben ZWEI Plaketten', () => {
  // Der gemeldete Fall: ein Exemplar neu, eines gebraucht. Bisher zeigte die
  // Kachel nur „Gebraucht" — die Neu-Erfassung war unsichtbar, obwohl sie mit
  // ihrem eigenen Preis in die Bewertung eingeht.
  assert.deepEqual(conditionsFromAcquisitions(2, 1, 'N'), ['N', 'U']);
  // Und die Einzelangabe bleibt daneben, was sie war.
  assert.equal(conditionFromAcquisitions(2, 1, 'N'), 'U');
});

test('nur ein Zustand ergibt eine Plakette', () => {
  assert.deepEqual(conditionsFromAcquisitions(3, 0, 'U'), ['N'],
    'alle Erfassungen neu → nur Neu, auch wenn die Stammzeile U sagt');
  assert.deepEqual(conditionsFromAcquisitions(2, 2, 'N'), ['U'],
    'alle Erfassungen gebraucht → nur Gebraucht');
});

test('ohne Erfassungen zählt der gespeicherte Wert', () => {
  assert.deepEqual(conditionsFromAcquisitions(0, 0, 'U'), ['U']);
  assert.deepEqual(conditionsFromAcquisitions(0, 0, null), ['N']);
});

test('die Reihenfolge ist fest: Neu vor Gebraucht', () => {
  // Nach Häufigkeit sortiert würden die Plaketten beim nächsten Kauf die
  // Plätze tauschen — auf einer Kachel, die man überfliegt, fällt genau das
  // als „hat sich was geändert?" auf.
  assert.deepEqual(conditionsFromAcquisitions(5, 4, 'N'), ['N', 'U']);
  assert.deepEqual(conditionsFromAcquisitions(5, 1, 'N'), ['N', 'U']);
});

test('die Kacheln rechnen die Plaketten nicht selbst aus', () => {
  const gal = fs.readFileSync(path.join(ROOT, 'public', 'js', '02-gallery.js'), 'utf8');
  assert.match(gal, /export function condBadges/,
    'Eine gemeinsame Fassung für Set-, Teile- und Minifiguren-Kacheln');
  // Vorher stand dieselbe Plakette viermal im Code, dreimal mit fest
  // eingetragenen Farben statt der CSS-Klassen. Geprüft wird genau das:
  // keine Zeile darf eine Zustands-Beschriftung UND eine eigene Farbe tragen.
  for (const f of ['public/js/06-minifigs.js', 'public/js/04-finance.js']) {
    const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n');
    const inline = lines.filter(l =>
      /common\.condition_(used|new)/.test(l) && /background:\s*var\(/.test(l));
    assert.equal(inline.length, 0,
      `${f}: Zustandsfarben gehören in die CSS-Klassen cond-new/cond-used`);
  }
});

test('der Kaufpreis auf der Kachel ist mengengewichtet, nicht das Maximum', () => {
  // MAX(purchase_price) zeigte bei 2x100 und 1x160 den Wert 160.
  const h = require('./helpers/sources').handlerQuelle();
  assert.match(h, /avg_purchase_price/,
    'Der gewichtete Kaufpreis fehlt im Aggregat');
  const gal = fs.readFileSync(path.join(ROOT, 'public', 'js', '02-gallery.js'), 'utf8');
  assert.match(gal, /s\.avg_purchase_price \?\? s\.max_purchase_price/,
    'Die Kachel muss den gewichteten Wert bevorzugen');
});

// ═══════════════════════════════════════════════════════════════════════════
// Anmelden mit E-Mail (hardened-100)
// ═══════════════════════════════════════════════════════════════════════════
const { isValidLoginIdentifier, USERNAME_RE, EMAIL_RE } =
  require('./helpers/sources').buildAndRequire()('utils/auth.js');

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
  for (const bad of ['', 'ab', 'marco meier', 'kein@at', '@example.com',
                     'a'.repeat(300) + '@example.com', "' OR 1=1 --"]) {
    assert.equal(isValidLoginIdentifier(bad), false, `\`${bad}\` sollte abgelehnt werden`);
  }
});

test('Registrieren und Profil bleiben beim Benutzernamen-Muster', () => {
  // Sonst könnte jemand die E-Mail-Adresse eines anderen als Benutzernamen
  // eintragen und dessen Anmeldung an sich ziehen — der Login sucht in beiden
  // Spalten.
  assert.equal(USERNAME_RE.test('marco@example.com'), false);
  assert.ok(EMAIL_RE.test('marco@example.com'));

  const src = fs.readFileSync(path.join(ROOT, 'routes', 'auth.ts'), 'utf8');
  const register = src.slice(src.indexOf("router.post('/register'"));
  assert.match(register, /USERNAME_RE\.test\(username\)/,
    'Registrieren muss beim Benutzernamen-Muster bleiben');
  assert.doesNotMatch(register, /isValidLoginIdentifier/,
    'Beim Registrieren darf keine E-Mail als Benutzername durchgehen');
});

test('beide Login-Wege prüfen gleich', () => {
  // Webapp und Android-API müssen dieselbe Regel haben — sonst funktioniert
  // die Anmeldung per E-Mail nur auf einem der beiden Wege.
  for (const f of ['routes/auth.ts', 'routes/api_v1/auth.ts']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.match(src, /if \(!isValidLoginIdentifier\(username\)\)/,
      `${f}: Login muss den gemeinsamen Prüfer benutzen`);
    assert.doesNotMatch(src.slice(src.indexOf("/login")),
      /\/\^\[A-Za-z0-9_\.-\]\{3,32\}\$\/\.test\(username\)/,
      `${f}: keine eigene Kopie des Benutzernamen-Musters im Login`);
  }
});
