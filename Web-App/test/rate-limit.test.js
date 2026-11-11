/**
 * Tageslimit für Rebrickable-API-Aufrufe.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// Nach dist/ bauen statt in-place — siehe helpers/sources.js.
const _req = require('./helpers/sources').buildAndRequire();
const { ohneKommentare } = require('./helpers/sources');
const { REBRICKABLE_DEFAULT_DAILY } = _req('src/katalog/rateLimiter.js');

const EXPECTED = 25000;

test('Standard-Tageslimit ist 25000 — an EINER Stelle', () => {
  assert.equal(REBRICKABLE_DEFAULT_DAILY, EXPECTED);
  // getLimitForApi() hatte eine eigene Kopie des Rückfallwerts (4000). Solange
  // Rebrickable seinen eigenen Zähler hatte, sah es diese Tabelle nie — seit
  // beide über checkAndIncrementRateLimit laufen, wäre es eine stille Kürzung
  // auf ein Sechstel gewesen. Zwei Konstanten mit derselben Bedeutung driften …
  const fc = fs.readFileSync(path.join(ROOT, 'src/katalog/apiKontingent.ts'), 'utf8');
  assert.match(fc, /rebrickable: REBRICKABLE_DEFAULT_DAILY/,
    'Der Rückfallwert muss die gemeinsame Konstante sein, nicht eine eigene Zahl danebenstehen');
  assert.doesNotMatch(fc, /rebrickable: \d+/, 'Keine zweite Zahl für dasselbe Limit');
});

test('das Tageskontingent zählt für die Installation, nicht je Worker', () => {
  // Woher dieser Test kommt
  const rl = fs.readFileSync(path.join(ROOT, 'src/katalog/rateLimiter.ts'), 'utf8');
  assert.match(rl, /async function consumeRebrickableDaily/,
    'Der Verbrauch muss über den gemeinsamen Zähler laufen');
  assert.match(rl, /checkAndIncrementRateLimit\('rebrickable'\)/,
    'Derselbe Mechanismus wie bei BrickLink und Brickset — kein dritter Weg');
  assert.doesNotMatch(rl, /new DailyLimiter\(/,
    'Keine prozesslokale Instanz mehr für ein Tagesbudget');

  // Alle Aufrufstellen gehen über den gemeinsamen Weg.
  for (const datei of ['clients/rebrickable.ts', 'src/katalog/partsImport.ts', 'src/sets/dienst.ts',
                       'src/katalog/teileAnreicherung.ts',
                       'src/katalog/csvAbgleich.ts']) {
    const src = fs.readFileSync(path.join(ROOT, datei), 'utf8');
    assert.doesNotMatch(src, /rebrickableDailyLimiter/,
      `${datei}: zählt noch am gemeinsamen Zähler vorbei`);
  }

  // Und das Nachladen beim Start ist entfallen — die Grenze wird bei jedem
  // Aufruf gelesen, statt in einen Prozessspeicher kopiert zu werden.
  // Kommentare raus: Die Notiz an der alten Stelle nennt den Namen weiterhin
  // (sie erklärt ja, warum dort nichts mehr steht) — ohne das Ausblenden hielte …
  const server = require('./helpers/sources').serverAll().replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(server, /loadDailyLimitsFromDb\(\)/,
    'Ein In-Memory-Limit muss nicht mehr geladen werden');
});

test('ein geändertes Limit gilt sofort in ALLEN Workern', () => {
  // Vorher: PUT /api/v1/admin/api-limits rief setMax() auf — das galt nur im
  // Worker, der die Anfrage bearbeitet hat. Die übrigen liefen bis zum
  // Neustart mit dem alten Wert weiter, und beim Start musste
  // loadDailyLimitsFromDb() den Wert in jeden Prozess kopieren.
  const admin = fs.readFileSync(path.join(ROOT, 'routes/api_v1/admin.ts'), 'utf8')
    .replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(admin, /setMax\(/,
    'setMax() erreicht nur den eigenen Prozess');
  // Kommentare raus, bevor die Spanne gemessen wird: Der Erklärblock in
  // getLimitForApi ist länger als jedes vernünftige Zeichenfenster, und ein
  // Test, der an einem wachsenden Kommentar scheitert, prüft die falsche Sache.
  const fc = fs.readFileSync(path.join(ROOT, 'src/katalog/apiKontingent.ts'), 'utf8')
    .replace(/\/\/[^\n]*/g, '');
  const fn = fc.slice(fc.indexOf('async function getLimitForApi'),
                      fc.indexOf('const grenzeJeKonto'));
  assert.match(fn, /await getGlobalSetting\(`api_limit_\$\{apiName\}`(?:, '')?\)/,
    'Die Grenze muss bei jedem Aufruf gelesen werden, nicht aus dem Prozessspeicher kommen');
});

