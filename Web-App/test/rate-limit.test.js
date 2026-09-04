/**
 * Tageslimit für Rebrickable-API-Aufrufe.
 *
 * Zwei Dinge waren hier auseinandergelaufen:
 *
 *   1. Der gespeicherte Wert (global_settings.api_limit_rebrickable) wurde
 *      ausschliesslich im PUT-Handler von /api/v1/admin/api-limits per setMax()
 *      in den Limiter geschrieben. Beim Serverstart passierte das nicht — nach
 *      jedem Neustart galt wieder der hartkodierte Konstruktorwert, egal was in
 *      den Einstellungen stand.
 *   2. Die Fehlertexte in clients/rebrickable.ts nannten "100/Tag", während das
 *      tatsächliche Limit längst bei 4000 lag. Gleiches Muster in den
 *      Monitor-Labels (i18n) und im Standardwert des Eingabefelds.
 *
 * Der Test hält Standardwert und Verdrahtung zusammen, damit sie nicht wieder
 * getrennt driften. Ohne DB. Ausführen: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
// Nach dist/ bauen statt in-place — siehe helpers/sources.js.
const _req = require('./helpers/sources').buildAndRequire();
const { ohneKommentare } = require('./helpers/sources');
const { REBRICKABLE_DEFAULT_DAILY, DailyLimiter } = _req('utils/rateLimiter.js');

const EXPECTED = 25000;

test('Standard-Tageslimit ist 25000 — an EINER Stelle', () => {
  assert.equal(REBRICKABLE_DEFAULT_DAILY, EXPECTED);
  // getLimitForApi() hatte eine eigene Kopie des Rückfallwerts (4000). Solange
  // Rebrickable seinen eigenen Zähler hatte, sah es diese Tabelle nie — seit
  // beide über checkAndIncrementRateLimit laufen, wäre es eine stille Kürzung
  // auf ein Sechstel gewesen. Zwei Konstanten mit derselben Bedeutung driften
  // auseinander; hier wird festgehalten, dass es nur noch eine gibt.
  const fc = fs.readFileSync(path.join(ROOT, 'utils', 'financeCalc.ts'), 'utf8');
  assert.match(fc, /rebrickable: REBRICKABLE_DEFAULT_DAILY/,
    'Der Rückfallwert muss aus rateLimiter kommen, nicht als eigene Zahl danebenstehen');
  assert.doesNotMatch(fc, /rebrickable: \d+/, 'Keine zweite Zahl für dasselbe Limit');
});

test('das Tageskontingent zählt für die Installation, nicht je Worker', () => {
  // ── Woher dieser Test kommt ─────────────────────────────────────────────
  // Der Rebrickable-Zähler lag in `this.count` einer DailyLimiter-Instanz —
  // also im Speicher EINES Prozesses. Der Server läuft im Cluster: Jeder
  // Worker legte seine eigene Instanz an und zählte für sich bis zum Limit.
  // Bei WORKERS = max(2, CPU-Kerne) waren auf einem Vierkerner 100'000 Aufrufe
  // möglich, wo 25'000 eingestellt sind. Die DB-Schreibvorgänge täuschten
  // Gemeinsamkeit vor, überschrieben aber nur den Stand des jeweils letzten
  // Workers.
  //
  // Genau dasselbe war beim Login-Zähler schon behoben worden (Test weiter
  // unten: „die Login-Zähler liegen nicht mehr im Prozessspeicher"), und für
  // BrickLink und Brickset war es von Anfang an richtig. Rebrickable war die
  // dritte Instanz desselben Musters.
  //
  // Gegen echte Datenbank nachgestellt: Limit 3, drei Aufrufe erlaubt, der
  // vierte abgelehnt — und ein zweiter Modulzustand (= zweiter Worker) fängt
  // NICHT wieder bei null an.
  const rl = fs.readFileSync(path.join(ROOT, 'utils', 'rateLimiter.ts'), 'utf8');
  assert.match(rl, /async function consumeRebrickableDaily/,
    'Der Verbrauch muss über den gemeinsamen Zähler laufen');
  assert.match(rl, /checkAndIncrementRateLimit\('rebrickable'\)/,
    'Derselbe Mechanismus wie bei BrickLink und Brickset — kein dritter Weg');
  assert.doesNotMatch(rl, /new DailyLimiter\(/,
    'Keine prozesslokale Instanz mehr für ein Tagesbudget');

  // Alle Aufrufstellen gehen über den gemeinsamen Weg.
  for (const datei of ['clients/rebrickable.ts', 'routes/parts.ts',
                       'jobs/partsCatalogEnrich.ts', 'jobs/backfillBlPartNumbers.ts',
                       'jobs/rebrickableCsvSync.ts']) {
    const src = fs.readFileSync(path.join(ROOT, datei), 'utf8');
    assert.doesNotMatch(src, /rebrickableDailyLimiter/,
      `${datei}: zählt noch am gemeinsamen Zähler vorbei`);
  }

  // Und das Nachladen beim Start ist entfallen — die Grenze wird bei jedem
  // Aufruf gelesen, statt in einen Prozessspeicher kopiert zu werden.
  // Kommentare raus: Die Notiz an der alten Stelle nennt den Namen weiterhin
  // (sie erklärt ja, warum dort nichts mehr steht) — ohne das Ausblenden hielte
  // der Test den Kommentar für den Aufruf. Dieselbe Falle wie schon zweimal
  // zuvor in dieser Suite.
  const server = require('./helpers/sources').serverAll().replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(server, /loadDailyLimitsFromDb\(\)/,
    'Ein In-Memory-Limit muss nicht mehr geladen werden');
});

test('Seed und Migration setzen denselben Wert', () => {
  const dbts = fs.readFileSync(path.join(ROOT, 'db', 'database.ts'), 'utf8');
  assert.match(dbts, new RegExp(`'api_limit_rebrickable',\\s*'${EXPECTED}'`),
    `Der Seed für Neuinstallationen muss auf ${EXPECTED} stehen`);
  assert.match(dbts, new RegExp(`UPDATE global_settings SET value = '${EXPECTED}'[\\s\\S]*?api_limit_rebrickable`),
    'Bestandsinstallationen brauchen die Migration — ON CONFLICT DO NOTHING lässt den alten Seed sonst stehen');
  // Jeder frühere Standard muss in der Migration stehen, sonst bleibt eine
  // Installation je nach zuletzt gelaufener Version auf einem Zwischenwert hängen.
  for (const old of ['4000', '10000'])
    assert.match(dbts, new RegExp(`IN \\([^)]*'${old}'`),
      `Früherer Standard ${old} fehlt in der Migration`);
});

test('ein geändertes Limit gilt sofort in ALLEN Workern', () => {
  // Vorher: PUT /api/v1/admin/api-limits rief setMax() auf — das galt nur im
  // Worker, der die Anfrage bearbeitet hat. Die übrigen liefen bis zum
  // Neustart mit dem alten Wert weiter, und beim Start musste
  // loadDailyLimitsFromDb() den Wert in jeden Prozess kopieren.
  //
  // Jetzt liest getLimitForApi() die Grenze bei jedem Aufruf aus
  // global_settings — kein Kopieren, kein Nachziehen, keine Abweichung
  // zwischen Workern.
  const admin = fs.readFileSync(path.join(ROOT, 'routes', 'api_v1', 'admin.ts'), 'utf8')
    .replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(admin, /setMax\(/,
    'setMax() erreicht nur den eigenen Prozess');
  // Kommentare raus, bevor die Spanne gemessen wird: Der Erklärblock in
  // getLimitForApi ist länger als jedes vernünftige Zeichenfenster, und ein
  // Test, der an einem wachsenden Kommentar scheitert, prüft die falsche Sache.
  const fc = fs.readFileSync(path.join(ROOT, 'utils', 'financeCalc.ts'), 'utf8')
    .replace(/\/\/[^\n]*/g, '');
  const fn = fc.slice(fc.indexOf('async function getLimitForApi'),
                      fc.indexOf('async function getRateLimitStatus'));
  // Der Zugriff läuft inzwischen über utils/settings.ts statt über eine eigene
  // SQL-Anweisung. Die Aussage bleibt: Die Grenze wird IM AUFRUF geholt.
  assert.match(fn, /await getGlobalSetting\(`api_limit_\$\{apiName\}`\)/,
    'Die Grenze muss bei jedem Aufruf gelesen werden, nicht aus dem Prozessspeicher kommen');
});

