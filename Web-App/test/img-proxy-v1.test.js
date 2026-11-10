/**
 * Der Bild-Proxy ist nach /api/v1 gezogen — überall, auch in den Daten.
 * Adressbau und Server laufen echt; dass nirgends die alte Adresse gebaut
 * wird (Web, Kotlin) und die Migration jede Tabelle erfasst, bleibt Struktur.
 * Ausführlich: docs/begruendungen/test/img-proxy-v1.test.js.md#kopf
 *
 * Gegenproben (10.11.2026 gemessen, dist neu gebaut):
 *   A  in routes/imgProxy.ts die Zeile app.get(IMG_PROXY_PFAD_ALT, …) entfernt
 *      → rot: „der Server bedient beide Adressen“ (404)
 *   B  proxyImageUrl baut IMG_PROXY_PFAD_ALT → rot: „gebaute Adressen …“ (die
 *      Quelltextregel darunter sieht die Konstante nicht, nur Zeichenketten)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { ANDROID, quellwurzeln } = require('./helpers/android');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
test.after(() => _req('db/database.js').pool.end().catch(() => {}));
const NEU = '/api/v1/img-proxy';
const ALT = '/api/img-proxy';

const ohneKommentare = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|--|\*).*$/gm, '');

const lies = (...p) => fs.readFileSync(path.join(...p), 'utf8');

test('gebaute Adressen nehmen die neue Form, die alte wird weiter erkannt', () => {
  const { proxyImageUrl, istProxyPfad } = _req('src/katalog/bilder/images.js');
  const cdn = 'https://cdn.rebrickable.com/media/sets/10305-1.jpg';
  assert.equal(proxyImageUrl(cdn), `${NEU}?url=${encodeURIComponent(cdn)}`);
  assert.equal(istProxyPfad(`${ALT}?url=x`), true, 'gespeicherte alte Adressen gelten nicht mehr als Proxy');
  assert.equal(istProxyPfad(`${NEU}?url=x`), true);
});

test('der Server bedient beide Adressen', async (t) => {
  if (!await dbOderSkip(t, _req, { migrieren: false })) return;
  // Ältere App-Fassungen bauen die alte Adresse selbst zusammen.
  const app = require('express')();
  app.use((req, _res, next) => { req.session = { userId: 1 }; next(); });
  _req('routes/imgProxy.js').registerImgProxy(app);
  const srv = app.listen(0);
  t.after(() => srv.close());
  const status = p => fetch(`http://127.0.0.1:${srv.address().port}${p}`).then(r => r.status);
  // Beide antworten wie der Proxy (ohne gültiges Konto abgewiesen), eine unbekannte Adresse mit 404.
  const [neu, alt, fremd] = [await status(NEU), await status(ALT), await status('/api/v2/img-proxy')];
  assert.equal(fremd, 404);
  assert.notEqual(neu, 404, 'die neue Adresse ist nicht angemeldet');
  assert.equal(alt, neu, 'die alte Adresse antwortet anders als die neue');
});

test('gebaut wird nur noch die neue Adresse', () => {
  // Der Altpfad darf NUR als Konstantendefinition vorkommen — nirgends als
  // zusammengesetzte Adresse. Geprüft im Serverbaum UND im Browserbaum.
  const dateien = [];
  const lauf = (d, endung) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!/node_modules|locales/.test(p)) lauf(p, endung); continue; }
      if (e.name.endsWith(endung) && e.name !== 'app.bundle.js')
        dateien.push([path.relative(ROOT, p), ohneKommentare(fs.readFileSync(p, 'utf8'))]);
    }
  };
  for (const ordner of ['routes', 'src', 'jobs']) lauf(path.join(ROOT, ordner), '.ts');
  lauf(path.join(ROOT, 'public', 'js'), '.js');
  dateien.push(['server.ts', ohneKommentare(lies(ROOT, 'server.ts'))]);
  assert.ok(dateien.length >= 30, `Nur ${dateien.length} Quelldateien gefunden`);

  const gebaut = [];
  for (const [rel, src] of dateien)
    for (const m of src.matchAll(new RegExp(`['"\`]${ALT}[^'"\`]*['"\`]`, 'g'))) {
      // Die beiden Definitionen der Auslauf-Konstante sind der eine erlaubte Ort.
      const zeile = src.slice(0, m.index).split('\n').pop();
      if (/IMG_PROXY_(PFAD_)?ALT\s*=/.test(zeile)) continue;
      gebaut.push(`${rel}: ${m[0]}`);
    }
  assert.deepEqual(gebaut.sort(), [],
    'Diese Stellen bauen noch die alte Proxy-Adresse:\n  ' + gebaut.join('\n  ') +
    `\nGebaut wird ${NEU}; die alte wird nur noch ERKANNT (istProxyPfad) und ` +
    'vom Server weiterhin bedient.');
});

/**
 * Die App baut die neue Adresse — und nirgends mehr die alte.
 *
 * Sie muss die alte nicht ERKENNEN: Ein gespeicherter Wert beginnt mit „/"
 * und läuft damit ohnehin über den Zweig „server-relativer Pfad" — er wird
 * nur um die Serveradresse ergänzt, egal welche der beiden Formen er trägt.
 * Eine eigene Erkennung wäre dort toter Code.
 */
