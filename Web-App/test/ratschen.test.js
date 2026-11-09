const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WEB = path.join(__dirname, '..');

/**
 * Ratschen: Ein gemessener Bestand darf sinken, nie steigen.
 * Ausführlich: docs/begruendungen/test/ratschen.test.js.md#stelle
 */

/** Alle TypeScript-Quellen ohne Tests und ohne Erzeugnisse. */
function quellen() {
  const raus = [];
  (function lauf(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) {
        if (['node_modules', 'dist', '.git', 'coverage', 'test'].includes(n)) continue;
        lauf(p);
      } else if (n.endsWith('.ts')) raus.push(p);
    }
  })(WEB);
  return raus;
}

const STILLE_FAENGE = [
  /catch\s*\{\s*\}/g,
  /catch\s*\(\s*\w*\s*\)\s*\{\s*\}/g,
  /\.catch\(\(\)\s*=>\s*\{\s*\}\)/g,
  // Auch ein Text, eine Zahl oder ein Objekt als Ersatz verschluckt den Fehler.
  /\.catch\(\(\)\s*=>\s*(null|undefined|true|false|-?\d+|'[^']*'|"[^"]*"|\(\{[^()]*\}\))\)/g,
  // Eine leere Liste ist für den Leser keine Fehlermeldung, sondern „nichts da".
  /\.catch\(\(\)\s*=>\s*\[\]\)/g,
  // Jeder andere Ausdruck als Ersatz (Map, Liste mit Inhalt, Vorgabe): Bei einem
  // Datenbankfehler sähe die Antwort wie ein Ergebnis aus. meldeUndLiefere liefert dasselbe mit Log.
  /\.catch\(\s*\(\s*\)\s*=>\s*(?!\{)(?!(?:null|undefined|true|false|-?\d+|'[^']*'|"[^"]*"|\[\])\s*\))\S/g,
];

/**
 * Treffer zaehlen — im CODE, nicht in den Erklaerungen darueber.
 * Ausführlich: docs/begruendungen/test/ratschen.test.js.md#zaehle
 */
function zaehle(muster) {
  const { ohneKommentare } = require('./helpers/sources');
  let n = 0;
  for (const f of quellen()) {
    const s = ohneKommentare(fs.readFileSync(f, 'utf8'));
    for (const m of muster) n += (s.match(m) || []).length;
  }
  return n;
}

test('die Suche findet die Quellen ueberhaupt', () => {
  // ── Der eigentliche Zweck dieser Pruefung ────────────────────────────────
  //
  // Wird ein Ordner umbenannt oder greift `quellen()` nicht mehr, zaehlen die
  // Ratschen unten NULL — und null ist kleiner als jede Schranke. Sie waeren
  // dann fuer immer gruen, ohne je wieder etwas anzusehen.
  const n = quellen().length;
  assert.ok(n >= 80, `Nur ${n} TypeScript-Quellen gefunden — greift die Suche noch?`);
});

test('stille Faenge werden weniger, nie mehr', () => {
  // Die beiden übrigen sind Rebrickable-Vermutungen, deren 404 die Antwort
  // ist; wie die Zahl gesunken ist, steht im git log. Mit dem Ersatzwert-Muster
  // wurden am 08.11.2026 fünf weitere gefunden und behoben (Stand danach: 2).
  const SCHRANKE = 2;
  // Selbstbeweis des letzten Musters: Es muss einen Ersatzwert ohne Meldung finden, die Meldung nicht.
  const ersatz = STILLE_FAENGE[STILLE_FAENGE.length - 1];
  const trifft = (s) => (s.match(ersatz) || []).length;
  assert.equal(trifft('x.catch(() => [userId]);') + trifft('x.catch(() => new Map());') + trifft('x.catch(()=>VORGABE);'), 3);
  assert.equal(trifft("x.catch(meldeUndLiefere('a', [1]));") + trifft('x.catch((e) => { meldeFehler("a", e); });'), 0);
  const ist = zaehle(STILLE_FAENGE);
  assert.ok(ist <= SCHRANKE,
    `${ist} stille Faenge, erlaubt sind ${SCHRANKE}. Ein neuer \`catch {}\` ` +
    'verschluckt einen Fehler und laeuft weiter — im Betrieb sieht man dann ' +
    'ein Verhalten ohne Ursache. Entweder den Fehler behandeln, oder ihn ' +
    'wenigstens melden (meldeFehler aus src/infra/fehlerTexte).');
  if (ist < SCHRANKE) {
    console.log(`  ℹ stille Faenge: ${ist} (Schranke ${SCHRANKE}) — Schranke nachziehen`);
  }
});

test('„melden und weiter“ wird weniger, nie mehr; src/sets kommt ohne aus', () => {
  // Ein Ersatzwert nach einem Fehler sieht für den Aufrufer aus wie „leer“; src/infra/ergebnis.ts
  // gibt den Fehlschlag weiter. Gemessen 349 Aufrufe am 09.11.2026, 318 nach dem Umbau von src/sets.
  // Gegenprobe (09.11.2026): in src/sets/setAdd.ts wieder `.catch(meldeUndLiefere(…))` → rot (319).
  const SCHRANKE = 318;
  const muster = /\b(?:logAndContinue|meldeUndLiefere)\(/g;
  const ist = zaehle([muster]);
  assert.ok(ist <= SCHRANKE, `${ist}-mal logAndContinue/meldeUndLiefere, erlaubt sind ${SCHRANKE}`);
  const sets = quellen().filter(f => /[\\/]src[\\/]sets[\\/]/.test(f));
  assert.ok(sets.length > 10, 'src/sets nicht gefunden');
  assert.deepEqual(sets.filter(f => new RegExp(muster.source).test(require('./helpers/sources').ohneKommentare(fs.readFileSync(f, 'utf8')))).map(f => path.relative(WEB, f)), []);
  if (ist < SCHRANKE) console.log(`  ℹ logAndContinue/meldeUndLiefere: ${ist} (Schranke ${SCHRANKE}) — Schranke nachziehen`);
});

test('any wird weniger, nie mehr', () => {
  // Gemessen 23 am 08.11.2026; wie die Zahl sinkt, steht im git log.
  const SCHRANKE = 23;
  const ist = zaehle([/\bas any\b/g, /:\s*any\b/g]);
  assert.ok(ist <= SCHRANKE,
    `${ist}-mal \`any\`, erlaubt sind ${SCHRANKE}. Jedes davon schaltet den ` +
    'Typpruefer fuer diesen Ausdruck ab — in einem Baum, der sonst auf ' +
    'noImplicitAny mit leerer Ausnahmeliste steht.');
  if (ist < SCHRANKE) {
    console.log(`  ℹ any: ${ist} (Schranke ${SCHRANKE}) — Schranke nachziehen`);
  }
});

test('any in allen Formen wird weniger, nie mehr', () => {
  // Auch Promise<any>, any[] und Record<string, any>: Die enge Zählung oben sah
  // nur `as any` und `: any`. Gemessen 36 am 08.11.2026.
  // Gegenprobe (05.11.2026): getSetting wieder `fallback?: any` ohne Überladungen → rot.
  const SCHRANKE = 36;
  const ist = zaehle([/\bany\b/g]);
  assert.ok(ist <= SCHRANKE, `${ist}-mal any, erlaubt sind ${SCHRANKE}`);
  if (ist < SCHRANKE) console.log(`  ℹ any (alle Formen): ${ist} (Schranke ${SCHRANKE}) — Schranke nachziehen`);
});

test('eigene REQUIRE_DB-Blöcke in Tests werden weniger, nie mehr', () => {
  // Die Form steht in test/helpers/db.js (dbOderSkip); was davon abweicht,
  // prüft die Erreichbarkeit anders (Rollen, zweite Datenbank, Server).
  // Gemessen 116 Dateien am 05.11.2026.
  // Gegenprobe (05.11.2026): den Block zurück in acquisition-all-paths-db → rot.
  const SCHRANKE = 116;
  const ist = fs.readdirSync(__dirname).filter(n => n.endsWith('.js') && n !== path.basename(__filename))
    .filter(n => fs.readFileSync(path.join(__dirname, n), 'utf8').includes('REQUIRE_DB=1, aber')).length;
  assert.ok(ist <= SCHRANKE, `${ist} Testdateien mit eigener REQUIRE_DB-Prüfung, erlaubt sind ${SCHRANKE}`);
  if (ist < SCHRANKE) console.log(`  ℹ eigene REQUIRE_DB-Prüfungen: ${ist} (Schranke ${SCHRANKE}) — Schranke nachziehen`);
});

test('Datenbankzeilen sind ohne Typargument unknown', () => {
  // Ohne Angabe war eine Zeile `any`, und die Typprüfung endete an der
  // Datenbank — dort, wo numeric und bigint als Zeichenkette ankommen.
  // Gegenprobe (05.11.2026): `get<T = any>` in DbSchnittstelle → rot.
  const quelle = ['database.ts', 'typen.ts'].map(n => fs.readFileSync(path.join(WEB, 'db', n), 'utf8')).join('\n');
  assert.equal((quelle.match(/\b(?:all|get)\s*(?::\s*)?<T = unknown>/g) || []).length, 6,
    'all/get in Schnittstelle, Pool und Transaktion');
  assert.doesNotMatch(quelle, /<T = any>|lastID/);
});

test('ungetypte Datenbankabfragen werden weniger, nie mehr', () => {
  // Erlaubt, solange niemand Felder der Zeile liest — dann verlangt der
  // Übersetzer ohnehin ein Typargument. Gemessen 68 am 06.11.2026.
  // Gegenprobe (05.11.2026): Schranke auf 68 → rot.
  const SCHRANKE = 68;
  const ist = zaehle([/\b(?:db|tx|dbh|d)\.(?:get|all)\(/g]);
  assert.ok(ist <= SCHRANKE, `${ist} ungetypte db.get/all, erlaubt sind ${SCHRANKE}`);
  if (ist < SCHRANKE) console.log(`  ℹ ungetypte Abfragen: ${ist} (Schranke ${SCHRANKE}) — Schranke nachziehen`);
});

test('rohe req.body und req.query in Routen werden weniger, nie mehr', () => {
  // Eine Route liest req.eingabe und req.abfrage: geprüft und getypt aus dem
  // Vertrag. Übrig sind die Middleware vor der Prüfung, der Bild-Proxy (ohne
  // Vertrag) und routes/auth/registrierung.ts. Gemessen 4 am 05.11.2026.
  // Gegenprobe (05.11.2026): in routes/api_v1/sets.ts ein `req.body.storage` zurück → rot.
  const SCHRANKE = 4;
  let ist = 0;
  for (const f of quellen().filter(f => /[\\/]routes[\\/]/.test(f)))
    ist += (require('./helpers/sources').ohneKommentare(fs.readFileSync(f, 'utf8')).match(/\breq\.(?:body|query)\b/g) || []).length;
  assert.ok(ist <= SCHRANKE, `${ist}-mal req.body/req.query in routes/, erlaubt sind ${SCHRANKE}`);
  if (ist < SCHRANKE) console.log(`  ℹ req.body/req.query in Routen: ${ist} (Schranke ${SCHRANKE}) — Schranke nachziehen`);
});

test('Schreibziele in Routen werden weniger, nie mehr', () => {
  // schreibziel() prüft im Haushalt, für wen geschrieben wird; besser nimmt der
  // Dienst den Wunsch selbst entgegen. Gemessen 17 am 05.11.2026.
  // Gegenprobe (05.11.2026): Schranke auf 16 → rot.
  const SCHRANKE = 17;
  let ist = 0;
  for (const f of quellen().filter(f => /[\\/]routes[\\/]/.test(f)))
    ist += (require('./helpers/sources').ohneKommentare(fs.readFileSync(f, 'utf8')).match(/\bschreibziel\(/g) || []).length;
  assert.ok(ist <= SCHRANKE, `${ist}-mal schreibziel() in routes/, erlaubt sind ${SCHRANKE}`);
  if (ist < SCHRANKE) console.log(`  ℹ schreibziel() in Routen: ${ist} (Schranke ${SCHRANKE}) — Schranke nachziehen`);
});

/**
 * Testdateien, die nur Quelltext lesen und nichts ausführen. Eine Regex auf
 * den Quelltext bestätigt, dass eine Zeile dasteht — nicht, dass sie wirkt
 * (der Signal-Fehler vom 25.10. stand im Quelltext, nur an der falschen
 * Stelle). Strukturprüfungen dürfen bleiben; neue Prüfungen von Verhalten
 * gehören in einen Test, der den Code laufen lässt.
 */
const LIEST_QUELLE = /readFileSync|Quelle\(|serverOnly|serverAll|i18nAll|localeSource|ohneKommentare/;
// Die Hilfen für jsdom und Chrome führen die Oberfläche aus (wie im Prüfbericht arch17-web-b, H1).
const FUEHRT_AUS = /buildAndRequire|testServer|spawn\(|spawnSync\(|execFileSync\(|fetch\(|jsdom|new Function|vm\.|= import\(|helpers\/(oberflaeche|app-browser)'/;
function reineQuelltextTests() {
  return fs.readdirSync(__dirname).filter(n => n.endsWith('.test.js')).filter(n => {
    const src = fs.readFileSync(path.join(__dirname, n), 'utf8');
    return LIEST_QUELLE.test(src) && !FUEHRT_AUS.test(src);
  });
}

test('reine Quelltext-Tests werden weniger, nie mehr', () => {
  // Gemessen 72 am 08.11.2026; wie die Zahl gesunken ist, steht im git log.
  const SCHRANKE = 72;
  const alle = fs.readdirSync(__dirname).filter(n => n.endsWith('.test.js')).length;
  assert.ok(alle >= 300, `Nur ${alle} Testdateien gefunden — greift die Suche noch?`);
  const ist = reineQuelltextTests();
  assert.ok(ist.length <= SCHRANKE,
    `${ist.length} Testdateien lesen nur Quelltext, erlaubt sind ${SCHRANKE}. ` +
    'Prüft der neue Test Verhalten, soll er den Code ausführen (buildAndRequire, ' +
    'testServer) statt per Regex nachzusehen, ob eine Zeile dasteht.');
  if (ist.length < SCHRANKE) {
    console.log(`  ℹ reine Quelltext-Tests: ${ist.length} (Schranke ${SCHRANKE}) — Schranke nachziehen`);
  }
});

/**
 * Je Testfall statt je Datei: Auch eine Datei, die irgendwo Code ausführt,
 * kann zwanzig Fälle haben, die nur eine Zeile im Quelltext suchen. Ein Fall
 * zählt, wenn er Quelltext liest (direkt oder über eine Quelltext-Variable der
 * Datei) und nichts ausführt. Zählweise wie im Prüfbericht arch17-web-b.
 */
// `_req(…)` ist der require-Helfer aus buildAndRequire(): ein Aufruf lädt das gebaute Modul aus dist/.
const FALL_FUEHRT_AUS = /buildAndRequire|\b_req\w*\(|testServer|spawn\(|spawnSync\(|execFileSync\(|fetch\(|jsdom|JSDOM|new Function|vm\.|import\(|require\(.*dist|\.request\(|agent\.|[oO]berflaeche\(|browser|seite\.|page\.|await |starte|lade\w*\(/;
const FALL_LIEST = /readFileSync|Quelle\(|serverOnly|serverAll|i18nAll|localeSource|ohneKommentare/;
function quelltextFaelle() {
  let n = 0, alle = 0;
  for (const name of fs.readdirSync(__dirname).filter(x => x.endsWith('.test.js'))) {
    const s = fs.readFileSync(path.join(__dirname, name), 'utf8');
    const vars = new Set();
    for (const m of s.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*[^;\n]*(readFileSync|Quelle\(|serverOnly|serverAll|i18nAll|localeSource|ohneKommentare|Quelle\b)/g)) vars.add(m[1]);
    for (const m of s.matchAll(/(?:const|let|var)\s+\{([^}]+)\}\s*=\s*require\(['"]\.\/helpers\/sources['"]\)/g))
      for (const x of m[1].split(',')) vars.add(x.trim().split(':').pop()?.trim() ?? '');
    for (const fall of s.split(/\n(?=\s{0,4}(?:test|it)\(\s*['"`])/).slice(1)) {
      alle++;
      const liest = FALL_LIEST.test(fall) || [...vars].some(v => v && new RegExp(`\\b${v}\\b`).test(fall));
      if (liest && !FALL_FUEHRT_AUS.test(fall)) n++;
    }
  }
  return { n, alle };
}

test('Testfälle, die nur Quelltext lesen, werden weniger, nie mehr', () => {
  // Gemessen 495 am 08.11.2026 (Prüfbericht: 632; die Ratschen selbst zählen mit).
  // Gegenprobe (08.11.2026): `\b_req\w*\(` aus FALL_FUEHRT_AUS entfernt → rot (574).
  // Gegenprobe (05.11.2026): parts-paging.test.js auf den Stand vor den jsdom-Tests → rot.
  const SCHRANKE = 495;
  const { n, alle } = quelltextFaelle();
  assert.ok(alle > 2000, `nur ${alle} Testfälle gefunden — greift die Suche noch?`);
  assert.ok(n <= SCHRANKE, `${n} Testfälle lesen nur Quelltext, erlaubt sind ${SCHRANKE}. ` +
    'Verhalten gehört in einen Test, der den Code ausführt (jsdom, buildAndRequire, testServer).');
  if (n < SCHRANKE) console.log(`  ℹ Quelltext-Testfälle: ${n} (Schranke ${SCHRANKE}) — Schranke nachziehen`);
});

test('feste Wartezeiten in Tests werden weniger, nie mehr', () => {
  // Eine feste Pause ist unter Last zu kurz und sonst zu lang; gewartet wird auf
  // eine Bedingung (helpers/zeit.js bis(), ruhig() der Oberflächenhilfen).
  // Gemessen 111 laut Prüfbericht, 37 am 05.11.2026. Eigene Warte-Helfer: 0.
  // Gegenprobe (05.11.2026): `await warte(500);` in verlauf-browser.test.js → rot (38).
  const SCHRANKE = 37;
  const FEST = /^\s*await (warte|takt|new Promise\(r(esolve)? => setTimeout\(r(esolve)?,)\s*\(?\s*[0-9]{3,}/;
  const EIGEN = /^\s*const (warte|takt|sleep|schlafe)\s*=/;
  let ist = 0;
  const eigene = [];
  for (const n of fs.readdirSync(__dirname).filter(x => x.endsWith('.js'))) {
    for (const z of fs.readFileSync(path.join(__dirname, n), 'utf8').split('\n')) {
      if (FEST.test(z)) ist++;
      if (EIGEN.test(z)) eigene.push(n);
    }
  }
  assert.deepEqual(eigene, [], 'eigene Warte-Helfer: test/helpers/zeit.js benutzen');
  assert.ok(ist <= SCHRANKE, `${ist} feste Wartezeiten ab 100 ms, erlaubt sind ${SCHRANKE}`);
  if (ist < SCHRANKE) console.log(`  ℹ feste Wartezeiten: ${ist} (Schranke ${SCHRANKE}) — Schranke nachziehen`);
});

/**
 * Emoji in der Oberfläche. Seit dem 25.10. gibt es eine Symbolfamilie (Sprite
 * in index.html); Emoji sehen je Gerät anders aus und passen weder in Grösse
 * noch Farbe dazu. Gezählt werden Markup, deutsche Sprachtexte und die
 * Vorlagen in public/js — ohne Kommentare.
 */
function emojiInDerOberflaeche() {
  const web = path.join(WEB, 'public');
  const ohne = s => require('./helpers/sources').ohneHtmlKommentare(s).replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
  const dateien = [path.join(web, 'index.html'), path.join(web, 'locales', 'de.js'),
    ...fs.readdirSync(path.join(web, 'js')).filter(n => /^\d\d-.*\.js$/.test(n)).map(n => path.join(web, 'js', n))];
  return dateien.reduce((n, f) => n + (ohne(fs.readFileSync(f, 'utf8')).match(/\p{Extended_Pictographic}/gu) || []).length, 0);
}

test('Emoji in der Oberfläche werden weniger, nie mehr', () => {
  // Seit dem 27.10.2026 0: Alle Stellen nutzen die Symbolfamilie oder kommen ohne aus.
  const SCHRANKE = 0;
  const ist = emojiInDerOberflaeche();
  // Selbstbeweis an einer Probe statt an der Zahl — die ist jetzt 0.
  assert.equal(('<b>📦 x</b> ⚠️').match(/\p{Extended_Pictographic}/gu)?.length, 2, 'Die Suche greift nicht mehr');
  assert.ok(ist <= SCHRANKE,
    `${ist} Emoji in der Oberfläche, erlaubt sind ${SCHRANKE}. Für Symbole gibt es ` +
    'die Symbolfamilie: <svg class="ico" aria-hidden="true"><use href="#i-…"/></svg>.');
  if (ist < SCHRANKE) console.log(`  ℹ Emoji: ${ist} (Schranke ${SCHRANKE}) — Schranke nachziehen`);
});

/**
 * Inline-Stile in index.html. Ein data-stil="…" (js/00-stile.js setzt es als
 * Inline-Stil) setzt sich über jedes Design und jede Telefonregel hinweg;
 * gleiche Dinge sahen deshalb an zwei Stellen verschieden aus. Gezählt werden
 * Attribute ausserhalb von Kommentaren. display:none bleibt erlaubt: Die
 * Skripte schalten es um.
 */
test('Inline-Stile in index.html werden weniger, nie mehr', () => {
  // GEMESSEN am 28.10.2026: 455 vor dem Umzug in Klassen, danach 170,
  // davon 56 reines display:none. 112 am 29.10. (Merkliste-Kasten als Klasse),
  // 52 am selben Tag (Diagramm, Banner, Dialogfüsse, PDF-Ansicht als Klassen).
  // 51 am 30.10. (Kennzahlen der Minifiguren ohne eigenes Raster). 47 am 03.11.
  // 38 am 04.11. (Bauliste und Zwischenspeicher als Klassen); 36 am selben Tag (Bauliste-Chips und Status), 35 am 06.11.
  const SCHRANKE = 35;
  const html = require('./helpers/sources').ohneHtmlKommentare(fs.readFileSync(path.join(WEB, 'public', 'index.html'), 'utf8'));
  const stile = [...html.matchAll(/<[a-zA-Z][^>]*?\sdata-stil="([^"]*)"/g)].map(m => m[1].trim().replace(/;$/, ''));
  assert.ok(stile.length > 50, 'Keine Inline-Stile gefunden — greift die Suche noch?');
  const ist = stile.filter(s => s !== 'display:none').length;
  assert.ok(ist <= SCHRANKE,
    `${ist} Inline-Stile (ohne display:none) in index.html, erlaubt sind ${SCHRANKE}. ` +
    'Gestaltung gehört in styles.css; dort sieht sie jedes Design und mobile.css.');
  if (ist < SCHRANKE) console.log(`  ℹ Inline-Stile: ${ist} (Schranke ${SCHRANKE}) — Schranke nachziehen`);
});

/** Quelltext von Server und Oberfläche — für die beiden Kommentar-Ratschen unten. */
function serverUndOberflaeche() {
  const js = path.join(WEB, 'public', 'js');
  return [...quellen(), ...fs.readdirSync(js).filter(f => /^\d\d-.*\.js$/.test(f)).map(f => path.join(js, f)),
          path.join(WEB, 'public', 'i18n.js')];
}

/** Alles, was auf docs/begruendungen verweisen darf: Server, Oberfläche, index.html, Tests, Skripte. */
function mitBegruendungen() {
  const js = (/** @type {string} */ d) => fs.readdirSync(d).filter(f => f.endsWith('.js')).map(f => path.join(d, f));
  return [...serverUndOberflaeche(), path.join(WEB, 'public', 'index.html'),
    ...js(__dirname), ...js(path.join(__dirname, 'helpers')), ...js(path.join(WEB, 'scripts'))];
}

test('kein Verweis auf „Nachtrag N" unter Web-App/', () => {
  // Die Geschichte einer Stelle steht im Commit (CLAUDE.md); eine Nummer im
  // Kommentar verweist auf eine Liste, die es im Baum nicht gibt. Ausgenommen:
  // docs/, CHANGELOG* und db/ (angewandte Migrationen dürfen sich nicht ändern).
  // Gegenproben: eine Nachtragsnummer in src/konto/auth.ts → rot; dasselbe in
  // test/tab-layout.test.js und in public/index.html → rot (05.11.2026).
  const RAUS = new Set(['node_modules', 'dist', 'coverage', 'data', 'docs', 'CHANGELOG', 'db', '.git']);
  const treffer = [];
  let dateien = 0;
  (function lauf(d) {
    for (const n of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, n.name);
      if (n.isDirectory()) { if (!RAUS.has(n.name)) lauf(p); continue; }
      if (n.name.startsWith('CHANGELOG') || !/\.(ts|js|html|css|sh|md|ya?ml|json|sql)$|^\.gitignore$|^Dockerfile$|^Caddyfile$/.test(n.name)) continue;
      if (n.name === 'app.bundle.js') continue;
      dateien++;
      for (const m of fs.readFileSync(p, 'utf8').match(/Nachtr(?:ag|äge|aege) \d+/g) || []) treffer.push(`${path.relative(WEB, p)}: ${m}`);
    }
  })(WEB);
  assert.ok(dateien > 800, `nur ${dateien} Dateien durchsucht — greift die Suche noch?`);
  assert.deepEqual(treffer, []);
});

test('kein Modul wird in einer Datei zweimal importiert', () => {
  // Je Modul ein Wert-Import und höchstens ein `import type`; neun Zeilen für
  // neun Namen aus derselben Datei verdecken, was wirklich gebraucht wird.
  // Gegenprobe (05.11.2026): `import { fehlertext } from '../infra/fehler';`
  // zusätzlich in src/finanzen/preisalarm.ts → rot.
  const treffer = [];
  for (const f of quellen()) {
    const gesehen = new Set();
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/^import\s+(type\s+)?[^;]*?from\s*'([^']+)';/gm)) {
      const k = `${m[1] ? 'type ' : ''}${m[2]}`;
      if (gesehen.has(k)) treffer.push(`${path.relative(WEB, f)}: ${k}`);
      gesehen.add(k);
    }
  }
  assert.deepEqual(treffer, []);
});

test('der Kommentaranteil im Server sinkt, nie steigt', () => {
  // Gemessen 13,8 % in server.ts, routes/, src/ und jobs/; 13,2 % mit dem
  // API-Vertrag (src/vertrag/). Schranke 13,2.
  const SCHRANKE = 13.2;
  let zeilen = 0, kommentar = 0;
  for (const f of quellen().filter(f => /[\\/](routes|src|jobs)[\\/]/.test(f) || /[\\/]server\.ts$/.test(f))) {
    for (const z of fs.readFileSync(f, 'utf8').split('\n')) {
      const t = z.trim();
      if (!t) continue;
      zeilen++;
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) kommentar++;
    }
  }
  assert.ok(zeilen > 10000, `nur ${zeilen} Zeilen gefunden — greift die Suche noch?`);
  const anteil = Math.round(1000 * kommentar / zeilen) / 10;
  assert.ok(anteil <= SCHRANKE, `${anteil} % Kommentarzeilen, erlaubt sind ${SCHRANKE} %`);
  if (anteil < SCHRANKE - 0.5) console.log(`  ℹ Kommentaranteil: ${anteil} % (Schranke ${SCHRANKE}) — Schranke nachziehen`);
});

/** Quellen der Oberfläche: public/js ohne Bündel, dazu i18n.js. */
function oberflaeche() {
  const js = path.join(WEB, 'public', 'js');
  return [...fs.readdirSync(js).filter(f => f.endsWith('.js') && f !== 'app.bundle.js').map(f => path.join(js, f)),
          path.join(WEB, 'public', 'i18n.js')];
}

// Typangaben in JSDoc (@param, @type …) und reine Begrenzer (/**, */) sind
// Code für tsc, keine Erzählung; sie zählen weder als Kommentar noch als Zeile.
const TYPZEILE = /^(\/\*\*\s*)?\*?\s*@(param|type|returns?|typedef|template|this|property)\b|^\/\*\*$|^\*\/$|^\*$/;

test('der Kommentaranteil der Oberfläche sinkt, nie steigt', () => {
  // Ohne Typzeilen gezählt: 22,0 % vor, 20,0 % nach dem Streichen von Geschichte und dem Umbruch
  // der Kommentare auf 110 Zeichen wie im Code. Gegenprobe: 300 Kommentarzeilen an 01-dom.js → rot.
  const SCHRANKE = 20.0;
  let zeilen = 0, kommentar = 0;
  for (const f of oberflaeche()) {
    for (const z of fs.readFileSync(f, 'utf8').split('\n')) {
      const t = z.trim();
      if (!t || TYPZEILE.test(t)) continue;
      zeilen++;
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) kommentar++;
    }
  }
  assert.ok(zeilen > 8000, `nur ${zeilen} Zeilen gefunden — greift die Suche noch?`);
  const anteil = Math.round(1000 * kommentar / zeilen) / 10;
  assert.ok(anteil <= SCHRANKE, `${anteil} % Kommentarzeilen in der Oberfläche, erlaubt sind ${SCHRANKE} %`);
  if (anteil < SCHRANKE - 0.5) console.log(`  ℹ Kommentaranteil Oberfläche: ${anteil} % (Schranke ${SCHRANKE}) — Schranke nachziehen`);
});

test('any in den Typangaben der Oberfläche wird weniger, nie mehr', () => {
  // noImplicitAny verbietet nur das stille any; ein ausgeschriebenes schaltet
  // die Prüfung für diesen Wert genauso ab. Seit dem Abbau steht keines mehr da.
  // Gegenprobe: an 01-api.js `/** @type {any} */ let x;` angehängt → rot mit 1.
  const SCHRANKE = 0;
  let ist = 0;
  for (const f of oberflaeche())
    for (const z of fs.readFileSync(f, 'utf8').split('\n'))
      if (z.includes('@') && (z.includes('/**') || z.trim().startsWith('*'))) ist += (z.match(/\bany\b/g) || []).length;
  assert.ok(ist <= SCHRANKE, `${ist}-mal any in Typangaben der Oberfläche, erlaubt sind ${SCHRANKE}`);
  if (ist < SCHRANKE) console.log(`  ℹ any in der Oberfläche: ${ist} (Schranke ${SCHRANKE}) — Schranke nachziehen`);
});

test('kein Kommentar der Oberfläche hat mehr als fünf Zeilen Prosa', () => {
  // CLAUDE.md: Ein Kommentar sagt in zwei bis fünf Zeilen, warum. JSDoc-Tags
  // (@param, @returns …) zählen nicht mit. Gemessen am 05.11.2026: 206 Blöcke,
  // ausgelagert nach docs/begruendungen/public/; seitdem 0.
  // Gegenprobe: ein //-Block mit sechs Zeilen in 01-dom.js → rot mit Fundstelle.
  const lang = [];
  let bloecke = 0;
  for (const f of oberflaeche()) {
    const z = fs.readFileSync(f, 'utf8').split('\n');
    for (let i = 0; i < z.length; i++) {
      const t = z[i].trim();
      let prosa = null, j = i;
      if (t.startsWith('//')) {
        while (j + 1 < z.length && z[j + 1].trim().startsWith('//')) j++;
        prosa = z.slice(i, j + 1).map(l => l.trim().replace(/^\/\/ ?/, ''));
      } else if (t.startsWith('/*') && !t.includes('*/')) {
        while (j + 1 < z.length && !z[j].includes('*/')) j++;
        const innen = [t.replace(/^\/\*\*?/, ''), ...z.slice(i + 1, j).map(l => l.trim().replace(/^\* ?/, ''))];
        const k = innen.findIndex(l => l.trim().startsWith('@'));
        prosa = k < 0 ? innen : innen.slice(0, k);
      }
      if (!prosa) continue;
      bloecke++;
      if (prosa.filter(l => l.trim()).length > 5) lang.push(`${path.relative(WEB, f)}:${i + 1}`);
      i = j;
    }
  }
  assert.ok(bloecke > 300, `nur ${bloecke} Kommentarblöcke gefunden — greift die Suche noch?`);
  assert.deepEqual(lang, [], 'Lange Begründung: Warum in den Code (höchstens fünf Zeilen), Geschichte in den Commit');
});

/** Funktionen mit ihrer Länge (Deklaration bis zur schliessenden Klammer gleicher Einrückung). */
function funktionsLaengen(dateien = oberflaeche()) {
  const raus = [];
  for (const f of dateien) {
    const z = fs.readFileSync(f, 'utf8').split('\n');
    z.forEach((l, i) => {
      const m = l.match(/^(\s*)(?:export\s+)?(?:async\s+)?function\s*\*?\s*(\w+)\s*[<(]/);
      if (!m || /\}\s*;?\s*$/.test(l)) return;
      const ende = z.findIndex((x, j) => j > i && x.startsWith(m[1] + '}'));
      if (ende > i) raus.push({ ort: `${path.relative(WEB, f)}:${i + 1} ${m[2]}`, zeilen: ende - i + 1 });
    });
  }
  return raus;
}

test('keine Funktion der Oberfläche über 100 Zeilen, über 80 werden weniger', () => {
  // Gemessen am 05.11.2026: 13 über 100 (loadFinance 262); nach dem Aufteilen
  // 0 über 100 und 8 über 80, seitdem 5. Gegenprobe: loadFinance wieder in einem Stück
  // (vor dem Aufteilen) → rot mit „04-finance.js … loadFinance“.
  const SCHRANKE_80 = 5;
  const alle = funktionsLaengen();
  assert.ok(alle.length > 500, `nur ${alle.length} Funktionen gefunden — greift die Suche noch?`);
  const ueber100 = alle.filter(x => x.zeilen > 100).map(x => `${x.ort} (${x.zeilen})`);
  assert.deepEqual(ueber100, [], 'Eine Funktion über 100 Zeilen: in benannte Teile zerlegen');
  const ueber80 = alle.filter(x => x.zeilen > 80);
  assert.ok(ueber80.length <= SCHRANKE_80,
    `${ueber80.length} Funktionen über 80 Zeilen, erlaubt sind ${SCHRANKE_80}:\n${ueber80.map(x => x.ort).join('\n')}`);
  if (ueber80.length < SCHRANKE_80) console.log(`  ℹ Funktionen über 80 Zeilen: ${ueber80.length} (Schranke ${SCHRANKE_80}) — Schranke nachziehen`);
});

/** Code-Zeilen der Oberflächenmodule (public/js/NN-*.js) ohne Kommentarzeilen, mit Fundort. */
function oberflaechenCode() {
  const js = path.join(WEB, 'public', 'js');
  const raus = [];
  for (const f of fs.readdirSync(js).filter(n => /^\d\d-.*\.js$/.test(n)))
    fs.readFileSync(path.join(js, f), 'utf8').split('\n').forEach((z, i) => {
      const t = z.trim();
      if (!t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')) raus.push({ ort: `${f}:${i + 1}`, z });
    });
  return raus;
}

test('Markup kommt nur über setzeHtml()/fuegeHtmlEin() in die Seite', () => {
  // Gemessen vor dem Umbau: 171 innerHTML-Zuweisungen und 9 +=/insertAdjacentHTML. Jetzt schreiben
  // nur die beiden Helfer in 01-dom.js; das Protokollfenster (01-monitor.js) baut ein eigenes
  // Dokument per document.write. Gegenprobe: in 02-gallery.js `grid.innerHTML = ''` → rot mit Fundort.
  const ERLAUBT = ['01-dom.js', '01-dom.js', '01-monitor.js'];
  const roh = oberflaechenCode().filter(x => /\.(innerHTML|outerHTML)\s*\+?=(?!=)|insertAdjacentHTML\(|document\.write\(/.test(x.z));
  assert.deepEqual(roh.map(x => x.ort.split(':')[0]).sort(), ERLAUBT,
    `Markup an setzeHtml() vorbei:\n${roh.map(x => x.ort).join('\n')}`);
});

test('ungeprueft() wird weniger, nie mehr', () => {
  // html`` maskiert jeden eingesetzten Wert; ungeprueft() setzt eine Zeichenkette als Markup ein, die
  // vor dem Umbau schon maskiert gebaut wurde. Wer eine Stelle auf html`` umstellt, senkt die Schranke.
  // Gegenprobe: `${ungeprueft(x)}` in 01-dom.js ergänzt → rot mit 159.
  const SCHRANKE = 142;
  const ist = oberflaechenCode().reduce((n, x) => n + (x.z.match(/(?<![\w.])ungeprueft\(/g) || []).length
    - (/export function ungeprueft\(/.test(x.z) ? 1 : 0), 0);
  assert.ok(ist > 0, 'kein ungeprueft() gefunden — greift die Suche noch?');
  assert.ok(ist <= SCHRANKE, `${ist}-mal ungeprueft(), erlaubt sind ${SCHRANKE}`);
  if (ist < SCHRANKE) console.log(`  ℹ ungeprueft(): ${ist} (Schranke ${SCHRANKE}) — Schranke nachziehen`);
});

test('keine Datei der Oberfläche über 1000 Zeilen, die grossen werden kleiner', () => {
  // Eine Sammeldatei zieht Neues an, weil es dort schon liegt. Gemessen nach dem Teilen von
  // 01-core.js, 05-settings.js und 13-acquisition-modals.js: grösste 859 am 06.11.2026, über 600 Zeilen 8.
  // Gegenprobe: an 13-acquisition-modals.js 60 Kommentarzeilen gehängt → rot: „grösste Datei 977 Zeilen“.
  const SCHRANKE_GROESSTE = 859, SCHRANKE_UEBER_600 = 8;
  const laengen = oberflaeche().map(f => ({ f: path.relative(WEB, f), n: fs.readFileSync(f, 'utf8').split('\n').length }));
  assert.ok(laengen.length > 40, `nur ${laengen.length} Dateien gefunden — greift die Suche noch?`);
  const ueber1000 = laengen.filter(x => x.n > 1000).map(x => `${x.f} (${x.n})`);
  assert.deepEqual(ueber1000, [], 'Eine Datei über 1000 Zeilen: nach Themen teilen');
  const groesste = Math.max(...laengen.map(x => x.n));
  const ueber600 = laengen.filter(x => x.n > 600).length;
  assert.ok(groesste <= SCHRANKE_GROESSTE, `grösste Datei ${groesste} Zeilen, erlaubt sind ${SCHRANKE_GROESSTE}`);
  assert.ok(ueber600 <= SCHRANKE_UEBER_600, `${ueber600} Dateien über 600 Zeilen, erlaubt sind ${SCHRANKE_UEBER_600}`);
  if (groesste < SCHRANKE_GROESSTE || ueber600 < SCHRANKE_UEBER_600)
    console.log(`  ℹ Dateigrösse Oberfläche: grösste ${groesste}, über 600: ${ueber600} — Schranke nachziehen`);
});

test('Funktionen im Server über 80 und über 150 Zeilen werden weniger, nie mehr', () => {
  // Gemessen am 05.11.2026: 11 über 80, keine über 150.
  // Gegenprobe (05.11.2026): computePnl wieder in einem Stück → rot (über 150).
  const SCHRANKE_80 = 11, SCHRANKE_150 = 0;
  const alle = funktionsLaengen(quellen().filter(f => /[\\/](src|routes|jobs|db|clients|startup)[\\/]/.test(f) || /[\\/]server\.ts$/.test(f)));
  assert.ok(alle.length > 1000, `nur ${alle.length} Funktionen gefunden — greift die Suche noch?`);
  const ueber = (n) => alle.filter(x => x.zeilen > n);
  assert.ok(ueber(150).length <= SCHRANKE_150, `über 150 Zeilen:\n${ueber(150).map(x => x.ort).join('\n')}`);
  assert.ok(ueber(80).length <= SCHRANKE_80, `${ueber(80).length} über 80 Zeilen, erlaubt sind ${SCHRANKE_80}`);
  if (ueber(80).length < SCHRANKE_80) console.log(`  ℹ Server-Funktionen über 80 Zeilen: ${ueber(80).length} — Schranke nachziehen`);
});

test('der Kommentaranteil in db/, clients/ und scripts/ sinkt, nie steigt', () => {
  // Je Ordner eine Schranke, gemessen am 06.11.2026.
  // Gegenprobe: 40 Kommentarzeilen an clients/ezb.ts gehängt → rot (clients).
  const SCHRANKE = { db: 27.2, clients: 19.7, scripts: 25.5 };
  const zuViel = [];
  for (const [ordner, schranke] of Object.entries(SCHRANKE)) {
    let zeilen = 0, kommentar = 0;
    (function lauf(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const n = e.name;
        const p = path.join(d, n);
        if (e.isDirectory()) { if (n !== 'node_modules') lauf(p); continue; }
        if (!/\.(ts|js|sh)$/.test(n) || (n.endsWith('.js') && fs.existsSync(p.slice(0, -3) + '.ts'))) continue;
        for (const z of fs.readFileSync(p, 'utf8').split('\n')) {
          const t = z.trim();
          if (!t) continue;
          zeilen++;
          if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || (n.endsWith('.sh') && t.startsWith('#'))) kommentar++;
        }
      }
    })(path.join(WEB, ordner));
    assert.ok(zeilen > 500, `${ordner}: nur ${zeilen} Zeilen gefunden — greift die Suche noch?`);
    const anteil = Math.round(1000 * kommentar / zeilen) / 10;
    if (anteil > schranke) zuViel.push(`${ordner}: ${anteil} % (erlaubt ${schranke} %)`);
    else if (anteil < schranke - 0.5) console.log(`  ℹ Kommentaranteil ${ordner}: ${anteil} % (Schranke ${schranke}) — Schranke nachziehen`);
  }
  assert.deepEqual(zuViel, []);
});

test('Geschichte in Testkommentaren wird weniger, nie mehr', () => {
  // Ein Testkopf nennt, was geprüft wird, und seine Gegenproben (CLAUDE.md);
  // woher ein Test kam, steht im Commit. Gezählt werden Kommentarzeilen mit
  // den typischen Erzählmarken. Gemessen 58 am 08.11.2026 (vorher 424).
  // Gegenprobe (05.11.2026): den alten Kopf von scope-reset.test.js zurück → rot.
  const SCHRANKE = 58;

  const MARKE = /(Nachtr(ag|äge) [0-9]|Hier stand|Vorher stand|NACHGEMESSEN|kam(en)? am [0-9]|Marcos (Frage|Wunsch|Bericht|Rückfrage|Konsole))/;
  const dateien = [
    ...fs.readdirSync(__dirname).filter(n => n.endsWith('.js')).map(n => path.join(__dirname, n)),
    ...fs.readdirSync(path.join(__dirname, 'helpers')).filter(n => n.endsWith('.js')).map(n => path.join(__dirname, 'helpers', n)),
  ];
  let ist = 0;
  for (const f of dateien)
    for (const z of fs.readFileSync(f, 'utf8').split('\n')) {
      const t = z.trim();
      if ((t.startsWith('//') || t.startsWith('*')) && MARKE.test(t)) ist++;
    }
  assert.ok(ist > 0, 'keine Marke gefunden — greift die Suche noch?');
  assert.ok(ist <= SCHRANKE, `${ist} Kommentarzeilen mit Geschichte in den Tests, erlaubt sind ${SCHRANKE}`);
  if (ist < SCHRANKE) console.log(`  ℹ Geschichte in Testkommentaren: ${ist} (Schranke ${SCHRANKE}) — Schranke nachziehen`);
});

test('der Kommentaranteil der Tests sinkt, nie steigt', () => {
  // Eigene Schranke: Testköpfe zählen ihre Gegenproben auf (CLAUDE.md), der
  // Anteil liegt deshalb höher als im Server. Geschichte gehört auch hier in
  // den Commit. Gemessen 22,2 % in test/*.js und test/helpers/ (08.11.2026, vorher 33,3).
  // Gegenprobe: 300 Kommentarzeilen an eine Testdatei gehängt → rot.
  const SCHRANKE = 22.2;
  const dateien = [
    ...fs.readdirSync(__dirname).filter(n => n.endsWith('.js')).map(n => path.join(__dirname, n)),
    ...fs.readdirSync(path.join(__dirname, 'helpers')).filter(n => n.endsWith('.js')).map(n => path.join(__dirname, 'helpers', n)),
  ];
  let zeilen = 0, kommentar = 0;
  for (const f of dateien) {
    for (const z of fs.readFileSync(f, 'utf8').split('\n')) {
      const t = z.trim();
      if (!t) continue;
      zeilen++;
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) kommentar++;
    }
  }
  assert.ok(zeilen > 20000, `nur ${zeilen} Zeilen gefunden — greift die Suche noch?`);
  const anteil = Math.round(1000 * kommentar / zeilen) / 10;
  assert.ok(anteil <= SCHRANKE, `${anteil} % Kommentarzeilen in den Tests, erlaubt sind ${SCHRANKE} %`);
  if (anteil < SCHRANKE - 0.5) console.log(`  ℹ Kommentaranteil Tests: ${anteil} % (Schranke ${SCHRANKE}) — Schranke nachziehen`);
});

test('jeder Verweis auf docs/begruendungen trifft Datei und Anker', () => {
  // Die langen Begründungen liegen in docs/begruendungen/<datei>.md; der Code
  // verweist mit „Ausführlich: …#anker". Beim Verschieben einer Datei wandert
  // das Dokument mit — dieser Test hält Verweis und Ziel zusammen.
  // Und nur in das Dokument der EIGENEN Datei: Sonst bleibt beim Teilen
  // einer Datei die Begründung beim alten Namen liegen.
  // Gegenproben: #post-tokens statt #get-tokens in routes/api_v1/settings.ts
  // → rot (31.10.2026); in routes/auth/benutzer.ts wieder auf
  // routes/auth.ts.md#delete-users-id verwiesen → rot (05.11.2026).
  const kaputt = [];
  let n = 0;
  for (const f of mitBegruendungen()) {
    const eigen = path.relative(WEB, f).split(path.sep).join('/') + '.md';
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/docs\/begruendungen\/([^\s#`'"]+\.md)#([\w-]+)/g)) {
      n++;
      if (m[1] !== eigen) { kaputt.push(`${path.relative(WEB, f)}: verweist auf ${m[1]} statt ${eigen}`); continue; }
      const doc = path.join(WEB, 'docs', 'begruendungen', m[1]);
      if (!fs.existsSync(doc)) { kaputt.push(`${path.relative(WEB, f)}: ${m[1]} fehlt`); continue; }
      if (!fs.readFileSync(doc, 'utf8').includes(`<a id="${m[2]}"></a>`)) kaputt.push(`${path.relative(WEB, f)}: ${m[1]}#${m[2]}`);
    }
  }
  assert.ok(n > 200, `nur ${n} Verweise gefunden — greift die Suche noch?`);
  assert.deepEqual(kaputt, []);
});

test('Anker ohne Verweis werden weniger, nie mehr', () => {
  // Ein Abschnitt, auf den kein Code mehr zeigt, gehört zu einer gekürzten
  // oder entfernten Stelle — Geschichte, die nach git gehört.
  // Gemessen 285 von 901 am 05.11.2026. Gegenprobe: einen Verweis in
  // routes/auth/benutzer.ts gestrichen → rot (289).
  const SCHRANKE = 285;
  const verwiesen = new Set();
  for (const f of mitBegruendungen())
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/docs\/begruendungen\/([^\s#`'"]+\.md)#([\w-]+)/g)) verwiesen.add(`${m[1]}#${m[2]}`);
  const wurzel = path.join(WEB, 'docs', 'begruendungen');
  let alle = 0, ohne = 0;
  (function lauf(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { lauf(p); continue; }
      const rel = path.relative(wurzel, p).split(path.sep).join('/');
      for (const m of fs.readFileSync(p, 'utf8').matchAll(/<a id="([\w-]+)"><\/a>/g)) {
        alle++;
        if (!verwiesen.has(`${rel}#${m[1]}`)) ohne++;
      }
    }
  })(wurzel);
  assert.ok(alle > 500, `nur ${alle} Anker gefunden — greift die Suche noch?`);
  assert.ok(ohne <= SCHRANKE, `${ohne} Anker ohne Verweis, erlaubt sind ${SCHRANKE}`);
  if (ohne < SCHRANKE) console.log(`  ℹ Anker ohne Verweis: ${ohne} (Schranke ${SCHRANKE}) — Schranke nachziehen`);
});

test('jedes Dokument unter docs/begruendungen wird vom Code erreicht', () => {
  // Ein Dokument ohne Verweis ist Geschichte und gehört nach git, nicht in
  // den Baum; eines, dessen Code umgezogen ist, zieht mit (Dateiname = Ort).
  // Gegenprobe: docs/begruendungen/src/verwaist.ts.md angelegt → rot
  // („src/verwaist.ts.md" in der Liste der unerreichten Dokumente).
  const verwiesen = new Set();
  for (const f of mitBegruendungen()) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/docs\/begruendungen\/([^\s#`'"]+\.md)#/g)) verwiesen.add(m[1]);
  }
  const wurzel = path.join(WEB, 'docs', 'begruendungen');
  const dokumente = [];
  (function lauf(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) lauf(p);
      else dokumente.push(path.relative(wurzel, p).split(path.sep).join('/'));
    }
  })(wurzel);
  assert.ok(dokumente.length > 50, `nur ${dokumente.length} Dokumente gefunden — greift die Suche noch?`);
  assert.deepEqual(dokumente.filter(d => !verwiesen.has(d)), []);
});

test('der Kommentaranteil der Betriebsdateien sinkt, nie steigt', () => {
  // Workflows, Dockerfile, compose.yaml, tsconfig.json: Auch dort steht das
  // Warum in wenigen Zeilen, die Geschichte im Commit (CLAUDE.md). Gemessen
  // am 06.11.2026: 23,5 % (vorher 44,0 %). Das Caddyfile zählt nicht mit:
  // Kein Block darin ist länger als fünf Zeilen.
  // Gegenprobe (04.11.2026): 60 Kommentarzeilen an das Dockerfile → rot.
  const SCHRANKE = 23.5;
  const wf = path.join(WEB, '..', '.github', 'workflows');
  const dateien = [
    ...fs.readdirSync(wf).filter(f => /\.ya?ml$/.test(f)).map(f => path.join(wf, f)),
    ...['Dockerfile', 'compose.yaml', 'tsconfig.json'].map(f => path.join(WEB, f)),
  ];
  let zeilen = 0, kommentar = 0;
  for (const f of dateien) {
    for (const z of fs.readFileSync(f, 'utf8').split('\n')) {
      const t = z.trim();
      if (!t) continue;
      zeilen++;
      if (t.startsWith('#') || t.startsWith('//')) kommentar++;
    }
  }
  assert.ok(dateien.length >= 6 && zeilen > 1000, `nur ${dateien.length} Dateien, ${zeilen} Zeilen — greift die Suche noch?`);
  const anteil = Math.round(1000 * kommentar / zeilen) / 10;
  assert.ok(anteil <= SCHRANKE, `${anteil} % Kommentarzeilen in den Betriebsdateien, erlaubt sind ${SCHRANKE} %`);
  if (anteil < SCHRANKE - 0.5) console.log(`  ℹ Kommentaranteil Betrieb: ${anteil} % (Schranke ${SCHRANKE}) — Schranke nachziehen`);
});

/** Kommentarblöcke mit mehr als fünf Zeilen Prosa (vor dem ersten @-Tag), wie im Prüfbericht gezählt.
 * Eine Liste der Gegenproben zählt nicht mit: Sie gehört nach CLAUDE.md in den Kopf eines Tests. */
function langeBloecke(/** @type {string} */ text) {
  const z = text.split('\n');
  const GEGENPROBEN = /^\s*(\*|\/\/)\s*Gegenprobe/;
  let n = 0;
  for (let i = 0; i < z.length; i++) {
    const t = z[i].trim();
    let j = i;
    /** @type {string[] | null} */
    let prosa = null;
    if (t.startsWith('//')) {
      while (j + 1 < z.length && z[j + 1].trim().startsWith('//')) j++;
      prosa = z.slice(i, j + 1);
    } else if (t.startsWith('/*') && !t.includes('*/')) {
      while (j + 1 < z.length && !z[j].includes('*/')) j++;
      let innen = z.slice(i, j + 1);
      const tag = innen.findIndex(l => /^\s*\*\s*@/.test(l));
      if (tag > 0) innen = innen.slice(0, tag);
      prosa = innen.filter(l => !/^\s*(\/\*\*?|\*\/)\s*$/.test(l));
    }
    const liste = prosa ? prosa.findIndex(l => GEGENPROBEN.test(l)) : -1;
    if (prosa && liste >= 0) prosa = prosa.slice(0, liste);
    if (prosa) {
      if (prosa.filter(l => l.replace(/^\s*(\/\/|\*|\/\*\*?)\s?/, '').trim()).length > 5) n++;
      i = j;
    }
  }
  return n;
}

test('lange Kommentare in Tests, Skripten und index.html werden weniger, nie mehr', () => {
  // Im Code steht das Warum in wenigen Zeilen; die Geschichte liegt in
  // docs/begruendungen/ oder im Commit (CLAUDE.md); Gegenprobenlisten zählen nicht.
  // Gemessen am 08.11.2026: Tests 72 Blöcke, scripts 0, index.html 216 Zeilen.
  // Gegenprobe (06.11.2026): sechs Zeilen Prosa vor die Gegenprobe im Kopf von hsts.test.js → rot (Tests 75).
  const SCHRANKE = { tests: 72, scripts: 0, indexHtml: 216 };
  const js = (/** @type {string} */ d) => fs.readdirSync(d).filter(f => f.endsWith('.js')).map(f => path.join(d, f));
  const zaehle = (/** @type {string[]} */ l) => l.reduce((n, f) => n + langeBloecke(fs.readFileSync(f, 'utf8')), 0);
  let html = 0;
  let offen = false;
  for (const z of fs.readFileSync(path.join(WEB, 'public', 'index.html'), 'utf8').split('\n')) {
    if (z.includes('<!--')) offen = true;
    if (offen) html++;
    if (z.includes('-->')) offen = false;
  }
  const ist = { tests: zaehle([...js(__dirname), ...js(path.join(__dirname, 'helpers'))]),
    scripts: zaehle(js(path.join(WEB, 'scripts'))), indexHtml: html };
  assert.ok(ist.tests > 0 && ist.indexHtml > 0, 'nichts gefunden — greift die Suche noch?');
  for (const [k, s] of Object.entries(SCHRANKE)) {
    assert.ok(ist[k] <= s, `${k}: ${ist[k]}, erlaubt sind ${s}`);
    if (ist[k] < s) console.log(`  ℹ lange Kommentare ${k}: ${ist[k]} (Schranke ${s}) — Schranke nachziehen`);
  }
});

test('Testdateien ohne Gegenprobe werden weniger, nie mehr', () => {
  // Jeder Test nennt im Kopf seine Gegenprobe (CLAUDE.md); die älteren ohne
  // werden beim Anfassen nachgetragen. Gemessen 94 am 08.11.2026.
  // Gegenprobe (05.11.2026): in lint-ratsche.test.js „Gegenproben“ umbenannt → rot (112).
  const SCHRANKE = 94;
  const ohne = fs.readdirSync(__dirname).filter(n => n.endsWith('.test.js'))
    .filter(n => !fs.readFileSync(path.join(__dirname, n), 'utf8').includes('Gegenprobe'));
  assert.ok(ohne.length <= SCHRANKE, `${ohne.length} Testdateien ohne Gegenprobe, erlaubt sind ${SCHRANKE}`);
  if (ohne.length < SCHRANKE) console.log(`  ℹ Testdateien ohne Gegenprobe: ${ohne.length} (Schranke ${SCHRANKE}) — Schranke nachziehen`);
});
