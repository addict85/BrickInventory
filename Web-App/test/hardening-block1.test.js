/**
 * Block 1 der Optimierungsliste: Punkte 1, 3, 5 und 6.
 *
 * 1 — Session-Rotation beim Login (Session Fixation)
 * 3 — Rate-Limits worker-übergreifend statt pro Prozess
 * 5 — Vorschaubilder in allen Listenansichten
 * 6 — avg_price statt qty_avg_price in den Teile- und Minifiguren-Pfaden
 *
 * Ausführen: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

// ── Punkt 1 ────────────────────────────────────────────────────────────────
test('die Session-ID wird beim Anmelden erneuert', () => {
  const auth = read('utils/auth.ts');
  assert.match(auth, /function establishSession/, 'Der gemeinsame Helfer fehlt');
  assert.match(auth, /req\.session\.regenerate\(/,
    'Ohne regenerate() behält der Browser die ID von vor dem Login (Session Fixation)');
  assert.match(auth, /req\.session\.save\(/,
    'Ohne save() wäre die neue ID bei einer unmittelbar folgenden Anfrage noch nicht gültig');

  const routes = read('routes/auth.ts');
  // Drei Aufrufe: Login, QR-Login — und seit der Sitzungs-Bereinigung auch
  // /change-password. Dort werden erst ALLE Sitzungen des Kontos verworfen
  // (ein Passwortwechsel soll einen fremden Zugang beenden, nicht nur die
  // Tokens) und danach die eigene neu aufgebaut, damit man nicht aus dem
  // eigenen Tab fliegt. Die neue ID ist dabei erwünscht, nicht Nebensache.
  assert.equal((routes.match(/establishSession\(req,/g) || []).length, 3,
    'Login, QR-Login und Passwortwechsel müssen die Session erneuern');
  assert.doesNotMatch(routes, /req\.session\.userId\s*=\s*parseInt/,
    'Kein direktes Setzen mehr — das umginge die Rotation');
});

// ── Punkt 3 ────────────────────────────────────────────────────────────────
test('Rate-Limits zählen worker-übergreifend', () => {
  // Die Tabelle heisst rate_limit_attempts, nicht rate_counters.
  //
  // Der Test prüfte bis hierher gegen einen Entwurf, den es im Code nie gab —
  // rate_counters wurde zwar angelegt, aber von keiner Abfrage benutzt (die
  // CREATE-Anweisung ist inzwischen entfernt). Geprüft wird jetzt, was die
  // Implementierung tatsächlich zusichert: Zähler in der Datenbank, atomares
  // Hochzählen in einem Statement, Rückfall auf den Prozessspeicher.
  const lim = read('utils/loginLimiter.ts');
  assert.match(lim, /rate_limit_attempts/, 'Der Zähler muss in der Datenbank liegen');
  assert.match(lim, /ON CONFLICT \(key\) DO UPDATE/,
    'Hochzählen und Fensterwechsel gehören in EIN Statement');
  assert.match(lim, /Rückfallebene, falls die DB klemmt/,
    'Ein Datenbankfehler darf den Login nicht blockieren');

  const db = read('db/database.ts');
  assert.match(db, /CREATE TABLE IF NOT EXISTS rate_limit_attempts/, 'Die Tabelle wird nicht angelegt');
  assert.doesNotMatch(db, /CREATE TABLE IF NOT EXISTS rate_counters/,
    'rate_counters ist tot und darf nicht neu angelegt werden');
});

// ── Punkt 5 ────────────────────────────────────────────────────────────────
test('Listenansichten fordern Vorschaubilder an', () => {
  // Volle Auflösung bei 36–100 px Anzeigegrösse war der Grund, warum die
  // Kacheln sichtbar nachtröpfelten.
  for (const f of ['public/js/03-parts.js', 'public/js/04-finance.js',
                   'public/js/06-minifigs.js', 'public/js/08-init.js']) {
    assert.match(read(f), /imgUrl\([\s\S]{0,120}?,\s*true\)/,
      `${f}: keine Vorschau angefordert`);
  }
  assert.match(require('./helpers/sources').coreQuelle(), /thumb \? '&thumb=1' : ''/,
    'imgUrl() reicht den Wunsch nicht an den Proxy weiter');
  assert.match(require('./helpers/sources').serverAll(), /req\.query\.thumb === '1'/,
    'Der Proxy kennt kein thumb=1');
});

// ── Punkt 6 ────────────────────────────────────────────────────────────────
test('Teile- und Minifiguren-Preise lesen avg_price', () => {
  // routes/finance.ts ist entfallen: Der Router trug NULL Routen und war
  // trotzdem unter /api/finance eingehaengt (siehe server.ts).
  for (const f of ['routes/minifigs.ts', 'routes/parts.ts',
                   'routes/api_v1/sets.ts']) {
    const src = read(f);
    // Lesende Zugriffe: kein qty_avg_price mehr. Schreibende (INSERT/VALUES)
    // und Feldnamen in Antwortobjekten bleiben — der Wert wird weiter gepflegt.
    for (const m of src.matchAll(/parseFloat\(([^)]*qty_avg_price[^)]*)\)/g)) {
      assert.fail(`${f}: liest noch qty_avg_price → ${m[1].slice(0, 60)}`);
    }
    for (const m of src.matchAll(/SELECT([^;`]{0,160}?)FROM\s+(part_price_cache|minifig_price_cache|price_history)/g)) {
      assert.doesNotMatch(m[1], /qty_avg_price/,
        `${f}: Preisabfrage liest noch qty_avg_price`);
    }
  }
});

test('Preis-Vorhandensein hängt an avg_price', () => {
  const fc = read('utils/financeCalc.ts');
  // Die Aussage ist unverändert: Ein Datensatz mit avg_price = 0 darf nicht
  // als „hat einen Preis" durchgehen, sonst steht überall 0.
  //
  // Gezählt wurden dafür früher fünf Vorkommen von `pd.avg_price > 0` — Sets,
  // Teile und Minifiguren, je Haupt- und Rückfall-Zustand. Die gibt es nicht
  // mehr: Dieselbe Frage stand in dieser Datei an 22 Stellen, in drei
  // Fassungen, und widersprach dabei der Fassung in clients/bricklink.ts.
  // Sie liegt jetzt einmal in utils/preisRegel.ts (siehe
  // test/preisregel-db.test.js). Gezählt werden deshalb die Stellen, die sie
  // BENUTZEN — die Zahl bleibt die Zusicherung, dass keine davon verschwindet.
  assert.doesNotMatch(fc, /avg_price > 0 \|\| \w+\.qty_avg_price > 0/,
    'Ein Datensatz mit avg_price = 0 ginge sonst als "hat einen Preis" durch und ergäbe überall 0');
  assert.ok((fc.match(/\bhatPreis\(/g) || []).length >= 5,
    'Alle Preis-Vorhandensein-Prüfungen müssen über dieselbe Regel laufen');
  assert.match(fc, /from '\.\/preisRegel'/,
    'und zwar über die eine, die auch clients/bricklink.ts anwendet');
});

test('nur eine Stelle entscheidet, wo ein Token in der URL reiten darf', () => {
  // ── Woher dieser Test kommt ─────────────────────────────────────────────
  // utils/auth.ts führt eine Liste der Pfade, auf denen ?token= zählt, und
  // schreibt dazu: „alles andere verlangt einen Authorization-Header". Das
  // stimmte nicht — routes/sets.ts hatte eine ZWEITE Fassung von
  // requireLoginOrToken, die ?token= bedingungslos akzeptierte (für den
  // SSE-Fortschritt des CSV-Imports; EventSource kann keine Kopfzeilen
  // setzen). Der Bedarf ist echt, die zweite Fassung war es nicht: Wer in
  // utils/auth.ts nachliest, bekam eine unvollständige Antwort.
  const auth = read('utils/auth.ts');
  const sets = require('./helpers/sources').setKernQuelle();

  // ── Nicht der NAME, sondern der PFAD ─────────────────────────────────────
  //
  // Hier stand `auth.includes("import\\/csv\\/(stream|status)")` — eine
  // Teilzeichenkette. Der Eintrag lautete `/api/sets/import/csv/…`, die Route
  // war laengst nach `/api/v1/sets/…` umgezogen, und dieser Vergleich sah den
  // Praefix gar nicht. Der Rueckfall auf `?token=` war damit wirkungslos, und
  // die Pruefung blieb gruen.
  //
  // Jetzt wird die Liste AUSGEWERTET und gegen den WIRKLICHEN Einhaengepunkt
  // aus server.ts gehalten. Zieht die Route wieder um, faellt der Test.
  const { einhaengung } = require('./helpers/sources');
  const listeRoh = auth.slice(auth.indexOf('const TOKEN_QUERY_ALLOWED'),
                              auth.indexOf('];', auth.indexOf('const TOKEN_QUERY_ALLOWED')));
  const muster = [...listeRoh.matchAll(/^\s*\/(\^[^\n]*?)\/[gimsuy]*\s*,\s*$/gm)]
    .map(m => new RegExp(m[1]));
  assert.ok(muster.length >= 3,
    `Nur ${muster.length} Muster aus TOKEN_QUERY_ALLOWED gelesen — Format veraltet?`);
  for (const pfad of ['/import/csv/stream', '/import/csv/status']) {
    const voll = einhaengung('sets') + pfad;
    assert.ok(muster.some(re => re.test(voll)),
      `${voll} steht nicht in TOKEN_QUERY_ALLOWED. EventSource kann keine ` +
      'Kopfzeilen setzen; ohne diesen Eintrag faellt der Fortschritt eines ' +
      'Imports still auf 401, sobald nur ein Bearer-Token da ist.');
  }
  // Und die Gegenrichtung: Die Liste bleibt eng. Eine normale Adresse darf
  // NICHT durchrutschen — sonst reicht ein Token in der URL ueberall, und
  // Adressen landen in Server-Protokollen und im Verlauf des Browsers.
  for (const voll of [einhaengung('sets') + '/1234-1', einhaengung('auth') + '/login'])
    assert.ok(!muster.some(re => re.test(voll)),
      `${voll} akzeptiert ein Token in der URL — die Liste ist zu weit.`);
  assert.doesNotMatch(sets, /function requireLoginOrToken/,
    'Keine zweite Fassung — sie umgeht die Liste in utils/auth.ts');
  assert.match(sets, /loginOrTokenGuard\(\{ timeoutMs: 3000 \}\)/,
    'Das 3s-Zeitlimit muss bleiben: Während eines Imports ist 503 besser als eine hängende Verbindung');

  // Die Liste bleibt eng: Wer sie erweitert, soll darüber stolpern.
  const liste = auth.slice(auth.indexOf('const TOKEN_QUERY_ALLOWED'),
                           auth.indexOf('];', auth.indexOf('const TOKEN_QUERY_ALLOWED')));
  const eintraege = (liste.match(/\/\^/g) || []).length;
  assert.equal(eintraege, 3,
    'Erlaubte Pfade: img-proxy, /data/, CSV-Fortschritt — mehr braucht es nicht');
});

test('offene Ereignis-Ströme halten das Herunterfahren nicht auf', () => {
  // ── Woher dieser Test kommt ─────────────────────────────────────────────
  // shutdown() wartete auf httpServer.close(). Dessen Rückruf kommt erst,
  // wenn die LETZTE Verbindung weg ist — und ein SSE-Strom geht von sich aus
  // nie weg. Jeder Neustart lief deshalb in die Frist von acht Sekunden und
  // endete über die Reissleine mit process.exit(1): Für Docker sah jedes
  // Deploy aus wie ein Absturz.
  //
  // Der Kommentar dort nannte das einen Ausnahmefall („bleibt eine Verbindung
  // hängen"). Es war der Regelfall — der Fortschrittskanal der Webapp bleibt
  // ausdrücklich dauerhaft offen, auch wenn gar kein Import läuft.
  //
  // Nachgemessen: ohne Registry kam close() nie zurück, mit ihr nach 2 ms.
  // Reine Keep-Alive-Verbindungen brauchen das NICHT — die beendet Node beim
  // Schliessen des Servers von selbst.
  const server = read('server.ts');
  assert.match(server, /closeAllSse\(\)/, 'Die Ströme müssen vor close() beendet werden');
  const idxClose = server.indexOf('closeAllSse()');
  const idxWait  = server.indexOf('httpServer.close(');
  assert.ok(idxClose > 0 && idxClose < idxWait,
    'Erst die Ströme beenden, DANN auf close() warten — umgekehrt wartet man vergeblich');

  // Die Reissleine ist eine Notbremse, kein Fehler.
  const fn = server.slice(server.indexOf('async function shutdown'),
                          server.indexOf("process.on('SIGTERM'"));
  assert.match(fn, /Frist abgelaufen[\s\S]{0,400}?process\.exit\(0\)/,
    'Ein erzwungenes Beenden nach Ablauf der Frist ist kein Fehlschlag');

  // Alle drei SSE-Routen melden sich an — eine vergessene hält wieder auf.
  for (const datei of ['routes/sets.ts', 'routes/api_v1/pdf.ts']) {
    assert.match(read(datei), /registerSse\(res\)/, `${datei}: Strom nicht angemeldet`);
  }
  assert.equal((require('./helpers/sources').setKernQuelle().match(/registerSse\(res\)/g) || []).length, 2,
    'sets.ts hat ZWEI Ströme: CSV-Fortschritt und add-stream');
});

test('den Preis-Cache leert nur, wer Administrator ist', () => {
  // ── Woher dieser Test kommt ─────────────────────────────────────────────
  // POST /api/settings/import führte am Ende ein unbedingtes
  // `DELETE FROM price_cache` aus — der Router trägt aber nur requireLogin.
  // Jedes Konto, auch ein Unterkonto im Haushalt, konnte damit eine
  // Ein-Zeilen-Datei ({"user_settings":{"currency":"CHF"}}) hochladen und den
  // Preis-Cache der GANZEN Installation leeren. Beliebig oft. Der nächste
  // Bewertungslauf holt dann alle Preise neu bei BrickLink, und deren
  // Tageskontingent ist endlich.
  //
  // Dieselbe Lücke war in routes/finance.ts schon einmal geschlossen worden
  // (POST /refresh trägt seitdem requireAdmin, mit einer Notiz über das
  // verbrannte Kontingent). Der Import-Weg wurde übersehen — er sieht ja auch
  // nicht nach „Cache leeren" aus. Genau deshalb prüft dieser Test die REGEL
  // und nicht eine einzelne Route: Wer den Cache leert, braucht requireAdmin.
  const dateien = ['routes/settings.ts', 'routes/sets.ts',
                   'routes/parts.ts', 'routes/minifigs.ts', 'clients/bricklink.ts'];
  const treffer = [];
  for (const datei of dateien) {
    const src = read(datei).replace(/\/\/[^\n]*/g, '');   // Kommentare zitieren die alte Zeile
    src.split('\n').forEach((zeile, i) => {
      if (!/DELETE FROM price_cache/.test(zeile)) return;
      // Die Route, zu der die Zeile gehört: nach oben bis zum letzten router.*
      const davor = src.split('\n').slice(0, i + 1).reverse();
      const route = davor.find(l => /router\.(get|post|put|delete)\(/.test(l)) || '';
      if (!/requireAdmin/.test(route)) treffer.push(`${datei}:${i + 1}`);
    });
  }
  assert.deepEqual(treffer, [],
    `Cache-Leerung ohne requireAdmin: ${treffer.join(', ')} — damit lässt sich ` +
    'das BrickLink-Kontingent der Installation von aussen verbrennen');
});