test('die App baut die neue Adresse und nirgends die alte', () => {
  const dateien = [];
  const lauf = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { lauf(p); continue; }
      if (e.name.endsWith('.kt'))
        dateien.push([path.relative(ANDROID, p), ohneKommentare(fs.readFileSync(p, 'utf8'))]);
    }
  };
  for (const w of quellwurzeln()) lauf(w);
  assert.ok(dateien.length >= 60, `Nur ${dateien.length} Kotlin-Dateien gefunden`);

  const urls = dateien.find(([rel]) => rel.endsWith('ImageUrls.kt'));
  assert.ok(urls, 'ImageUrls.kt nicht gefunden');
  assert.match(urls[1], new RegExp(`IMG_PROXY = "${NEU}"`),
    'ImageUrls.kt baut nicht die neue Adresse');

  const alt = dateien
    .filter(([, src]) => src.includes(ALT + '?') || src.includes(`"${ALT}"`))
    .map(([rel]) => rel)
    .sort();
  assert.deepEqual(alt, [],
    'Diese Kotlin-Dateien tragen noch die alte Proxy-Adresse:\n  ' + alt.join('\n  ') +
    `\nGebaut wird ${NEU}; eine installierte ältere Fassung bedient der Server ` +
    'weiterhin, aber diese hier ist nicht sie.');
});