test('keine hartkodierten Limitzahlen mehr in Meldungen und Labels', () => {
  // Fundort seit Nachtrag 126: clients/rebrickable.ts. Die Datei enthält keine
  // einzige Route und wurde nie als Router montiert — sie lag nur aus
  // Gewohnheit in routes/. Die Aussage dieser Prüfung ist unverändert.
  const rb = fs.readFileSync(path.join(ROOT, 'clients', 'rebrickable.ts'), 'utf8');
  const messages = [...rb.matchAll(/Tageslimit[^`'"]*\((\d+)\/Tag\)/g)].map(m => m[1]);
  assert.deepEqual(messages, [],
    `Fest eingetragene Limits in Fehlermeldungen: ${messages.join(', ')} — stattdessen status.max verwenden`);

  const i18n = require('./helpers/sources').i18nAll();
  for (const key of ['monitor.api.rebrickable', 'monitor.api.bricklink', 'monitor.api.brickset']) {
    const vals = [...i18n.matchAll(new RegExp(`'${key.replace(/\./g, '\\.')}':\\s*'([^']*)'`, 'g'))].map(m => m[1]);
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

test('DailyLimiter zählt und sperrt korrekt', () => {
  const l = new DailyLimiter(3);
  assert.equal(l.status.remaining, 3);
  assert.ok(l.tryConsume() && l.tryConsume() && l.tryConsume());
  assert.equal(l.tryConsume(), false, 'über dem Limit muss tryConsume false liefern');
  assert.equal(l.status.count, 3);
  assert.equal(l.status.remaining, 0);
  // Tageswechsel setzt zurück
  l.date = '2000-01-01';
  assert.equal(l.status.remaining, 3);
  assert.ok(l.tryConsume());
});

test('setMax wirkt sofort auf laufende Zählung', () => {
  const l = new DailyLimiter(1);
  assert.ok(l.tryConsume());
  assert.equal(l.tryConsume(), false);
  l.setMax(5);
  assert.ok(l.tryConsume(), 'nach Anhebung muss der Rest des Tages wieder verfügbar sein');
});

// ── Punkt 3: Zähler in der Datenbank ───────────────────────────────────────

test('die Login-Zähler liegen nicht mehr im Prozessspeicher', () => {
  const src = fs.readFileSync(path.join(ROOT, 'utils', 'loginLimiter.ts'), 'utf8');
  assert.match(src, /rate_limit_attempts/,
    'Bei N Cluster-Workern werden aus 5 Fehlversuchen sonst N×5');
  assert.match(src, /ON CONFLICT \(key\) DO UPDATE/,
    'Hochzählen muss atomar in einem Statement passieren, sonst lesen parallele Versuche denselben Stand');
  assert.match(src, /CASE WHEN rate_limit_attempts\.first_at < NOW\(\)/,
    'Ein abgelaufenes Fenster muss im selben Statement neu starten');
});

test('bei DB-Ausfall greift die Rückfallebene', () => {
  const src = fs.readFileSync(path.join(ROOT, 'utils', 'loginLimiter.ts'), 'utf8');
  for (const fn of ['_read', '_bump', '_clear']) {
    const body = src.slice(src.indexOf(`async function ${fn}(`), src.indexOf(`async function ${fn}(`) + 900);
    assert.match(body, /catch \(_\)/,
      `${fn}: ohne Rückfall wäre der Login bei DB-Problemen komplett blockiert`);
  }
  assert.match(src, /const _attempts = new Map/, 'In-Memory-Rückfall fehlt');
});

test('die Tabelle wird beim Schema-Aufbau angelegt', () => {
  const dbts = fs.readFileSync(path.join(ROOT, 'db', 'database.ts'), 'utf8');
  assert.match(dbts, /CREATE TABLE IF NOT EXISTS rate_limit_attempts/, 'Tabelle fehlt im Schema');
  assert.match(dbts, /key      TEXT PRIMARY KEY/, 'der Schlüssel muss Primärschlüssel sein');
});

test('die Aufrufstellen warten auf das Ergebnis', () => {
  // checkLoginAllowed ist seit der Umstellung asynchron — ein vergessenes
  // await liefert ein Promise, das immer truthy ist und JEDEN Login sperrt.
  //
  // Hier standen zwei Dateinamen. Das ging gut, solange die Anmeldung an genau
  // diesen zwei Stellen stand; als sie in utils/auth.ts zusammengezogen wurde,
  // prüfte der Test Dateien, in denen es nichts mehr zu prüfen gab, und
  // meldete das Zusammenlegen als Fehler. Gesucht wird deshalb im Baum.
  const dateien = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? dateien(p) : (e.name.endsWith('.ts') ? [p] : []);
  });
  const alle = [...dateien(path.join(ROOT, 'routes')), ...dateien(path.join(ROOT, 'utils')),
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
  // ── Woher dieser Test kommt ─────────────────────────────────────────────
  // Der Preis-Job schützte sich mit `state.running` — einer Variablen im
  // Speicher EINES Prozesses. Geplant lief er nur im Primary-Worker, aber die
  // beiden manuellen Auslöser (POST /api/finance/job-trigger und
  // POST /api/v1/admin/trigger-price-job) laufen in dem Worker, der die
  // Anfrage bearbeitet. Dort war state.running false — also startete ein
  // vollständiger Lauf über alle Sets, unabhängig davon, ob im Primary gerade
  // einer lief. Zwei Klicks auf verschiedenen Workern ergaben zwei komplette
  // Durchgänge, jeder mit eigenen BrickLink-Aufrufen, und beide schrieben in
  // dasselbe Fortschrittsfeld.
  //
  // Mit einem ECHTEN zweiten Prozess nachgestellt (eigener Speicher,
  // state.running dort false): mit Sperre wird er abgewiesen, ohne Sperre
  // startet er mit.
  //
  // Das war die vierte Instanz desselben Musters — nach Login-Zähler,
  // Bild-Cache-Aufräumlauf und Rebrickable-Tageskontingent. Deshalb prüft
  // dieser Test die REGEL: Wer ein externes Kontingent verbraucht und aus
  // einer Route angestossen werden kann, braucht mehr als eine Variable im
  // Prozessspeicher.
  // Kommentare raus, BEVOR geprüft wird: Der Erklärtext in priceJob.ts nennt
  // pg_try_advisory_xact_lock (als das, was dort bewusst NICHT benutzt wird) —
  // ohne das Ausblenden schlüge die Prüfung darauf am Kommentar an. Dieselbe
  // Falle wie mehrfach zuvor in dieser Suite; sie ist der häufigste Fehler
  // beim Schreiben quelltextlesender Tests.
  const job = fs.readFileSync(path.join(ROOT, 'jobs', 'priceJob.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  assert.match(job, /pg_try_advisory_lock/,
    'Ohne prozessübergreifende Sperre schützt state.running nur den eigenen Worker');
  // Eigene Verbindung, nicht transaktionsgebunden: Der Lauf dauert Minuten.
  assert.match(job, /db\.pool\.connect\(\)/,
    'Die Sperre muss über die ganze Laufzeit gehalten werden — eigene Verbindung');
  assert.doesNotMatch(job, /pg_try_advisory_xact_lock/,
    'Eine Transaktion minutenlang offen zu halten wäre der falsche Weg');
  // Freigabe im finally — sonst blockiert ein abgestürzter Lauf alle folgenden.
  const fn = job.slice(job.indexOf('async function runPriceRefresh'),
                       job.indexOf('function scheduleNext'));
  assert.match(fn, /finally\s*\{[\s\S]{0,300}releaseLock\(\)/,
    'Ohne Freigabe im finally sperrt ein Absturz den Job bis zum Neustart');

  // Der manuelle Anstoss muss die Sperre SELBST holen — sonst meldet die Route
  // „gestartet", während anderswo längst ein Lauf läuft.
  const trigger = job.slice(job.indexOf('async function triggerNow'),
                            job.indexOf('export {'));
  assert.match(trigger, /await acquireRunLock\(\)/,
    'triggerNow muss die Sperre holen, bevor es Erfolg meldet');

  // Und die Aufrufer müssen das Ergebnis abwarten.
  //
  // routes/finance.ts fällt mit Etappe 7 weg: Der manuelle Anstoss liegt nur
  // noch unter /api/v1/admin/trigger-price-job, die Webapp ruft dieselbe
  // Adresse auf. Vorher gab es ihn zweimal — genau die Doppelung, bei der eine
  // Seite das `await` verlieren kann, ohne dass es auffällt.
  for (const datei of ['routes/api_v1/admin.ts']) {
    const src = fs.readFileSync(path.join(ROOT, datei), 'utf8');
    assert.match(src, /await triggerNow\(\)/,
      `${datei}: ohne await meldet die Route ein Promise als „gestartet"`);
  }

  // Der Namensraum kommt aus der gemeinsamen Liste.
  //
  // Hier stand bis Nachtrag 149 eine von Hand gepflegte Abschrift:
  //     const belegt = ['42', '77', '11223344', '99999999'];
  // Sie kannte 55, 56, 57 und 58 nicht, obwohl es alle vier längst gab — eine
  // Kollision mit dreien davon wäre durchgegangen, und der Test wäre dabei
  // grün geblieben. Dass die Namensräume sich wirklich nicht behindern, misst
  // jetzt test/lock-namespaces-db.test.js gegen eine echte Datenbank.
  assert.match(job, /LOCKS\.PREIS_JOB/,
    'Der Namensraum gehört aus utils/lockNamespaces.ts, nicht eingetippt');
});
