/**
 * Block 1 der Optimierungsliste: Punkte 1, 3, 5 und 6.
 * Ausführlich: docs/begruendungen/test/hardening-block1.test.js.md#kopf
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
// ── Punkt 1 ────────────────────────────────────────────────────────────────
test('die Session-ID wird beim Anmelden erneuert', () => {
  const auth = read('src/konto/http/anmeldung.ts');
  assert.match(auth, /function establishSession/, 'Der gemeinsame Helfer fehlt');
  assert.match(auth, /req\.session\.regenerate\(/,
    'Ohne regenerate() behält der Browser die ID von vor dem Login (Session Fixation)');
  assert.match(auth, /req\.session\.save\(/,
    'Ohne save() wäre die neue ID bei einer unmittelbar folgenden Anfrage noch nicht gültig');

  const routes = require('./helpers/sources').anmeldeQuelle();
  // Zwei Aufrufe: angemeldetAntworten() (Login und Passkey-Anmeldung) und
  // /change-password, das nach dem Verwerfen aller Sitzungen die eigene neu
  // aufbaut. Ob die Passkey-Anmeldung wirklich eine Sitzung bekommt, prüft
  // passkeys-db.test.js über das Cookie.
  assert.equal((routes.match(/establishSession\(req,/g) || []).length, 2,
    'Anmeldung und Passwortwechsel müssen die Session erneuern');
  const helfer = routes.slice(routes.indexOf('async function angemeldetAntworten'), routes.indexOf("router.post('/login'"));
  assert.match(helfer, /establishSession\(req,/, 'der gemeinsame Anmeldeweg erneuert die Session nicht');
  for (const route of ["router.post('/login'", "router.post('/passkey/anmelden',"]) {
    const rumpf = routes.slice(routes.indexOf(route)).split(/\n\}\);\n/)[0];
    assert.match(rumpf, /angemeldetAntworten\(req, res,/, `${route} geht nicht über den gemeinsamen Anmeldeweg`);
  }
  // Der QR-Login legt seit den Token-Scopes KEINE Sitzung mehr an (sie trüge
  // die vollen Rechte an Scope `app` vorbei) — geprüft im Verhalten in
  // token-scope-rotation-db („Scope app: …“, kein Set-Cookie).
  assert.doesNotMatch(routes, /req\.session\.userId\s*=\s*parseInt/,
    'Kein direktes Setzen mehr — das umginge die Rotation');
});

// ── Punkt 3 ────────────────────────────────────────────────────────────────
test('Rate-Limits zählen worker-übergreifend', () => {
  // Die Tabelle heisst rate_limit_attempts, nicht rate_counters.
  // Ausführlich: docs/begruendungen/test/hardening-block1.test.js.md#lim-stelle
  const lim = require('./helpers/sources').dienstQuelle('src/konto/loginLimiter.ts');
  assert.match(lim, /rate_limit_attempts/, 'Der Zähler muss in der Datenbank liegen');
  assert.match(lim, /ON CONFLICT \(key\) DO UPDATE/,
    'Hochzählen und Fensterwechsel gehören in EIN Statement');
  assert.match(lim, /const _attempts = new Map/,
    'Ein Datenbankfehler darf den Login nicht blockieren');

  // Dass die Tabelle angelegt wird, prüft schema-basis-db.test.js am Schema.
  assert.doesNotMatch(read('db/basis.sql'), /rate_counters/,
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
  for (const f of ['src/figuren/manuelleFiguren.ts', 'src/teile/manuelleTeile.ts',
                   'routes/api_v1/sets.ts', 'src/sets/dienst.ts']) {
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
  const fc = require('./helpers/sources').finanzQuelle();
  // Die Aussage ist unverändert: Ein Datensatz mit avg_price = 0 darf nicht
  // als „hat einen Preis" durchgehen, sonst steht überall 0.
  // Ausführlich: docs/begruendungen/test/hardening-block1.test.js.md#stelle
  assert.doesNotMatch(fc, /avg_price > 0 \|\| \w+\.qty_avg_price > 0/,
    'Ein Datensatz mit avg_price = 0 ginge sonst als "hat einen Preis" durch und ergäbe überall 0');
  assert.ok((fc.match(/\bhatPreis\(/g) || []).length >= 5,
    'Alle Preis-Vorhandensein-Prüfungen müssen über dieselbe Regel laufen');
  // Die Regel meint die HERKUNFT, nicht die Verzeichnistiefe.
  assert.match(fc, /hatPreis \} from '(?:\.\.\/)+katalog\/bricklinkPreise'/,
    'und zwar über die eine, die auch clients/bricklink.ts anwendet');
});

test('kein Token reitet mehr in der Adresszeile', () => {
  // Woher dieser Test kommt
  // Ausführlich: docs/begruendungen/test/hardening-block1.test.js.md#stelle-2
  const { ohneKommentare, setKernQuelle, coreQuelle } = require('./helpers/sources');
  const auth = ohneKommentare(read('src/konto/auth.ts') + read('src/konto/http/anmeldung.ts'));

  assert.doesNotMatch(auth, /TOKEN_QUERY_ALLOWED/,
    'Die Ausnahmeliste ist zurueck — damit auch der Sitzungstoken in der Adresszeile');
  assert.doesNotMatch(auth, /req\.query[.?]*[.[]\s*'?token/,
    'resolveUserId liest wieder aus der Query. Auf jeder Route zaehlt der ' +
    'Authorization-Kopf oder die Sitzung, sonst nichts.');

  // Und die Aufrufer
  // Ausführlich: docs/begruendungen/test/hardening-block1.test.js.md#anhaengen
  const anhaengen = [
    // Javascript:  '?token=' + irgendwas
    { re: /'\?token='\s*\+/, wo: 'Javascript' },
    // Kotlin:      "…?token=$feld"
    { re: /\?token=\$/,      wo: 'Kotlin' },
  ];
  const quellen = [
    ...['public/js/01-api.js', 'public/js/01-bilder.js', 'public/js/01-fortschritt.js', 'public/js/01-monitor.js',
        'public/js/02-gallery.js', 'public/js/05-settings.js']
      .map(f => [f, read(f)]),
    // Jeder Dateiname AUSGESCHRIEBEN, nicht ueber eine Schleifenvariable
    // zusammengesetzt: test/baumbruecken.test.js loest die Bruecken in den
    // Android-Baum statisch auf und kann ein variables Segment nicht sehen.
    // Der erste Entwurf dieser Stelle hatte genau das — und wurde von jener
    // Pruefung prompt als „nicht aufloesbar" gemeldet.
    ...[path.join(__dirname, '..', '..', 'Android-App', 'feature-sammlung', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'sammlung', 'ui', 'screens', 'SetDetailSections.kt'),
        path.join(__dirname, '..', '..', 'Android-App', 'feature-sammlung', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'sammlung', 'ui', 'screens', 'SetDetailScreen.kt'),
        path.join(__dirname, '..', '..', 'Android-App', 'feature-finanzen', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'finanzen', 'ui', 'screens', 'PdfViewerScreen.kt'),
        // Geladen wird seit dem Umbau auf ein ViewModel hier, nicht mehr im Bildschirm.
        path.join(__dirname, '..', '..', 'Android-App', 'feature-finanzen', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'finanzen', 'ui', 'pdf', 'AnleitungsLader.kt')]
      .map(voll => {
        assert.ok(fs.existsSync(voll),
          `${path.basename(voll)} steht nicht mehr dort — Pfad im Test veraltet`);
        return [path.basename(voll), fs.readFileSync(voll, 'utf8')];
      }),
  ];
  for (const [name, roh] of quellen) {
    const src = ohneKommentare(roh);
    for (const { re, wo } of anhaengen)
      assert.doesNotMatch(src, re,
        `${name} haengt wieder einen Token an eine Adresse (${wo}-Form). Der ` +
        'Server sieht ihn nicht mehr an; er stuende nur im Protokoll.');
  }

  // ── Was von der alten Pruefung bleibt ─────────────────────────────────────
  // Die zweite Fassung von requireLoginOrToken in routes/sets.ts war der
  // eigentliche Ausloeser des alten Tests. Sie darf nicht zurueckkommen —
  // jetzt umso weniger, da es gar keine Query-Auswertung mehr gibt, die sie
  // umgehen koennte.
  const sets = setKernQuelle();
  assert.doesNotMatch(sets, /function requireLoginOrToken/,
    'Keine zweite Fassung — sie umgeht die eine Regel in src/konto/auth.ts');
  assert.match(sets, /loginOrTokenGuard\(\{ timeoutMs: 3000 \}\)/,
    'Das 3s-Zeitlimit muss bleiben: Während eines Imports ist 503 besser als eine hängende Verbindung');

  // Der Kanal selbst muss es weiterhin geben — sonst prueft der Absatz oben
  // die Abwesenheit eines Tokens an einer Adresse, die es nicht mehr gibt.
  // coreQuelle() statt eines Dateinamens: Der Balken zog in einer früheren Runde nach
  // js/01-fortschritt.js um, und dieser Satz prüfte danach eine Datei, in der
  // der Kanal gar nicht mehr stand. Gesucht ist der KANAL, nicht sein Ablageort.
  assert.ok(coreQuelle().includes('/api/v1/sets/import/csv/stream'),
    'Der SSE-Kanal des CSV-Imports fehlt — Route umgezogen?');
});

test('offene Ereignis-Ströme halten das Herunterfahren nicht auf', () => {
  // Woher dieser Test kommt
  // Ausführlich: docs/begruendungen/test/hardening-block1.test.js.md#server
  const server = read('server.ts');
  assert.match(server, /closeAllSse\(\)/, 'Die Ströme müssen vor close() beendet werden');
  const idxClose = server.indexOf('closeAllSse()');
  const idxWait  = server.indexOf('httpServer.close(');
  assert.ok(idxClose > 0 && idxClose < idxWait,
    'Erst die Ströme beenden, DANN auf close() warten — umgekehrt wartet man vergeblich');

  // Die Reissleine ist eine Notbremse, kein Fehler.
  const start = server.indexOf('async function herunterfahren');
  const fn = server.slice(start, server.indexOf('async function starte', start));
  assert.ok(start > 0, 'herunterfahren() fehlt in server.ts');
  assert.match(fn, /Frist abgelaufen[\s\S]{0,400}?process\.exit\(0\)/,
    'Ein erzwungenes Beenden nach Ablauf der Frist ist kein Fehlschlag');

  // Alle drei SSE-Routen melden sich an — eine vergessene hält wieder auf.
  for (const datei of ['routes/api_v1/sets.ts', 'routes/api_v1/pdf.ts']) {
    assert.match(read(datei), /registerSse\(res\)/, `${datei}: Strom nicht angemeldet`);
  }
  assert.equal((require('./helpers/sources').setKernQuelle().match(/registerSse\(res\)/g) || []).length, 2,
    'sets.ts hat ZWEI Ströme: CSV-Fortschritt und add-stream');
});

test('den Preis-Cache leert nur, wer Administrator ist', () => {
  // Woher dieser Test kommt
  // Ausführlich: docs/begruendungen/test/hardening-block1.test.js.md#dateien
  const dateien = ['routes/api_v1/settings.ts', 'routes/api_v1/sets.ts',
                   'routes/api_v1/parts.ts', 'routes/api_v1/minifigs.ts', 'clients/bricklink.ts'];
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
  // alten Währung passen nach einem Wechsel schlicht nicht mehr auf die …
  // Ausführlich: docs/begruendungen/test/hardening-block1.test.js.md#leser
  const leser = require('./helpers/sources').alleQuellen()
    .filter(d => read(d).includes('FROM price_cache'));
  assert.ok(leser.length >= 4, `nur ${leser.length} Leser von price_cache gefunden — Suche veraltet?`);
  for (const datei of leser) {
    const src = read(datei);
    let i = src.indexOf('FROM price_cache');
    while (i !== -1) {
      // Bis zum Ende der Anweisung. Zählungen und Abfragen ohne WHERE wählen
      // keinen Preis für eine Anzeige aus und dürfen ohne Währung bleiben.
      const vorher = src.slice(Math.max(0, i - 400), i);
      const auf = vorher[Math.max(vorher.lastIndexOf('`'), vorher.lastIndexOf("'"), vorher.lastIndexOf('"'))] || '`';
      const block = src.slice(i, i + 400).split(auf)[0];
      const zaehlung = /COUNT\(\*\)[^`'"]*$/.test(vorher);
      if (!zaehlung && /\bWHERE\b/.test(block)) assert.match(block, /currency_code/,
        `${datei}: Abfrage auf price_cache ohne currency_code — dann mischen sich Währungen`);
      i = src.indexOf('FROM price_cache', i + 1);
    }
  }
});