test('keine hartkodierten Limitzahlen mehr in Meldungen und Labels', () => {
  // Fundort seit einer früheren Runde: clients/rebrickable.ts. Die Datei enthält keine
  // einzige Route und wurde nie als Router montiert — sie lag nur aus
  // Gewohnheit in routes/. Die Aussage dieser Prüfung ist unverändert.
  const rb = fs.readFileSync(path.join(ROOT, 'clients/rebrickable.ts'), 'utf8');
  const messages = [...rb.matchAll(/Tageslimit[^`'"]*\((\d+)\/Tag\)/g)].map(m => m[1]);
  assert.deepEqual(messages, [],
    `Fest eingetragene Limits in Fehlermeldungen: ${messages.join(', ')} — stattdessen status.max verwenden`);

  const i18n = require('./helpers/sources').i18nAll();
  for (const key of ['monitor.api.rebrickable', 'monitor.api.bricklink', 'monitor.api.brickset']) {
    const vals = [...i18n.matchAll(new RegExp(`'${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}':\\s*'([^']*)'`, 'g'))].map(m => m[1]);
    assert.ok(vals.length > 0, `${key} fehlt in i18n.js`);
    for (const v of vals) {
      assert.doesNotMatch(v, /\d+\s*\/\s*(Tag|day)/,
        `${key} = "${v}" — die Zahl steht schon im Wert darüber und wird hier bei jeder Änderung falsch`);
    }
  }
});

test('das Eingabefeld zeigt denselben Standard an', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const field = html.slice(html.indexOf('id="lim-rb"') - 400, html.indexOf('id="lim-rb"') + 200);
  assert.match(field, new RegExp(`value="${EXPECTED}"`), 'value des Felds #lim-rb passt nicht zum Standard');
  assert.match(field, new RegExp(`"n":"${EXPECTED}"`), 'Der Hinweis "(Standard: …)" passt nicht zum Standard');
});

// ── Punkt 3: Zähler in der Datenbank ───────────────────────────────────────

test('die Login-Zähler liegen nicht mehr im Prozessspeicher', () => {
  const src = require('./helpers/sources').dienstQuelle('src/konto/loginLimiter.ts');
  assert.match(src, /rate_limit_attempts/,
    'Bei N Cluster-Workern werden aus 5 Fehlversuchen sonst N×5');
  assert.match(src, /ON CONFLICT \(key\) DO UPDATE/,
    'Hochzählen muss atomar in einem Statement passieren, sonst lesen parallele Versuche denselben Stand');
  assert.match(src, /CASE WHEN rate_limit_attempts\.first_at < NOW\(\)/,
    'Ein abgelaufenes Fenster muss im selben Statement neu starten');
});

