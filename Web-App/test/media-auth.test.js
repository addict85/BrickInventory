/**
 * Bilder und PDFs verlangen ausnahmslos eine Anmeldung.
 *
 * Gegenproben zu den 08.11.2026 gestrichenen Fällen, die anderswo laufen:
 * Anmeldung und `private` an Bild und Anleitung → bild-blickfeld-db.test.js
 * (liefereBild ohne 401 bzw. mit `public` → dort rot); PDF-Download ohne
 * requireToken → verdrahtung-laeuft-db.test.js rot.
 * „die Webapp ruft nie direkt ein CDN auf“ → bilder-proxy-oberflaeche.test.js
 * (imgUrl() bzw. fullUrl() geben eine CDN-Adresse roh zurück → dort rot, H bzw. D).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
// Die Bildroute steht in routes/seiten.ts, ihr Rumpf in src/katalog/http/bildAuslieferung.ts.
const SERVER = ['server.ts', 'routes/seiten.ts', 'src/katalog/http/bildAuslieferung.ts'].map(read).join('\n');
/**
 * Kommentare weg — der Erklärtext oben nennt express.static selbst.
 */
function ohneKommentare(src) {
  let out = '',
    i = 0,
    str = null;
  while (i < src.length) {
    const c = src[i],
      n = src[i + 1];
    if (str) {
      // in einer Zeichenkette
      if (c === '\\') {
        out += c + (n ?? '');
        i += 2;
        continue;
      }
      if (c === str) str = null;
      out += c;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      str = c;
      out += c;
      i++;
      continue;
    }
    if (c === '/' && n === '*') {
      // Blockkommentar
      const e = src.indexOf('*/', i + 2);
      const bis = e < 0 ? src.length : e + 2;
      for (const ch of src.slice(i, bis)) if (ch === '\n') out += '\n'; // Zeilen erhalten
      i = bis;
      continue;
    }
    if (c === '/' && n === '/') {
      // Zeilenkommentar
      const e = src.indexOf('\n', i);
      i = e < 0 ? src.length : e;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}
const CODE = ohneKommentare(SERVER);

test('kein statischer Mount liefert Dateien aus dem Datenverzeichnis aus', () => {
  // express.static kennt keine Anmeldeprüfung. Für PUBLIC_DIR ist das richtig
  // (CSS, JavaScript, Schriften), für IMAGES_DIR war es die Lücke.
  const mounts = [...CODE.matchAll(/express\.static\(([A-Za-z_$][\w$]*)/g)].map(m => m[1]);
  assert.deepEqual(
    mounts,
    ['PUBLIC_DIR'],
    `express.static über: ${mounts.join(', ')} — nur PUBLIC_DIR darf ohne Anmeldung ausgeliefert werden`,
  );
});

test('der Platzhalter liegt ausserhalb von /images/', () => {
  // Er ist ein Build-Asset wie CSS und JavaScript und wird auch angezeigt,
  // wenn gar kein Bild vorhanden ist — unter /images/ hätte er die Regel
  // "alles hier verlangt Anmeldung" durchlöchert.
  assert.ok(
    fs.existsSync(path.join(ROOT, 'public', 'assets', 'set-placeholder.svg')),
    'public/assets/set-placeholder.svg fehlt',
  );
  assert.ok(
    !fs.existsSync(path.join(ROOT, 'public', 'images')),
    'public/images/ darf es nicht mehr geben — sonst überlagert es data/images/',
  );

  const refs = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'public', 'js'))) {
    if (!f.endsWith('.js') || f === 'app.bundle.js') continue;
    const src = fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8');
    if (src.includes('/images/set-placeholder')) refs.push(f);
  }
  if (read('public/index.html').includes('/images/set-placeholder')) refs.push('index.html');
  assert.deepEqual(refs, [], `Alte Platzhalter-Adresse in: ${refs.join(', ')}`);
});

test('die SQL-Migrationen landen im Build', () => {
  // Woher dieser Test kommt
  const build = read('scripts/build-ts.js');
  assert.match(build, /ASSET_EXT/, 'build-ts.js kopiert keine Nicht-TS-Dateien mit — .sql-Migrationen fehlen im Build');
  assert.match(build, /'\.sql'/, '.sql muss unter den mitkopierten Endungen stehen');
});

