/**
 * Marktwert eines Sets je Zustand (src/finanzen/setValue.ts).
 *
 * Gegenproben (08.11.2026 gemessen, jeweils zurückgenommen):
 *   cacheUsable ohne die kurze Frist für 0-Einträge → rot „ein gecachter
 *   Null-Preis …“; effectiveCondition bei Erfassungen immer 'N' → rot
 *   „Bewertung und Anzeige …“; buildChart() mit firstRealIndex immer 0 oder
 *   ohne Auffüllen mit 0 → rot „die Verlaufs-Endpunkte …“. Gestrichen, weil set-zustand-aggregat-db.test.js
 *   es ausführt: „der P&L-Pfad wählt je Set …“ (priceFor() immer Neupreis →
 *   dort rot) und „es gibt einen Diagnose-Endpunkt …“ (ohne price_cache → rot);
 *   „nur 404 wird negativ gemerkt, kein 403“ läuft in bild-proxy-deckel.test.js.
 *   Am 08.11.2026 gestrichen: „getPriceGuide holt ohne Angabe den Neupreis“ und
 *   „ohne Verkauf in sechs Monaten wird auf 'stock' ausgewichen“ →
 *   bricklink-preisfuehrer-db.test.js (Gegenproben A–D dort).
 *   Am 09.11.2026 gestrichen: drei SQL-Suchen in Dateien ohne SQL (prüften nichts) und „der Preisjob
 *   holt alle Zustände …“ → preislauf-zustaende-db.test.js führt zustaendeJeSet() aus.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// Nach dist/ bauen statt in-place — siehe helpers/sources.js.
const _req = require('./helpers/sources').buildAndRequire();
const { valueSet } = _req('src/finanzen/setValue.js');

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
  const v = valueSet(
    SN,
    [
      { quantity: 1, condition: 'N' },
      { quantity: 1, condition: 'U' },
    ],
    prices(148.72, 92.68),
  );
  // Stückpreis = Mittel der beiden, Summe = beide zusammen
  assert.equal(v.unit_price, Math.round(((148.72 + 92.68) / 2) * 100) / 100);
  assert.equal(v.total, 241.4);
  assert.equal(v.quantity, 2);
});

test('Anzeige × Menge ergibt immer die Summe', () => {
  // Verallgemeinerung auf ungleiche Stückzahlen: ein reiner Mittelwert über
  // die vorkommenden Zustände wäre hier inkonsistent zur Summe.
  const v = valueSet(
    SN,
    [
      { quantity: 2, condition: 'N' },
      { quantity: 1, condition: 'U' },
    ],
    prices(100, 40),
  );
  assert.equal(v.total, 240); // 2×100 + 1×40
  assert.equal(v.unit_price, 80); // 240 / 3
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

// valueSet() wird auch fuer manuelle Teile und Minifiguren benutzt; dort ist
// die Erfassung tatsaechlich optional. Fuer SETS gibt es seit Migration 0032
// keine Zeile ohne Erfassung mehr — der Rueckfallweg bleibt aber erreichbar
// und muss richtig rechnen.
test('ohne Erfassungen zaehlen die mitgegebenen Rueckfallwerte', () => {
  const v = valueSet(SN, [], prices(148.72, 92.68), 'U', 3);
  assert.equal(v.unit_price, 92.68);
  assert.equal(v.total, 278.04);
});

test('by_condition weist die Zusammensetzung aus', () => {
  const v = valueSet(
    SN,
    [
      { quantity: 2, condition: 'N' },
      { quantity: 1, condition: 'U' },
    ],
    prices(100, 40),
  );
  const n = v.by_condition.find(b => b.condition === 'N');
  const u = v.by_condition.find(b => b.condition === 'U');
  assert.deepEqual([n.quantity, n.unit_price], [2, 100]);
  assert.deepEqual([u.quantity, u.unit_price], [1, 40]);
});

test('qty_avg_price wird für Set-Preise nirgends mehr gelesen', () => {
  // Der Set-Kern arbeitet ausschliesslich mit Set-Preisen — dort darf der
  // Bezeichner nicht vorkommen. Ausnahme ist setPreis(): Die Preis-Antwort der
  // App führt das Feld qty_avg_price und reicht es nur durch.
  const roh = require('./helpers/sources').setKernQuelle();
  const von = roh.indexOf('export async function setPreis');
  const bis = roh.indexOf('export async function waehrungVon', von);
  assert.ok(von > 0 && bis > von, 'setPreis() nicht gefunden');
  const sets = roh.slice(0, von) + roh.slice(bis);
  assert.equal((sets.match(/qty_avg_price/g) || []).length, 0, 'Set-Kern: Set-Preise müssen über avg_price laufen');
});

test("guide_type ist überall 'sold', nicht 'stock'", () => {
  // 'sold' = tatsächlich erzielte Preise der letzten sechs Monate.
  // 'stock' wären eingestellte Angebote, also auch das, was niemand zahlt.
  for (const f of [
    'clients/bricklink.ts',
    'src/katalog/bricklinkPreise.ts',
    'routes/api_v1/sets.ts',
    'src/finanzen/financeCalc.ts',
    'src/finanzen/preisLauf.ts',
  ]) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const code = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    // 'stock' ist als RÜCKFALL erlaubt (kein Verkauf in sechs Monaten), aber
    // nie als Erstabfrage. Erkennbar am vorangestellten Spread bzw. am
    // expliziten Argument an getPriceGuideRaw.
    for (const m of code.matchAll(/guide_type:\s*'stock'/g)) {
      const before = code.slice(Math.max(0, m.index - 40), m.index);
      assert.match(
        before,
        /\.\.\.qp,\s*$/,
        `${f}: guide_type 'stock' als Erstabfrage — erlaubt ist es nur als Rückfall`,
      );
    }
    assert.doesNotMatch(code, /'price_guide_type',\s*'stock'/, `${f}: Vorgabe der Einstellung ist noch 'stock'`);
    assert.doesNotMatch(code, /guideType = 'stock'/, `${f}: Parametervorgabe ist noch 'stock'`);
  }
});

test('ein gecachter Null-Preis blockiert den Rückfall nicht dauerhaft', () => {
  // Ein 0-Eintrag galt für das volle TTL-Fenster als endgültige Antwort; die
  // Logik wich dann auf den ANDEREN Zustand aus. Ein Eintrag mit Preis gilt
  // das ganze Fenster, einer ohne nur kurz.
  const { cacheUsable } = _req('src/finanzen/rechnung/preise.js');
  const vor = (/** @type {number} */ h) => new Date(Date.now() - h * 3600000).toISOString();
  assert.equal(cacheUsable({ avg_price: '0', fetched_at: vor(1) }, 24), true, 'ein frischer 0-Eintrag antwortet');
  assert.equal(
    cacheUsable({ avg_price: '0', fetched_at: vor(7) }, 24),
    false,
    'ein alter 0-Eintrag muss durchfallen und einen Neuabruf auslösen',
  );
  assert.equal(cacheUsable({ avg_price: '0' }, 24), false, 'ohne fetched_at ist das Alter unbekannt');
  assert.equal(cacheUsable({ avg_price: '0', fetched_at: vor(3) }, 2), false, 'die kürzere Frist gewinnt');
  assert.equal(cacheUsable({ avg_price: '12.5', fetched_at: vor(20) }, 24), true, 'ein Preis gilt das volle Fenster');
  assert.equal(
    cacheUsable({ avg_price: '0', qty_avg_price: '9', fetched_at: vor(7) }, 24),
    true,
    'ein Mengenschnitt allein ist ein Preis (marktpreisAus) und gilt das volle Fenster',
  );
});

