/**
 * Marktwert eines Sets je Zustand (utils/setValue.ts).
 *
 * Gemeldet an 10290-1: angezeigt CHF 92.68, obwohl das Set nur eine
 * Neu-Erfassung hat und BrickLink für Neu einen Avg Price von US$ 148.72
 * ausweist. Drei Ursachen, alle in dieselbe Richtung wirkend:
 *
 *   1. Die Auswahl aus price_cache sortierte nach
 *      `(hat einen Preis) DESC, (Zustand passt) DESC` — also gewann ein
 *      vorhandener Gebraucht-Preis über den angefragten Neu-Zustand.
 *   2. Überall wurde `qty_avg_price || avg_price` benutzt. qty_avg_price ist
 *      der mengengewichtete Schnitt und liegt unter BrickLinks "Avg Price".
 *      Dazu ist `"0.00"` aus Postgres truthy und verdeckte einen gültigen
 *      avg_price.
 *   3. getPriceGuide() hatte 'U' als Vorgabe.
 *
 * Ausführen: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
// Nach dist/ bauen statt in-place — siehe helpers/sources.js.
const _req = require('./helpers/sources').buildAndRequire();
const { valueSet } = _req('utils/setValue.js');

const SN = '10290-1';
const prices = (n, u) => {
  const m = new Map();
  if (n) m.set(`${SN}|N`, n);
  if (u) m.set(`${SN}|U`, u);
  return m;
};

test('nur Neu erfasst → Neupreis, kein Ausweichen auf Gebraucht', () => {
  // Der gemeldete Fall: eine Neu-Erfassung, beide Preise im Cache.
  const v = valueSet(SN, [{ quantity: 1, condition: 'N' }], prices(148.72, 92.68));
  assert.equal(v.unit_price, 148.72);
  assert.equal(v.total, 148.72);
});

test('je ein Exemplar neu und gebraucht', () => {
  const v = valueSet(SN, [
    { quantity: 1, condition: 'N' },
    { quantity: 1, condition: 'U' },
  ], prices(148.72, 92.68));
  // Stückpreis = Mittel der beiden, Summe = beide zusammen
  assert.equal(v.unit_price, Math.round(((148.72 + 92.68) / 2) * 100) / 100);
  assert.equal(v.total, 241.40);
  assert.equal(v.quantity, 2);
});

test('Anzeige × Menge ergibt immer die Summe', () => {
  // Verallgemeinerung auf ungleiche Stückzahlen: ein reiner Mittelwert über
  // die vorkommenden Zustände wäre hier inkonsistent zur Summe.
  const v = valueSet(SN, [
    { quantity: 2, condition: 'N' },
    { quantity: 1, condition: 'U' },
  ], prices(100, 40));
  assert.equal(v.total, 240);                       // 2×100 + 1×40
  assert.equal(v.unit_price, 80);                   // 240 / 3
  assert.equal(v.unit_price * v.quantity, v.total);
});

test('fehlender Preis für einen Zustand weicht auf den anderen aus', () => {
  const v = valueSet(SN, [{ quantity: 1, condition: 'U' }], prices(148.72, null));
  assert.equal(v.unit_price, 148.72, 'besser der andere Zustand als gar kein Wert');
});

test('gar kein Preis ergibt null, nicht 0', () => {
  const v = valueSet(SN, [{ quantity: 1, condition: 'N' }], new Map());
  assert.equal(v.unit_price, null);
  assert.equal(v.total, null, 'eine 0 sähe in den Summen wie ein bekannter Wert aus');
});

test('ohne Erfassungen zählt sets.condition', () => {
  const v = valueSet(SN, [], prices(148.72, 92.68), 'U', 3);
  assert.equal(v.unit_price, 92.68);
  assert.equal(v.total, 278.04);
});

test('by_condition weist die Zusammensetzung aus', () => {
  const v = valueSet(SN, [
    { quantity: 2, condition: 'N' },
    { quantity: 1, condition: 'U' },
  ], prices(100, 40));
  const n = v.by_condition.find(b => b.condition === 'N');
  const u = v.by_condition.find(b => b.condition === 'U');
  assert.deepEqual([n.quantity, n.unit_price], [2, 100]);
  assert.deepEqual([u.quantity, u.unit_price], [1, 40]);
});

test('qty_avg_price wird für Set-Preise nirgends mehr gelesen', () => {
  // routes/sets.ts arbeitet ausschliesslich mit Set-Preisen — dort darf der
  // Bezeichner gar nicht mehr vorkommen.
  const sets = require('./helpers/sources').setKernQuelle();
  assert.equal((sets.match(/qty_avg_price/g) || []).length, 0,
    'routes/sets.ts: Set-Preise müssen über avg_price laufen');

  // finance.ts liest daneben Teile- und Minifiguren-Preise aus eigenen
  // Tabellen; dort bleibt qty_avg_price bewusst stehen. Geprüft wird deshalb
  // gezielt jedes SELECT auf die Set-Tabelle price_cache.
  const fin = fs.readFileSync(path.join(ROOT, 'routes', 'finance.ts'), 'utf8');
  for (const m of fin.matchAll(/SELECT([\s\S]{0,200}?)FROM\s+price_cache\b/g)) {
    assert.doesNotMatch(m[1], /qty_avg_price/,
      `routes/finance.ts: Set-Preisabfrage liest noch qty_avg_price:\n${m[0].slice(0, 120)}`);
  }
});

test('die Sortierung "hat einen Preis vor passendem Zustand" ist überall weg', () => {
  for (const f of ['routes/sets.ts', 'routes/finance.ts']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(src, /ORDER BY \(qty_avg_price[^)]*\) DESC, \(condition/,
      `${f}: Diese Sortierung liefert für ein neues Set den Gebraucht-Preis`);
  }
});

test('getPriceGuide holt ohne Angabe den Neupreis', () => {
  // Fundort seit Nachtrag 131: clients/bricklink.ts (null Routen, nie montiert).
  const src = fs.readFileSync(path.join(ROOT, 'clients', 'bricklink.ts'), 'utf8');
  assert.match(src, /function getPriceGuide\(setNumber, condition = 'N'/,
    "Vorgabe 'U' hätte den Gebraucht-Preis in den Cache geschrieben");
});

test("guide_type ist überall 'sold', nicht 'stock'", () => {
  // 'sold' = tatsächlich erzielte Preise der letzten sechs Monate.
  // 'stock' wären eingestellte Angebote, also auch das, was niemand zahlt.
  for (const f of ['clients/bricklink.ts', 'routes/api_v1/sets.ts',
                   'utils/financeCalc.ts', 'jobs/priceJob.ts']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const code = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    // 'stock' ist als RÜCKFALL erlaubt (kein Verkauf in sechs Monaten), aber
    // nie als Erstabfrage. Erkennbar am vorangestellten Spread bzw. am
    // expliziten Argument an getPriceGuideRaw.
    for (const m of code.matchAll(/guide_type:\s*'stock'/g)) {
      const before = code.slice(Math.max(0, m.index - 40), m.index);
      assert.match(before, /\.\.\.qp,\s*$/,
        `${f}: guide_type 'stock' als Erstabfrage — erlaubt ist es nur als Rückfall`);
    }
    assert.doesNotMatch(code, /'price_guide_type',\s*'stock'/, `${f}: Vorgabe der Einstellung ist noch 'stock'`);
    assert.doesNotMatch(code, /guideType = 'stock'/, `${f}: Parametervorgabe ist noch 'stock'`);
  }
});

test('Fallback zwischen den Zuständen bleibt — aber in der richtigen Reihenfolge', () => {
  // Der angefragte Zustand gewinnt, wenn er einen Preis hat. Der andere kommt
  // nur zum Zug, wenn dort keiner steht. Genau umgekehrt war der gemeldete
  // Fehler: „hat einen Preis" schlug „passender Zustand".
  for (const f of ['routes/sets.ts', 'routes/finance.ts']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of src.matchAll(/SELECT[\s\S]{0,240}?FROM price_cache[\s\S]{0,260}?`/g)) {
      const q = m[0];
      if (!/condition IN \('N','U'\)/.test(q)) continue;   // strikte Abfragen ohne Fallback
      // Nur Abfragen prüfen, die EINE Zeile auswählen. Seit der Detail-Dialog
      // Neu- und Gebrauchtpreis nebeneinander zeigt, gibt es Abfragen, die
      // bewusst BEIDE Zeilen liefern (routes/finance.ts, `current`). Dort ist
      // die Rückfall-Sortierung sinnlos — es wird ja nichts verworfen — und
      // ihre Abwesenheit ist kein Fehler.
      if (!/LIMIT 1|DISTINCT ON/.test(q)) continue;
      assert.match(q, /avg_price > 0/,
        `${f}: Ohne diesen Filter gilt ein leerer Eintrag als gültiger Preis`);
      assert.match(q, /ORDER BY \(condition = \$\d\) DESC/,
        `${f}: Der angefragte Zustand muss zuerst sortiert werden`);
      assert.doesNotMatch(q, /ORDER BY \(avg_price[^)]*\) DESC, \(condition/,
        `${f}: alte Sortierung — sie liefert für ein neues Set den Gebraucht-Preis`);
    }
  }
});

test('der Preisjob holt alle Zustände, die ein Set tatsächlich führt', () => {
  // Seit der zustandsabhängigen Bewertung braucht ein Set mit einem neuen UND
  // einem gebrauchten Exemplar beide Preise im Cache. Vorher holte der Job
  // immer nur einen Zustand und wich nur bei komplett fehlendem Preis auf den
  // anderen aus — bei gemischten Sets fehlte damit dauerhaft eine Hälfte.
  // .ts statt .js: jobs/ ist TypeScript, das .js ist nur noch ein Build-Ergebnis
  // in dist/ und im Repo nicht mehr vorhanden.
  const job = fs.readFileSync(path.join(ROOT, 'jobs', 'priceJob.ts'), 'utf8');

  assert.match(job, /async function conditionsNeededFor/,
    'Es braucht eine Stelle, die die vorkommenden Zustände eines Sets ermittelt');
  assert.match(job, /FROM set_acquisitions WHERE user_id=\$1 AND set_number=\$2/,
    'Die Zustände müssen aus den Erfassungen kommen, nicht aus einer Vorgabe');

  // Sofort-Abruf: Schleife über die ermittelten Zustände
  const immediate = job.slice(job.indexOf('async function refreshPriceForSet'));
  assert.match(immediate, /for \(const c of conditions\)/,
    'refreshPriceForSet muss jeden benötigten Zustand holen');

  // Hintergrundlauf: ebenfalls je Set über die Zustände
  const bg = job.slice(job.indexOf('async function runPriceRefresh'),
                       job.indexOf('async function refreshPriceForSet'));
  assert.match(bg, /for \(const c of conditions\)/,
    'Auch der Hintergrundlauf muss beide Zustände abdecken');
  assert.match(bg, /GROUP BY set_number, COALESCE\(condition,'N'\)/,
    'Die Zustände aller Sets gehören in EINE Abfrage — sonst ein Roundtrip je Set');

  // Reine Sets dürfen nicht doppelt abgefragt werden (BrickLink-Tageskontingent)
  assert.match(bg, /condBySet\.has\(sn\)\s*\n?\s*\?\s*\[\.\.\.condBySet\.get\(sn\)\]/,
    'Nur die tatsächlich vorkommenden Zustände abrufen, nicht pauschal beide');
});

test("ohne Verkauf in sechs Monaten wird auf 'stock' ausgewichen", () => {
  // BrickLink liefert für selten gehandelte Artikel eine Antwort mit
  // avg_price = 0 — 'sold' allein hiesse dort dauerhaft kein Marktpreis.
  const bl = fs.readFileSync(path.join(ROOT, 'clients', 'bricklink.ts'), 'utf8');
  assert.match(bl, /function hasUsablePrice/, 'Prüfung auf brauchbaren Preis fehlt');
  assert.match(bl, /getPriceGuideRaw\(setNumber, condition, 'stock', currencyCode\)/,
    "Rückfall auf 'stock' fehlt");
  assert.match(bl, /guide_used/, 'Es muss nachvollziehbar bleiben, woher der Wert kommt');
  // Reihenfolge: sold gewinnt, wenn es einen Preis hat
  assert.match(bl, /if \(hasUsablePrice\(first\) \|\| guideType !== 'sold'\)/,
    "'sold' muss Vorrang behalten, wenn dort ein Preis steht");

  const fc = fs.readFileSync(path.join(ROOT, 'utils', 'financeCalc.ts'), 'utf8');
  const fallbacks = [...fc.matchAll(/guide_type: 'stock'/g)];
  assert.equal(fallbacks.length, 2,
    'Teile- und Minifiguren-Pfad gehen nicht über getPriceGuide und brauchen den Rückfall selbst');
});

test('ein gecachter Null-Preis blockiert den Rückfall nicht dauerhaft', () => {
  // Genau hier lief der sold→stock-Rückfall ins Leere: Ein 0-Eintrag galt für
  // das volle TTL-Fenster als endgültige Antwort, es wurde nie neu geholt —
  // und die Logik wich stattdessen auf den ANDEREN Zustand aus. Ein neues Set
  // zeigte damit den Gebraucht-Preis.
  const fc = fs.readFileSync(path.join(ROOT, 'utils', 'financeCalc.ts'), 'utf8');
  assert.match(fc, /const ZERO_PRICE_TTL_HOURS/,
    '0-Einträge brauchen ein kürzeres Fenster als Einträge mit Preis');
  assert.match(fc, /function cacheUsable/, 'Prüffunktion fehlt');
  assert.match(fc, /cached && parseFloat\(cached\.avg_price\) === 0 && cacheUsable\(cached, ttl\)/,
    'Ein alter 0-Eintrag muss durchfallen und einen Neuabruf auslösen');
  assert.match(fc, /fetched_at/,
    'Ohne fetched_at in PRICE_CACHE_COLS lässt sich das Alter nicht bewerten');
  // Der Zustands-Fallback darf erst NACH dem Preis-Check greifen
  const idxZero = fc.indexOf('parseFloat(cached.avg_price) === 0');
  const idxOk   = fc.indexOf('parseFloat(cached.avg_price) > 0');
  assert.ok(idxOk > 0 && idxOk < idxZero,
    'Ein vorhandener Preis muss vor jeder Ausweichlogik zurückgegeben werden');
});

test('KEINE Abfrage stellt mehr "hat einen Preis" vor "passender Zustand"', () => {
  // Diese Sortierung war der eigentliche Grund für den falschen Marktpreis.
  // Sie steckte an fünf Stellen; vier waren beim ersten Anlauf behoben, die
  // fünfte (der P&L-Pfad in financeCalc.ts) speist aber genau die Anzeige in
  // Galerie und Detail-Dialog — dort blieb der Gebraucht-Preis stehen.
  const files = ['routes/sets.ts', 'routes/finance.ts', 'routes/api_v1/sets.ts',
                 'utils/financeCalc.ts', 'utils/portfolioHistory.ts'];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
      .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(src, /ORDER BY[^`]*\(qty_avg_price\s*>\s*0\)\s*DESC\s*,\s*\(condition/,
      `${f}: alte Sortierung — sie liefert für ein neues Set den Gebraucht-Preis`);
  }
});

test('der P&L-Pfad wählt je Set nach dessen eigenem Zustand', () => {
  // Seit der Bewertung je Erfassung (hardened-90) wählt der P&L-Pfad nicht
  // mehr EINEN Zustand fürs ganze Set, sondern lässt valueSet() jede Erfassung
  // mit dem Preis ihres Zustands bewerten. Der geschützte Fehler bleibt
  // derselbe: Der Marktpreis darf nicht aus dem falschen Zustand stammen.
  const fc = fs.readFileSync(path.join(ROOT, 'utils', 'financeCalc.ts'), 'utf8');
  assert.match(fc, /valueSet\(set\.set_number, acqs, asPriceMap\(cacheByKey\)/,
    'Der P&L-Pfad muss dieselbe Bewertungsregel benutzen wie die Anzeige');
  assert.match(fc, /effectiveCondition\(set\)/,
    'Ohne Erfassungen zählt weiterhin die gemeinsame Zustandsregel');
  // Und die Abfrage muss avg_price überhaupt mitlesen
  assert.match(fc, /SELECT set_number, condition, avg_price, qty_avg_price FROM price_cache/,
    'Ohne avg_price im SELECT greift die Auswertung ins Leere');

  // Das Ausweichen auf den anderen Zustand lebt jetzt an EINER Stelle.
  const sv = fs.readFileSync(path.join(ROOT, 'utils', 'setValue.ts'), 'utf8');
  assert.match(sv, /const want\s*=\s*prices\.get\(`\$\{setNumber\}\|\$\{cond\}`\);\s*\n\s*if \(want\) return want;/,
    'Der andere Zustand darf nur einspringen, wenn der eigene keinen Preis hat');
});

test('die Finanz-Ansicht zeigt avg_price als Marktpreis', () => {
  // Der Detail-Dialog war nach dem letzten Fix richtig, der Finanzen-Reiter
  // nicht: Dort zeigte die als „Marktpreis" beschriftete Spalte qty_avg_price,
  // und die Total-Spalte rechnete damit.
  const fin = fs.readFileSync(path.join(ROOT, 'public', 'js', '04-finance.js'), 'utf8');
  assert.match(fin, /const total\s*=\s*acq \? acq\.total_avg : s\.total_avg;/,
    'Die Total-Spalte muss über avg_price laufen, nicht über qty_avg');
  assert.match(fin, /parseFloat\(d\.totals\.avg\|\|0\)/,
    'Die Summen sind als „Ø Marktpreis" beschriftet und müssen totals.avg nehmen');
  assert.match(fin, /parseFloat\(it\.avg_price \?\? it\.qty_avg_price \?\? 0\)/,
    'Teile- und Minifiguren-Zeilen: avg_price zuerst');
  assert.doesNotMatch(fin, /parseFloat\(d\.totals\.qty_avg/,
    'Keine Summe darf mehr auf qty_avg basieren');

  // Die zweite Marktpreis-Spalte ist inzwischen ganz entfallen — die Zielform
  // prüft der Test „Finanzen: Kaufpreis statt zweiter Marktpreis-Spalte".
  // finance.qty_avg wurde mit der Spalte entfernt — kein toter Schlüssel.
  const i18n = require('./helpers/sources').i18nAll();
  assert.doesNotMatch(i18n, /'finance\.qty_avg':/,
    'Der Schlüssel gehört mit der Spalte entfernt');
});

test('Finanzen: Kaufpreis statt zweiter Marktpreis-Spalte', () => {
  const fin = fs.readFileSync(path.join(ROOT, 'public', 'js', '04-finance.js'), 'utf8');
  // Die Sets-Tabelle hatte zwei Preisspalten für dasselbe Konzept.
  assert.doesNotMatch(fin, /t\('finance\.qty_avg'\)/,
    'Die mengengewichtete Spalte ist entfallen');
  assert.match(fin, /<th>\$\{t\('detail\.purchase_price'\)\}<\/th><th>\$\{t\('detail\.market_price'\)\}/,
    'Sets-Tabelle: Kaufpreis vor Marktpreis, wie bei Teilen und Minifiguren');
  assert.match(fin, /purchase!=null\?fmtN\(purchase,cur\)/,
    'Die Kaufpreis-Spalte muss den Wert auch anzeigen');

  // Die Gewichtung des Kaufpreises ist aus dem SQL in weightedPurchase()
  // gewandert — sie wird jetzt über dieselben Zeilen gerechnet, die auch in
  // der Tabelle stehen. Damit kann Zeilensumme und Kopfzahl nicht mehr
  // auseinanderlaufen.
  const sv = fs.readFileSync(path.join(ROOT, 'utils', 'setValue.ts'), 'utf8');
  assert.match(sv, /withCost\.reduce\(\(s, r\) => s \+ \(r\.purchase_price as number\) \* r\.quantity, 0\) \/ qty/,
    'Der Kaufpreis muss mengengewichtet gemittelt werden: 2x100 + 1x160 ergibt 120, nicht 130');
  assert.match(sv, /r\.purchase_price != null/,
    'Erfassungen ohne Kaufpreis dürfen den Nenner nicht aufblähen');

  const fc = fs.readFileSync(path.join(ROOT, 'utils', 'financeCalc.ts'), 'utf8');
  assert.match(fc, /set\.purchase_price != null \? parseFloat\(set\.purchase_price\) : null/,
    'Ohne Erfassungen zählt sets.purchase_price');
});

test('eine späte Antwort schreibt nicht in einen fremden Dialog', () => {
  // ── Marcos Konsole (Nachtrag 109) ─────────────────────────────────────────
  //     [promise] TypeError: Cannot read properties of null (reading 'minifigs')
  //
  // Als [promise] gemeldet, also aus einer Fortsetzung. openModal() fragt die
  // Minifiguren-Zahl nach, NACHDEM der Dialog schon steht. Wer ihn vorher
  // schliesst (closeModal setzt curSet auf null) oder ein anderes Set öffnet,
  // lief in diesen Fehler.
  //
  // Die Prüfung auf das ELEMENT allein genügt nicht: Beim Öffnen eines anderen
  // Sets gibt es das Element weiterhin — die Zahl landete dann im falschen
  // Dialog. Verglichen wird deshalb die Setnummer.
  const src = require('./helpers/sources').adminQuelle();
  const i = src.indexOf("api('GET', `/v1/minifigs?source=set`)");
  assert.ok(i > 0, 'Die Nachfrage nach den Minifiguren fehlt');
  const fn = src.slice(i, i + 500);
  assert.match(fn, /!curSet \|\| curSet\.set_number !== sn/,
    'Die späte Antwort prüft nicht, ob noch dasselbe Set offen ist');
});

test('die Vorschau-Erzeugung ist gedeckelt', () => {
  // ── Marcos Messung ────────────────────────────────────────────────────────
  // 329 % CPU im Container bei 15 MB Netzverkehr. Also keine Warterei auf
  // fremde Server, sondern Rechnen — und die teuerste Rechnung im Server ist
  // das Verkleinern von Bildern.
  //
  // Jimp ist reines JavaScript; auf schwacher Hardware (Raspberry Pi) kostet
  // ein JPEG spürbar Zeit. Der Server läuft im CLUSTER, die Grenze gilt JE
  // Arbeitsprozess — bei vier Prozessen also viermal. Vorher: 2 × 4 = acht
  // gleichzeitige Läufe, dazu eine Warteschlange ohne Ende.
  //
  // Bis zum Umbau der Katalogliste fiel das nicht auf: Sie zeigte nur, wozu man
  // sich hingescrollt hatte. Seit dem Fensterladen kommen bei jedem Sprung
  // hunderte neue Bilder ins Blickfeld.
  const server = require('./helpers/sources').serverAll();
  const parallel = server.match(/const THUMB_MAX_PARALLEL = (\d+)/);
  assert.ok(parallel, 'THUMB_MAX_PARALLEL nicht gefunden');
  assert.ok(parseInt(parallel[1]) <= 1,
    `THUMB_MAX_PARALLEL = ${parallel[1]} — im Cluster vervielfacht sich das je ` +
    'Arbeitsprozess. Einer je Prozess genügt: Die Vorschau ist eine ' +
    'Beschleunigung für später, nichts, worauf jemand wartet.');
  assert.match(server, /_thumbQueue\.length >= THUMB_MAX_QUEUE/,
    'Die Warteschlange hat keine Obergrenze — wer schnell durchscrollt, staut ' +
    'den halben Katalog auf, und der Server rechnet ihn stur ab');

  // ── Und die Grenze muss für den GANZEN Server gelten ──────────────────────
  //
  // Marcos Beobachtung: „Es rechnen alle gleichzeitig und beginnen erst, wenn
  // ich das erste Mal richtig scrolle." Vier Prozesse mal ein Lauf sind immer
  // noch vier gleichzeitige Verkleinerungen — auf einem Raspberry Pi praktisch
  // alle Kerne. Eine Grenze im Arbeitsspeicher kann das nicht lösen, weil kein
  // Prozess von den anderen weiss.
  assert.match(server, /pg_try_advisory_lock\(\$1\)/,
    'Die Vorschau-Erzeugung hat keine prozessübergreifende Sperre — dann rechnet ' +
    'jeder Arbeitsprozess für sich, und die Grenze oben ist wirkungslos');
  // try, nicht warten: Wer den Zuschlag nicht bekommt, lässt es. Ein wartender
  // Lauf hielte eine Datenbankverbindung fest und staute die Arbeit doch wieder.
  assert.doesNotMatch(server, /pg_advisory_lock\(\$1\)/,
    'Ein WARTENDER Lock staut die Arbeit nur an anderer Stelle auf');
  assert.match(server, /pg_advisory_unlock\(\$1\)/,
    'Ohne Freigabe blockiert der erste Lauf alle folgenden bis zum Neustart');

  // ── Und der Katalog erzeugt gar keine Vorschauen ──────────────────────────
  //
  // Marcos Frage: „Der Proxy sollte das Bild in Originalgrösse weitergeben und
  // die Bilder mit einem Job nachladen. Dadurch sollte die Last doch klein
  // bleiben?" — Das Ausliefern des Originals tut er längst (er wartet NICHT auf
  // die Verkleinerung). Die Last kam daher, dass er für JEDES neue Bild eine
  // Verkleinerung anstiess, und der Katalog zeigt rund 25 000 fremde Sets.
  //
  // Für einen Bestand von ein paar hundert Bildern, die man täglich
  // wiedersieht, lohnt die Verkleinerung. Für 25 000 Sets, an denen man
  // vorbeiscrollt, nie.
  assert.match(server, /const darfErzeugen = req\.query\.gen !== '0'/,
    'Der Proxy kennt kein „Vorschau nutzen, aber keine erzeugen"');
  const kat = fs.readFileSync(path.join(ROOT, 'public', 'js', '09-catalog.js'), 'utf8');
  assert.match(kat, /imgUrl\(thumbUrl\(src\), 'nur'\)/,
    'Die Katalog-Kachel lässt weiter Verkleinerungen erzeugen');
  // Die Galerie NICHT — dort lohnt es sich.
  const gal = fs.readFileSync(path.join(ROOT, 'public', 'js', '02-gallery.js'), 'utf8');
  assert.match(gal, /imgUrl\(thumbUrl\(src\)\|\|src, true\)/,
    'Der eigene Bestand sollte weiterhin Vorschauen bekommen');
});

test('nur 404 wird negativ gemerkt, kein 403', () => {
  // 403 kommt beim CDN auch als Drosselung vor. Es zu merken hiesse, dass
  // Bilder „teilweise" fehlen, obwohl sie existieren. Diese Aussage gilt
  // unverändert.
  //
  // Der WEG hat sich geändert (Nachtrag 98): Der Merker lag im Arbeitsspeicher
  // EINES Prozesses und verfiel nach 15 Minuten. Der Server läuft im Cluster —
  // dasselbe fehlende Bild wurde deshalb einmal je Arbeitsprozess geholt, nach
  // jedem Neustart erneut, und nach 15 Minuten wieder. In den alten
  // Katalogjahrgängen, wo fast jedes Bild fehlt, war das der Grossteil der
  // Last. Jetzt steht es in der Datenbank, für alle Prozesse.
  const server = require('./helpers/sources').serverAll();
  const merkStelle = server.indexOf('merkeFehlend(cacheKey)');
  assert.ok(merkStelle > 0, 'Die Fehlanzeige wird nicht mehr festgehalten');
  assert.doesNotMatch(server.slice(server.indexOf('if (r.statusCode ==='), merkStelle),
    /403/, 'Ein 403 darf nicht gemerkt werden');
  // Und gelesen wird aus derselben Quelle — ein zweiter Merker daneben wäre
  // wieder ein Gedächtnis je Prozess.
  assert.match(server, /istBekanntFehlend\(cacheKey\)/,
    'Der Proxy fragt den gemeinsamen Merker nicht ab');
});

test('Bewertung und Anzeige benutzen dieselbe Zustandsregel', () => {
  // DER Kern des wiederholt falschen Marktpreises: Die Anzeige leitet den
  // Zustand aus den Erfassungen ab (getSetConditionAggregate), die Bewertung
  // las stur sets.condition. Weichen die voneinander ab — etwa weil ein Set
  // nachträglich auf „Neu" korrigiert wurde — zeigte die Kachel „Neu", der
  // Preis stammte aber aus dem Gebraucht-Eintrag.
  const fc = fs.readFileSync(path.join(ROOT, 'utils', 'financeCalc.ts'), 'utf8');
  assert.match(fc, /function effectiveCondition/, 'Gemeinsame Regel fehlt');
  assert.doesNotMatch(fc.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, ''),
    /set\.condition === 'U'\) \? 'U' :/,
    'Kein Pfad darf sets.condition mehr direkt auswerten');

  // Die Regel muss der Anzeige entsprechen: eine Gebraucht-Erfassung genügt.
  assert.match(fc, /if \(usedCount > 0\) return 'U';/, 'Eine gebrauchte Erfassung macht das Set gebraucht');
  assert.match(fc, /if \(acqCount > 0\)\s+return 'N';/, 'Erfassungen ohne Gebraucht bedeuten neu');

  // Und die Abfrage muss die Zähler überhaupt liefern
  assert.match(fc, /COUNT\(\*\) FILTER \(WHERE condition = 'U'\)\s+AS used_count/,
    'Ohne used_count kann die Regel nicht greifen');
});

test('es gibt einen Diagnose-Endpunkt für Preise', () => {
  const admin = fs.readFileSync(path.join(ROOT, 'routes', 'api_v1', 'admin.ts'), 'utf8');
  assert.match(admin, /router\.get\('\/admin\/price-probe', requireApiAdmin/, 'Endpunkt fehlt');
  assert.match(admin, /chosen_for_price/, 'Der gewählte Zustand gehört in die Antwort');
  assert.match(admin, /price_cache: cacheRows/, 'Die Cache-Zeilen gehören dazu');
  assert.match(admin, /req\.query\.live === '1'/, 'Ein Live-Abruf gegen BrickLink muss möglich sein');
});

test('die Verlaufs-Endpunkte liefern fertige Diagrammdaten', () => {
  // ── Warum der Server das ausrechnet ──────────────────────────────────────
  // Vorher baute jeder Client die Zeitachse selbst: die Webapp in
  // priceChartSVG(), Android hätte dieselbe Rechnung ein zweites Mal
  // gebraucht. Genau dieses Muster ist in diesem Projekt schon mehrfach
  // auseinandergelaufen (Zustandsauflösung, Bild-Allowlist, Verlaufsroute).
  const cd = fs.readFileSync(path.join(ROOT, 'utils', 'chartData.ts'), 'utf8');
  assert.match(cd, /export function buildChart/, 'Der gemeinsame Bauer fehlt');
  assert.match(cd, /byDay\.has\(day\) \? byDay\.get\(day\)! : 0/,
    'Leere Positionen müssen mit 0 aufgefüllt werden');
  assert.match(cd, /firstRealIndex/,
    'Ohne diesen Index kann ein Renderer die aufgefüllten Nullen nicht überspringen');

  // Alle drei Verlaufs-Endpunkte müssen ihn benutzen.
  const ph = fs.readFileSync(path.join(ROOT, 'utils', 'priceHistory.ts'), 'utf8');
  // Teile- und Minifiguren-Verlauf sind seit hardened-96 ebenfalls in
  // utils/priceHistory.ts (die Android-Routen brauchen dieselbe Antwort) — sie
  // teilen sich dort EINEN Aufbau, deshalb steht buildChart zweimal in der
  // Datei: einmal für Sets, einmal für beide manuellen Arten.
  //
  // Die Klammer gehört nicht in die Prüfung: Der Set-Verlauf übergibt seit
  // Nachtrag 83 eine ZUSAMMENGESTELLTE Liste (nur die Zustände, die im Bestand
  // liegen) statt eines festen Arrays. Ein Test, der `buildChart([` verlangt,
  // hätte diese Verbesserung verhindert, ohne etwas Zusätzliches zu sichern.
  const uses = (ph.match(/buildChart\(/g) || []).length;
  assert.equal(uses, 2, `${uses} statt 2 buildChart-Aufrufe in utils/priceHistory.ts`);
  const fin = fs.readFileSync(path.join(ROOT, 'routes', 'finance.ts'), 'utf8');
  assert.doesNotMatch(fin, /buildChart\(/,
    'Die Routendatei ist ein Adapter — die Diagrammdaten baut der gemeinsame Helfer');

  // Der Renderer darf die aufgefüllten Nullen nicht zeichnen — sonst beginnt
  // die Linie bei null und springt senkrecht hoch: ein Kurssturz, den es nie
  // gab.
  const admin = require('./helpers/sources').adminQuelle();
  assert.match(admin, /slice\(sd\.firstRealIndex \?\? 0\)/,
    'priceChartSVG muss führende Nullen überspringen');
});

// ═══════════════════════════════════════════════════════════════════════════
// Eine Zeile je Kaufpreis (hardened-90)
// ═══════════════════════════════════════════════════════════════════════════
const { valueAcquisitionRows, weightedPurchase, pnlPct } = _req('utils/setValue.js');

const acq = (id, cond, qty, price, day) => ({
  id, condition: cond, quantity: qty, purchase_price: price,
  created_at: day ? `${day}T12:00:00Z` : null,
});

test('je Erfassung eine Zeile, jede mit dem Preis IHRES Zustands', () => {
  // Der gemeldete Fall: ein Exemplar neu gekauft, eines gebraucht. Vorher galt
  // das ganze Set als gebraucht, sobald EINE Erfassung gebraucht war — auch
  // das neue Exemplar wurde dann mit dem Gebrauchtpreis bewertet.
  const rows = valueAcquisitionRows(SN, [acq(1, 'N', 1, 100), acq(2, 'U', 1, 60)],
    prices(148.72, 92.68));

  assert.equal(rows.length, 2, 'Zwei Kaufpreise → zwei Zeilen');
  assert.equal(rows[0].avg_price, 148.72, 'Die Neu-Zeile bekommt den Neupreis');
  assert.equal(rows[1].avg_price, 92.68,  'Die Gebraucht-Zeile bekommt den Gebrauchtpreis');
  assert.equal(rows[0].total_avg, '148.72');
  assert.equal(rows[1].total_avg, '92.68');
});

test('die Prozentangabe rechnet gegen den Kaufpreis DIESER Zeile', () => {
  const rows = valueAcquisitionRows(SN, [acq(1, 'N', 1, 100), acq(2, 'U', 1, 60)],
    prices(150, 90));
  assert.equal(rows[0].pnl_pct, '50.0', '150 gegen 100');
  assert.equal(rows[1].pnl_pct, '50.0', '90 gegen 60');
});

test('Menge zählt: die Zeilensumme ist Preis × Menge', () => {
  const rows = valueAcquisitionRows(SN, [acq(1, 'N', 3, 100)], prices(50, 20));
  assert.equal(rows[0].total_avg, '150.00');
});

test('ohne erfassten Kaufpreis keine Prozentangabe — 0 dagegen schon', () => {
  const rows = valueAcquisitionRows(SN, [acq(1, 'N', 1, null), acq(2, 'N', 1, 0)],
    prices(50, 20));
  assert.equal(rows[0].purchase_price, null, 'nicht erfasst bleibt null, nicht 0');
  assert.equal(rows[0].pnl_pct, null, 'gegen nichts gerechnet ergibt keine Zahl');
  assert.notEqual(rows[1].pnl_pct, null, 'ein geschenktes Exemplar (0) hat eine Entwicklung');
});

test('fehlt der Preis eines Zustands, springt der andere ein', () => {
  // Viele ältere Sets werden nur noch in einem Zustand gehandelt. Die
  // Erfassung mit 0 zu bewerten würde die Summe verfälschen.
  const rows = valueAcquisitionRows(SN, [acq(1, 'U', 1, 60)], prices(148.72, null));
  assert.equal(rows[0].avg_price, 148.72);
});

test('der Kaufpreis wird nur über die Zeilen gemittelt, die einen haben', () => {
  // 2×100 und 1×160 ergibt 120, nicht 130 — und eine Erfassung ohne
  // erfassten Preis darf den Nenner nicht aufblähen.
  const rows = valueAcquisitionRows(SN,
    [acq(1, 'N', 2, 100), acq(2, 'N', 1, 160), acq(3, 'N', 5, null)], prices(50, 20));
  assert.equal(weightedPurchase(rows), 120);
  assert.equal(weightedPurchase([]), null, 'keine Zeile mit Preis → kein Kaufpreis');
});

test('Zeilensummen und Set-Stückpreis passen zusammen', () => {
  // Die Tabelle zeigt beides. Weichen sie ab, stehen zwei Wahrheiten
  // nebeneinander — genau das war der Grund, die Rechnung hierher zu holen.
  const acqs = [acq(1, 'N', 2, 100), acq(2, 'U', 1, 60)];
  const p = prices(150, 90);
  const rows = valueAcquisitionRows(SN, acqs, p);
  const v = valueSet(SN, acqs, p);
  const sumRows = rows.reduce((s, r) => s + parseFloat(r.total_avg), 0);
  assert.equal(sumRows, v.total, 'Σ Zeilen = Gesamtwert des Sets');
  assert.equal(Math.round(v.unit_price * v.quantity * 100) / 100, v.total,
    'Stückpreis × Menge = Gesamtwert (so rechnen Webapp und Android)');
});

test('Kaufpreis 0 ergibt eine Zahl, keinen Sprung ins Unendliche', () => {
  assert.equal(pnlPct(0, 50), (50 / 0.01 * 100).toFixed(1));
  assert.equal(pnlPct(null, 50), null);
  assert.equal(pnlPct(50, null), null);
});