test('data-self-Handler nehmen das Element als ERSTES Argument', () => {
  // Woher dieser Test kommt
  const fs2 = require('node:fs');
  const jsDir = path.join(ROOT, 'public', 'js');
  const files = fs2.readdirSync(jsDir).filter(f => /^\d\d-/.test(f) && f !== '00-registry.js');
  const withSelfAndArg = new Set();
  for (const f of files) {
    const src = fs2.readFileSync(path.join(jsDir, f), 'utf8');
    for (const m of src.matchAll(/data-click="([A-Za-z_$][\w$]*)"[^>]*?data-arg=/g)) {
      const after = src.slice(m.index, m.index + 400);
      if (after.includes('data-self="1"')) withSelfAndArg.add(m[1]);
    }
  }
  assert.ok(withSelfAndArg.size > 0, 'Keine data-self+data-arg-Handler gefunden — Prüfung liefe ins Leere');

  const wrong = [];
  for (const f of files) {
    const src = fs2.readFileSync(path.join(jsDir, f), 'utf8');
    for (const name of withSelfAndArg) {
      const m = src.match(new RegExp(`function ${name}\\(([^)]*)\\)`));
      if (!m) continue;
      const first = m[1].split(',')[0].trim();
      // Das Element heisst in diesem Projekt durchgehend btn/el.
      if (!/^(btn|el)\b/.test(first)) wrong.push(`${name}(${m[1]})`);
    }
  }
  assert.deepEqual(wrong, [], `Element gehört an die erste Stelle: ${wrong.join(', ')}`);
});

test('Adressen auf den eigenen Server gehen nicht durch den Proxy', () => {
  // Woher dieser Test kommt
  const vm = require('node:vm');
  const src = require('./helpers/sources')
    .coreQuelle()
    .replace(/^export /gm, '')
    .replace(/^import[^;]*;\s*$/gm, '');
  const ctx = { console, encodeURIComponent, decodeURIComponent, location: { origin: 'https://example.test' } };
  vm.createContext(ctx);
  // Ab den ADRESSHELFERN, nicht erst ab stripOwnOrigin: fullUrl() erkennt
  // eine Proxy-Adresse ueber istProxyPfad(), und das steht mit den beiden
  // Konstanten gleich darueber. Vorher endete dieser Pruefstand in
  // „istProxyPfad is not defined" — die Funktion war da, nur nicht im
  // ausgeschnittenen Stueck.
  vm.runInContext(
    src.slice(src.indexOf('const IMG_PROXY ='), src.indexOf('function thumbUrl', src.indexOf('const IMG_PROXY ='))),
    ctx,
  );
  const { imgUrl, fullUrl } = vm.runInContext('({ imgUrl, fullUrl })', ctx);

  assert.equal(
    fullUrl('https://example.test/images/sets/9396-1_thumb.jpg'),
    '/images/sets/9396-1.jpg',
    'Eigene Adressen müssen als Pfad behandelt werden, nicht proxiert',
  );
  assert.equal(
    imgUrl('https://example.test/images/sets/9396-1.jpg', true),
    '/images/sets/9396-1.jpg',
    'Auch imgUrl darf die eigene Adresse nicht in den Proxy stecken',
  );

  // Fremde Hosts laufen weiterhin über den Proxy — das ist der Zweck der
  // Umstellung und darf durch diesen Fix nicht verlorengehen.
  assert.match(
    fullUrl('https://cdn.rebrickable.com/media/sets/9396-1.jpg'),
    /^\/api\/v1\/img-proxy\?url=/,
    'CDN-Adressen müssen weiterhin über das Backend laufen',
  );
});

// Wer hochgeladene Anleitungen lesen darf, prüft test/daten-dateien-db.test.js am Handler.

// „Eine geteilte Anleitungsdatei überlebt, bis die letzte Zeile weg ist“ prüft
// test/sets-routes-db.test.js am laufenden Router (Löschen durch beide Konten).
