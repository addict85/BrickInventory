/**
 * Der Bild-Proxy ist nach /api/v1 gezogen — überall, auch in den Daten.
 *
 * ── Der Befund (Nachtrag 162) ───────────────────────────────────────────────
 *
 * Auf die Frage „läuft jetzt alles unter v1?" antwortete der Baum „ja". Die
 * Prüfung dazu las `app.get('/api/…')` aber NUR in server.ts, und diese Route
 * wird in routes/imgProxy.ts angemeldet (registerImgProxy). Sie war damit die
 * letzte Adresse neben /api/v1.
 *
 * ── Warum der Umzug mehr ist als eine geänderte Zeichenkette ────────────────
 *
 * Diese Adresse wird GESPEICHERT, nicht nur gerufen: utils/images.ts baut sie
 * in `image_url`, und die Werte stehen so in den Tabellen. Ein Umzug, der nur
 * die bauende Stelle anfasst, hinterlässt zwei Formen in derselben Spalte —
 * genau die Bauart, gegen die dieser Baum sonst prüft. Deshalb gehört
 * db/migrations/0014-img-proxy-nach-v1.sql dazu.
 *
 * ── Und warum die alte Adresse trotzdem bedient bleibt ──────────────────────
 *
 * Installierte App-Fassungen bauen sie SELBST zusammen (ImageUrls.kt). Wer
 * nicht aktualisiert, bekäme sonst überhaupt keine Teilebilder mehr. Sie ist
 * eine Auslauf-Adresse, kein zweiter gleichrangiger Weg — und der Unterschied
 * ist genau das, was dieser Test festhält: BEIDE werden bedient, aber nur die
 * neue wird GEBAUT.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, '..', 'Android-App', 'app', 'src', 'main');
const NEU = '/api/v1/img-proxy';
const ALT = '/api/img-proxy';

const ohneKommentare = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|--|\*).*$/gm, '');

const lies = (...p) => fs.readFileSync(path.join(...p), 'utf8');

test('die Adresse steht an einer Stelle, und es ist die neue', () => {
  const images = lies(ROOT, 'utils', 'images.ts');
  assert.match(images, new RegExp(`IMG_PROXY_PFAD = '${NEU}'`),
    `utils/images.ts führt ${NEU} nicht als IMG_PROXY_PFAD`);
  assert.match(images, new RegExp(`IMG_PROXY_PFAD_ALT = '${ALT}'`),
    `utils/images.ts führt ${ALT} nicht als Auslauf-Adresse`);
});

test('der Server bedient beide Adressen', () => {
  const proxy = ohneKommentare(lies(ROOT, 'routes', 'imgProxy.ts'));
  for (const name of ['IMG_PROXY_PFAD', 'IMG_PROXY_PFAD_ALT'])
    assert.match(proxy, new RegExp(`app\\.get\\(${name},`),
      `registerImgProxy meldet ${name} nicht an — ` +
      (name.endsWith('ALT')
        ? 'ältere App-Fassungen bauen genau diese Adresse selbst zusammen und bekämen keine Bilder mehr'
        : 'das ist die kanonische Adresse'));
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
  for (const ordner of ['routes', 'utils', 'jobs']) lauf(path.join(ROOT, ordner), '.ts');
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
  const wurzel = path.join(APP, 'java');
  const dateien = [];
  const lauf = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { lauf(p); continue; }
      if (e.name.endsWith('.kt'))
        dateien.push([path.relative(wurzel, p), ohneKommentare(fs.readFileSync(p, 'utf8'))]);
    }
  };
  lauf(wurzel);
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
  const schema = lies(ROOT, 'db', 'schema.sql');
  const tabellen = [];
  let aktuell = null;
  for (const z of schema.split('\n')) {
    const m = /^\s*CREATE TABLE (?:IF NOT EXISTS )?(\w+)/.exec(z);
    if (m) aktuell = m[1];
    if (/^\s*image_url\s/.test(z) && aktuell) tabellen.push(aktuell);
  }
  // GEMESSEN sind es sieben.
  assert.ok(tabellen.length >= 5,
    `Nur ${tabellen.length} Tabellen mit image_url gefunden — Muster veraltet?`);

  // Ohne Kommentare: Der Erklaertext dieser Migration NENNT das Muster
  // `LIKE '%…%'`, gegen das sie sich entscheidet — und die Pruefung unten
  // fiel prompt darueber. Dieselbe Falle, vor der helpers/sources.js warnt.
  const mig = ohneKommentare(lies(ROOT, 'db', 'migrations', '0014-img-proxy-nach-v1.sql'));
  const fehlend = tabellen.filter(t => !new RegExp(`UPDATE\\s+${t}\\s`).test(mig)).sort();
  assert.deepEqual(fehlend, [],
    'Diese Tabellen tragen image_url, die Migration fasst sie nicht an:\n  ' +
    fehlend.join('\n  ') +
    '\nSonst bleiben dort Adressen in der alten Form stehen.');

  // Und der Vergleich bleibt ein PRÄFIX-Vergleich. Ein `LIKE '%…%'` träfe
  // auch einen CDN-Link, der die Zeichenkette im Abfrageteil trägt, und
  // machte aus ihm eine kaputte Adresse.
  assert.match(mig, /LEFT\(image_url, 15\) = '\/api\/img-proxy\?'/,
    'Die Migration vergleicht nicht mehr über den Anfang des Wertes');
  assert.doesNotMatch(mig, /LIKE\s+'%/,
    'Ein Muster mit führendem % trifft auch Adressen, die die Zeichenkette ' +
    'nur im Abfrageteil enthalten');
});