test('ein Währungswechsel braucht keine Cache-Leerung', () => {
  // Die Begründung, warum die Zeile im Import ERSATZLOS entfallen ist und
  // nicht bloss hinter isAdmin gewandert ist: price_cache ist über
  // set_number, condition UND currency_code verschlüsselt. Einträge in der
  // alten Währung passen nach einem Wechsel schlicht nicht mehr auf die
  // Abfrage, und für die neue wird ohnehin frisch geholt.
  //
  // Bricht jemand diese Eigenschaft (eine Abfrage ohne currency_code), wäre
  // die Zeile plötzlich wieder nötig — dann soll hier etwas rot werden.
  const leser = ['utils/financeCalc.ts', 'utils/portfolioHistory.ts',
                 'utils/priceHistory.ts', 'utils/setValue.ts', 'routes/sets.ts'];
  for (const datei of leser) {
    const src = read(datei);
    let i = src.indexOf('FROM price_cache');
    while (i !== -1) {
      // Die WHERE-Klausel steht innerhalb der nächsten paar Zeilen.
      const block = src.slice(i, i + 400);
      assert.match(block, /currency_code/,
        `${datei}: Abfrage auf price_cache ohne currency_code — dann mischen sich Währungen`);
      i = src.indexOf('FROM price_cache', i + 1);
    }
  }
});