test('die Finanz-Ansicht zeigt avg_price als Marktpreis', () => {
  // Der Detail-Dialog war nach dem letzten Fix richtig, der Finanzen-Reiter
  // nicht: Dort zeigte die als „Marktpreis" beschriftete Spalte qty_avg_price,
  // und die Total-Spalte rechnete damit.
  const fin = fs.readFileSync(path.join(ROOT, 'public', 'js', 'finance.js'), 'utf8');
  assert.match(
    fin,
    /const total\s*=\s*acq \? acq\.wert_gesamt : s\.wert_gesamt;/,
    'Die Total-Spalte muss über avg_price laufen, nicht über qty_avg',
  );
  assert.match(
    fin,
    /parseFloat\(d\.totals\.avg\s*\|\|\s*'?0'?\)/,
    'Die Summen sind als „Ø Marktpreis" beschriftet und müssen totals.avg nehmen',
  );
  assert.match(
    fin,
    /(?:parseFloat|Number)\(it\.avg_price \?\? it\.qty_avg_price \?\? 0\)/,
    'Teile- und Minifiguren-Zeilen: avg_price zuerst',
  );
  assert.doesNotMatch(fin, /parseFloat\(d\.totals\.qty_avg/, 'Keine Summe darf mehr auf qty_avg basieren');

  // Die zweite Marktpreis-Spalte ist inzwischen ganz entfallen — die Zielform
  // prüft der Test „Finanzen: Kaufpreis statt zweiter Marktpreis-Spalte".
  // finance.qty_avg wurde mit der Spalte entfernt — kein toter Schlüssel.
  const i18n = require('./helpers/sources').i18nAll();
  assert.doesNotMatch(i18n, /'finance\.qty_avg':/, 'Der Schlüssel gehört mit der Spalte entfernt');
});

test('Finanzen: Kaufpreis statt zweiter Marktpreis-Spalte', () => {
  const fin = fs.readFileSync(path.join(ROOT, 'public', 'js', 'finance.js'), 'utf8');
  // Die Sets-Tabelle hatte zwei Preisspalten für dasselbe Konzept.
  assert.doesNotMatch(fin, /t\('finance\.qty_avg'\)/, 'Die mengengewichtete Spalte ist entfallen');
  // Einstand (Menge × Kaufpreis) vor Marktpreis, für alle drei Tabellen gleich.
  // Der Kopf darf ein Sortierknopf sein (sortKnopf), die Reihenfolge bleibt.
  assert.match(
    fin,
    /<th[^>]*>(?:<abbr[^>]*>)?\$\{(?:t(?:Raw)?\('finance\.col\.purchase'\)|sortKnopf\('kauf', \w+, tRaw\('finance\.col\.purchase'\)\))\}(?:<\/abbr>)?<\/th>`(?:\s*\+ `|\}\$\{html`)<th[^>]*>\$\{t(?:Raw)?\('(?:detail\.market_price|finance\.col\.stueckpreis)'\)\}/,
    'Sets-Tabelle: Kaufpreis vor Marktpreis, wie bei Teilen und Minifiguren',
  );
  // fmtGeld statt fmtN: Ein Kaufpreis von 0 (Geschenk) steht als „0,00 €“ da.
  assert.match(fin, /if \(n <= 1\) return fmtGeld\(p, cur\);/, 'Die Kaufpreis-Spalte muss den Wert auch anzeigen');

  // Die Gewichtung des Kaufpreises ist aus dem SQL in weightedPurchase()
  // gewandert — sie wird jetzt über dieselben Zeilen gerechnet, die auch in
  // der Tabelle stehen. Damit kann Zeilensumme und Kopfzahl nicht mehr
  // auseinanderlaufen.
  const sv = fs.readFileSync(path.join(ROOT, 'src/finanzen/setValue.ts'), 'utf8');
  assert.match(
    sv,
    /withCost\.reduce\(\(s, r\) => s \+ \(r\.purchase_price as number\) \* r\.quantity, 0\) \/ qty/,
    'Der Kaufpreis muss mengengewichtet gemittelt werden: 2x100 + 1x160 ergibt 120, nicht 130',
  );
  assert.match(sv, /r\.purchase_price != null/, 'Erfassungen ohne Kaufpreis dürfen den Nenner nicht aufblähen');

  // Hier stand eine Regel auf den Rueckfall `set.purchase_price != null ?
  // parseFloat(set.purchase_price) : null` in der Bewertung. Mit Migration 0032
  // gibt es die Spalte nicht mehr; die Bewertung nimmt ausschliesslich den
  // gewichteten Kaufpreis aus den Erfassungen. Das ist die Nachfolgeregel.
  const fc = require('./helpers/sources').finanzQuelle();
  assert.match(
    fc,
    /const purchase = weightedPurchase\(rows\);/,
    'Die Bewertung muss den Kaufpreis aus den Erfassungen nehmen, ohne Rueckfall',
  );
  assert.doesNotMatch(
    fc.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, ''),
    /parseFloat\(set\.purchase_price\)/,
    'Kein Pfad darf auf eine Kaufpreis-Spalte der sets-Zeile zurueckfallen',
  );
});

test('eine späte Antwort schreibt nicht in einen fremden Dialog', () => {
  const src = require('./helpers/sources').adminQuelle();
  const i = src.indexOf("api('GET', `/v1/minifigs?source=set`)");
  assert.ok(i > 0, 'Die Nachfrage nach den Minifiguren fehlt');
  const fn = src.slice(i, i + 500);
  assert.match(
    fn,
    /!curSet \|\| curSet\.set_number !== sn/,
    'Die späte Antwort prüft nicht, ob noch dasselbe Set offen ist',
  );
});

test('die Vorschau-Erzeugung ist gedeckelt', () => {
  // Marcos Messung
  const server = require('./helpers/sources').serverAll();
  const parallel = server.match(/const THUMB_MAX_PARALLEL = (\d+)/);
  assert.ok(parallel, 'THUMB_MAX_PARALLEL nicht gefunden');
  assert.ok(
    parseInt(parallel[1], 10) <= 1,
    `THUMB_MAX_PARALLEL = ${parallel[1]} — im Cluster vervielfacht sich das je ` +
      'Arbeitsprozess. Einer je Prozess genügt: Die Vorschau ist eine ' +
      'Beschleunigung für später, nichts, worauf jemand wartet.',
  );
  assert.match(
    server,
    /_thumbQueue\.length >= THUMB_MAX_QUEUE/,
    'Die Warteschlange hat keine Obergrenze — wer schnell durchscrollt, staut ' +
      'den halben Katalog auf, und der Server rechnet ihn stur ab',
  );

  // Und die Grenze muss für den GANZEN Server gelten
  assert.match(
    server,
    /pg_try_advisory_lock\(\$1\)/,
    'Die Vorschau-Erzeugung hat keine prozessübergreifende Sperre — dann rechnet ' +
      'jeder Arbeitsprozess für sich, und die Grenze oben ist wirkungslos',
  );
  // try, nicht warten: Wer den Zuschlag nicht bekommt, lässt es. Ein wartender
  // Lauf hielte eine Datenbankverbindung fest und staute die Arbeit doch wieder.
  assert.doesNotMatch(
    server,
    /pg_advisory_lock\(\$1\)/,
    'Ein WARTENDER Lock staut die Arbeit nur an anderer Stelle auf',
  );
  assert.match(
    server,
    /pg_advisory_unlock\(\$1\)/,
    'Ohne Freigabe blockiert der erste Lauf alle folgenden bis zum Neustart',
  );

  // Und der Katalog erzeugt gar keine Vorschauen
  assert.match(
    server,
    /const darfErzeugen = req\.query\.gen !== '0'/,
    'Der Proxy kennt kein „Vorschau nutzen, aber keine erzeugen"',
  );
  const kat = fs.readFileSync(path.join(ROOT, 'public', 'js', 'catalog.js'), 'utf8');
  assert.match(kat, /imgUrl\(thumbUrl\(src\), 'nur'\)/, 'Die Katalog-Kachel lässt weiter Verkleinerungen erzeugen');
  // Die Galerie NICHT — dort lohnt es sich.
  const gal = fs.readFileSync(path.join(ROOT, 'public', 'js', 'gallery.js'), 'utf8');
  assert.match(
    gal,
    /imgUrl\(thumbUrl\(src\)\s*\|\|\s*src,\s*true\)/,
    'Der eigene Bestand sollte weiterhin Vorschauen bekommen',
  );
});

test('Bewertung und Anzeige benutzen dieselbe Zustandsregel', () => {
  // Die Anzeige leitete den Zustand aus den Erfassungen ab, die Bewertung las
  // einen gespeicherten Wert — die Kachel zeigte „Neu", bewertet wurde gebraucht.
  const { effectiveCondition } = _req('src/finanzen/rechnung/zustand.js');
  const { conditionFromAcquisitions } = _req('src/bestand/gemeinsam.js');
  for (const [acq, used] of [
    [0, 0],
    [1, 0],
    [3, 0],
    [1, 1],
    [3, 1],
    [2, 2],
    ['2', '1'],
    [null, null],
  ]) {
    assert.equal(
      effectiveCondition({ acq_count: acq, used_count: used }),
      conditionFromAcquisitions(acq, used),
      `acq_count=${acq}, used_count=${used}: Bewertung und Anzeige weichen ab`,
    );
  }
  assert.equal(effectiveCondition({ acq_count: 2, used_count: 1 }), 'U', 'eine gebrauchte Erfassung genügt');
  assert.equal(effectiveCondition(null), 'N', 'ohne Erfassungen gilt „Neu“');
});

test('die Verlaufs-Endpunkte liefern fertige Diagrammdaten', () => {
  // ── Warum der Server das ausrechnet ──────────────────────────────────────
  // Vorher baute jeder Client die Zeitachse selbst: die Webapp in
  // priceChartSVG(), Android hätte dieselbe Rechnung ein zweites Mal
  // gebraucht. Genau dieses Muster ist in diesem Projekt schon mehrfach
  // auseinandergelaufen (Zustandsauflösung, Bild-Allowlist, Verlaufsroute).
  const { buildChart } = _req('src/finanzen/chartData.js');
  const d = buildChart([
    {
      name: 'N',
      rows: [
        { recorded_at: '2026-01-02', avg_price: '10' },
        { recorded_at: '2026-01-03', avg_price: 11 },
      ],
    },
    { name: 'U', rows: [{ recorded_at: '2026-01-03', avg_price: null, qty_avg_price: '7' }] },
  ]);
  assert.deepEqual(d.x, ['2026-01-02', '2026-01-03'], 'Die Achse trägt die Messtage beider Reihen');
  assert.deepEqual(
    d.values[1].values.map((/** @type {any} */ p) => p.y),
    [0, 7],
    'Leere Positionen werden mit 0 aufgefüllt',
  );
  assert.equal(
    d.values[1].firstRealIndex,
    1,
    'Ohne diesen Index kann ein Renderer die aufgefüllten Nullen nicht überspringen',
  );
  assert.equal(d.values[0].firstRealIndex, 0);
  assert.equal(
    buildChart([{ name: 'leer', rows: [] }]).values[0].firstRealIndex,
    0,
    'Eine leere Reihe zeigt hinter ihr Ende',
  );

  // Alle drei Verlaufs-Endpunkte müssen ihn benutzen.
  const ph = fs.readFileSync(path.join(ROOT, 'src/finanzen/priceHistory.ts'), 'utf8');
  // Teile- und Minifiguren-Verlauf sind seit hardened-96 ebenfalls in
  // src/finanzen/priceHistory.ts (die Android-Routen brauchen dieselbe Antwort) — sie
  // teilen sich dort EINEN Aufbau, deshalb steht buildChart zweimal in der
  // Datei: einmal für Sets, einmal für beide manuellen Arten.
  const uses = (ph.match(/buildChart\(/g) || []).length;
  assert.equal(uses, 2, `${uses} statt 2 buildChart-Aufrufe in src/finanzen/priceHistory.ts`);
  // Auch dort, wo die Verlaufs-Routen stehen: Ein Adapter baut keine Diagrammdaten.
  const v1fin = fs.readFileSync(path.join(ROOT, 'routes/api_v1/finance.ts'), 'utf8');
  assert.doesNotMatch(
    v1fin,
    /buildChart\(/,
    'Die Routendatei ist ein Adapter — die Diagrammdaten baut der gemeinsame Helfer',
  );

  // Der Renderer darf die aufgefüllten Nullen nicht zeichnen — sonst beginnt
  // die Linie bei null und springt senkrecht hoch: ein Kurssturz, den es nie
  // gab.
  const admin = require('./helpers/sources').adminQuelle();
  assert.match(admin, /slice\(sd\.firstRealIndex \?\? 0\)/, 'priceChartSVG muss führende Nullen überspringen');
});

// ═══════════════════════════════════════════════════════════════════════════
// Eine Zeile je Kaufpreis (hardened-90)
// ═══════════════════════════════════════════════════════════════════════════
const { valueAcquisitionRows, weightedPurchase, pnlPct } = _req('src/finanzen/setValue.js');

const acq = (id, cond, qty, price, day) => ({
  id,
  condition: cond,
  quantity: qty,
  purchase_price: price,
  created_at: day ? `${day}T12:00:00Z` : null,
});

test('je Erfassung eine Zeile, jede mit dem Preis IHRES Zustands', () => {
  // Der gemeldete Fall: ein Exemplar neu gekauft, eines gebraucht. Vorher galt
  // das ganze Set als gebraucht, sobald EINE Erfassung gebraucht war — auch
  // das neue Exemplar wurde dann mit dem Gebrauchtpreis bewertet.
  const rows = valueAcquisitionRows(SN, [acq(1, 'N', 1, 100), acq(2, 'U', 1, 60)], prices(148.72, 92.68));

  assert.equal(rows.length, 2, 'Zwei Kaufpreise → zwei Zeilen');
  assert.equal(rows[0].avg_price, 148.72, 'Die Neu-Zeile bekommt den Neupreis');
  assert.equal(rows[1].avg_price, 92.68, 'Die Gebraucht-Zeile bekommt den Gebrauchtpreis');
  assert.equal(rows[0].total_avg, '148.72');
  assert.equal(rows[1].total_avg, '92.68');
});

test('die Prozentangabe rechnet gegen den Kaufpreis DIESER Zeile', () => {
  const rows = valueAcquisitionRows(SN, [acq(1, 'N', 1, 100), acq(2, 'U', 1, 60)], prices(150, 90));
  assert.equal(rows[0].pnl_pct, '50.0', '150 gegen 100');
  assert.equal(rows[1].pnl_pct, '50.0', '90 gegen 60');
});

test('Menge zählt: die Zeilensumme ist Preis × Menge', () => {
  const rows = valueAcquisitionRows(SN, [acq(1, 'N', 3, 100)], prices(50, 20));
  assert.equal(rows[0].total_avg, '150.00');
});

test('ohne erfassten Kaufpreis keine Prozentangabe — und bei 0 auch nicht', () => {
  const rows = valueAcquisitionRows(SN, [acq(1, 'N', 1, null), acq(2, 'N', 1, 0)], prices(50, 20));
  assert.equal(rows[0].purchase_price, null, 'nicht erfasst bleibt null, nicht 0');
  assert.equal(rows[0].pnl_pct, null, 'gegen nichts gerechnet ergibt keine Zahl');
  assert.equal(rows[1].purchase_price, 0, 'ein Geschenk ist erfasst: 0, nicht null');
  assert.equal(rows[1].pnl_pct, null, 'gegen 0 gerechnet gibt es keine Prozentzahl');
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
  const rows = valueAcquisitionRows(
    SN,
    [acq(1, 'N', 2, 100), acq(2, 'N', 1, 160), acq(3, 'N', 5, null)],
    prices(50, 20),
  );
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
  assert.equal(
    Math.round(v.unit_price * v.quantity * 100) / 100,
    v.total,
    'Stückpreis × Menge = Gesamtwert (so rechnen Webapp und Android)',
  );
});

test('Kaufpreis 0 ergibt keine Prozentzahl, keinen Sprung ins Unendliche', () => {
  assert.equal(pnlPct(0, 50), null);
  assert.equal(pnlPct(40, 50), '25.0');
  assert.equal(pnlPct(null, 50), null);
  assert.equal(pnlPct(50, null), null);
});