test('bei DB-Ausfall greift die Rückfallebene', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/konto/loginLimiter.ts'), 'utf8');
  for (const fn of ['_read', '_bump', '_clear']) {
    const body = src.slice(src.indexOf(`async function ${fn}(`), src.indexOf(`async function ${fn}(`) + 900);
    // Der Rückfall meldet sich (imSpeicher); der Name der Fehlervariable zählt nicht.
    assert.match(body, /catch \(\w+\) \{\s*imSpeicher\(/,
      `${fn}: ohne Rückfall wäre der Login bei DB-Problemen komplett blockiert`);
  }
  assert.match(src, /const _attempts = new Map/, 'In-Memory-Rückfall fehlt');
});

test('die Aufrufstellen warten auf das Ergebnis', () => {
  // checkLoginAllowed ist seit der Umstellung asynchron — ein vergessenes
  // await liefert ein Promise, das immer truthy ist und JEDEN Login sperrt.
  const dateien = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? dateien(p) : (e.name.endsWith('.ts') ? [p] : []);
  });
  const alle = [...dateien(path.join(ROOT, 'routes')), ...dateien(path.join(ROOT, 'src')),
                path.join(ROOT, 'server.ts')];

  const ohneAwait = [];
  let gefunden = 0;
  for (const datei of alle) {
    const src = ohneKommentare(fs.readFileSync(datei, 'utf8'));
    for (const m of src.matchAll(/\b(checkLoginAllowed|recordLoginFailure|recordLoginSuccess)\s*\(/g)) {
      // Die Zeile selbst ansehen — ein `await` davor genügt. Import und
      // Definition sind keine Aufrufe und zählen nicht mit.
      const zeilenAnfang = src.lastIndexOf('\n', m.index) + 1;
      const zeile = src.slice(zeilenAnfang, src.indexOf('\n', m.index));
      if (/^\s*(import|export)\b/.test(zeile) || /\bfunction\s+\w+\s*\(/.test(zeile)) continue;
      gefunden++;
      if (!new RegExp(`await\\s+${m[1]}\\s*\\(`).test(zeile))
        ohneAwait.push(`${path.relative(ROOT, datei)}: ${zeile.trim()}`);
    }
  }
  // Selbstbeweis: Findet das Muster nichts, wäre die Liste leer und der Test
  // grün, ohne etwas geprüft zu haben.
  assert.ok(gefunden >= 3, `nur ${gefunden} Aufrufe des Anmelde-Zählers gefunden — Muster veraltet?`);
  assert.deepEqual(ohneAwait, [],
    'Diese Aufrufe warten nicht auf den Anmelde-Zähler:\n  ' + ohneAwait.join('\n  ') +
    '\nEin Promise ist immer truthy — ohne await sperrt checkLoginAllowed JEDEN Login.');
});

test('Jobs mit externem Kontingent haben eine prozessübergreifende Sperre', () => {
  // Woher dieser Test kommt
  const job = (fs.readFileSync(path.join(ROOT, 'src/finanzen/preisLauf.ts'), 'utf8') + fs.readFileSync(path.join(ROOT, 'db/txLock.ts'), 'utf8'))
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  assert.match(job, /pg_try_advisory_lock/,
    'Ohne prozessübergreifende Sperre schützt state.running nur den eigenen Worker');
  // Eigene Verbindung, nicht transaktionsgebunden: Der Lauf dauert Minuten.
  assert.match(job, /(?:db|zugang)\.pool\.connect\(\)/,
    'Die Sperre muss über die ganze Laufzeit gehalten werden — eigene Verbindung');
  assert.doesNotMatch(job, /pg_try_advisory_xact_lock/,
    'Eine Transaktion minutenlang offen zu halten wäre der falsche Weg');
  // Freigabe im finally — sonst blockiert ein abgestürzter Lauf alle folgenden.
  const fn = job.slice(job.indexOf('async function runPriceRefresh'),
                       job.indexOf('async function merkeStand'));
  assert.match(fn, /finally\s*\{[\s\S]{0,300}releaseLock\(\)/,
    'Ohne Freigabe im finally sperrt ein Absturz den Job bis zum Neustart');

  // Der manuelle Anstoss zieht nur den geplanten Auftrag vor (src/auftraege/zeitplan.ts);
  // läuft er schon, meldet ziehePlanVor false statt eines zweiten Laufs.

  // Und die Aufrufer müssen das Ergebnis abwarten.
  //
  // Der manuelle Anstoss liegt nur unter /api/v1/admin/trigger-price-job, die
  // Webapp ruft dieselbe Adresse auf: Bei zwei Wegen kann einer das `await`
  // verlieren, ohne dass es auffällt.
  const route = fs.readFileSync(path.join(ROOT, 'routes/api_v1/admin.ts'), 'utf8');
  assert.match(route, /await preisJobJetzt\(\)/,
    'routes/api_v1/admin.ts: ohne await meldet die Route ein Promise als „gestartet"');

  // Der Namensraum kommt aus der gemeinsamen Liste.
  assert.match(job, /LOCKS\.PREIS_JOB/,
    'Der Namensraum gehört aus src/infra/lockNamespaces.ts, nicht eingetippt');
});