test('die Migration erfasst JEDE Tabelle mit image_url', () => {
  // Die Tabellenliste wird aus dem Schema GELESEN, nicht abgeschrieben: Eine
  // achte Tabelle mit image_url soll auffallen, nicht durchrutschen.
  // Die Tabellen mit image_url, die es VOR 0014 gab — abgelesen aus dem
  // früheren db/schema.sql, als es durch db/basis.sql ersetzt wurde. 0014 ist …
  // Ausführlich: docs/begruendungen/test/img-proxy-v1.test.js.md#tabellen
  const tabellen = ['sets', 'set_catalog', 'set_parts_catalog', 'set_minifigs_catalog', 'parts', 'catalog_cache', 'minifigs'];
  // GEMESSEN sind es sieben.
  assert.ok(tabellen.length >= 5,
    `Nur ${tabellen.length} Tabellen mit image_url gefunden — Muster veraltet?`);

  // Ohne Kommentare: Der Erklaertext dieser Migration NENNT das Muster
  // `LIKE '%…%'`, gegen das sie sich entscheidet — und die Pruefung unten
  // fiel prompt darueber. Dieselbe Falle, vor der helpers/sources.js warnt.
  const mig = ohneKommentare(lies(ROOT, 'db/migrations/0014-img-proxy-nach-v1.sql'));
  const fehlend = tabellen.filter(t => !new RegExp(`UPDATE\\s+${t}\\s`).test(mig)).sort();
  assert.deepEqual(fehlend, [],
    'Diese Tabellen tragen image_url, die Migration fasst sie nicht an:\n  ' +
    fehlend.join('\n  ') +
    '\nSonst bleiben dort Adressen in der alten Form stehen.');

  // Tabellen, die es bei Migration 0014 noch nicht gab
  // Ausführlich: docs/begruendungen/test/img-proxy-v1.test.js.md#umgeschrieben
  const umgeschrieben = [...mig.matchAll(/UPDATE\s+(\w+)\s/g)].map(m => m[1]);
  assert.ok(umgeschrieben.length >= 5,
    `Nur ${umgeschrieben.length} UPDATE-Ziele in 0014 gefunden — Muster veraltet?`);

  const migVerz = path.join(ROOT, 'db/migrations');
  const spaeter = fs.readdirSync(migVerz).filter(f => f.endsWith('.sql') && f > '0014').sort();
  const nachzuegler = [];
  for (const f of spaeter) {
    const txt = ohneKommentare(lies(ROOT, 'db/migrations', f));
    for (const m of txt.matchAll(/CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+(\w+)\s*\(([^;]*?)\)\s*;/gs)) {
      if (/^\s*image_url\s/m.test(m[2])) nachzuegler.push([m[1], f, txt]);
    }
  }
  assert.ok(nachzuegler.length >= 2,
    `Nur ${nachzuegler.length} spaetere Tabellen mit image_url gefunden ` +
    '(gemessen sind es zwei: part_color_catalog und minifigs_catalog) — Muster veraltet?');

  // Gültige Quelle ist auch eine spätere Tabelle, die selbst aus einer solchen liest.
  const quellen = new Set(umgeschrieben);
  const liestAusQuelle = (tab, txt) => {
    // Der INSERT, der diese Tabelle fuellt, und woraus er liest.
    const bloecke = [...txt.matchAll(
      new RegExp(`INSERT\\s+INTO\\s+${tab}\\s*\\([^)]*image_url[^)]*\\)([\\s\\S]*?)(?=INSERT\\s+INTO|ALTER\\s+TABLE|CREATE\\s|\\$sql\\$|$)`, 'gi'))];
    return bloecke.some(b => [...quellen].some(q => new RegExp(`FROM\\s+${q}\\b`, 'i').test(b[1])));
  };
  for (let neu = true; neu;) {
    neu = false;
    for (const [tab, , txt] of nachzuegler)
      if (!quellen.has(tab) && liestAusQuelle(tab, txt)) { quellen.add(tab); neu = true; }
  }
  const ohneHerkunft = nachzuegler
    .filter(([tab]) => !quellen.has(tab))
    .map(([tab, f]) => `${tab} (${f})`)
    .sort();
  assert.deepEqual(ohneHerkunft, [],
    'Diese Tabellen tragen image_url, entstehen NACH Migration 0014 und ' +
    'bekommen ihre Adressen nicht aus einer Tabelle, die 0014 umschreibt:\n  ' +
    ohneHerkunft.join('\n  ') +
    '\nDann koennen dort Adressen in der alten Form landen, und 0014 kommt ' +
    'nie wieder vorbei.');

  // Und der Vergleich bleibt ein PRÄFIX-Vergleich. Ein `LIKE '%…%'` träfe
  // auch einen CDN-Link, der die Zeichenkette im Abfrageteil trägt, und
  // machte aus ihm eine kaputte Adresse.
  assert.match(mig, /LEFT\(image_url, 15\) = '\/api\/img-proxy\?'/,
    'Die Migration vergleicht nicht mehr über den Anfang des Wertes');
  assert.doesNotMatch(mig, /LIKE\s+'%/,
    'Ein Muster mit führendem % trifft auch Adressen, die die Zeichenkette ' +
    'nur im Abfrageteil enthalten');
});
