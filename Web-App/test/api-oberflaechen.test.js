/**
 * EINE Adresse, eine Umsetzung — und nur noch EINE Oberfläche.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// Kommentare entfernen — sonst zählen auskommentierte Routen mit. Der Helfer
// statt eines naiven /\*…\*\/: `'/images/*pfad'` in server.ts eröffnete für
// diesen sonst einen Kommentar bis zum nächsten echten Kommentarende.
const { ohneKommentare } = require('./helpers/sources');

/** Alle `router.<verb>('<pfad>'` einer Datei, mit vorangestelltem Mountpunkt. */
function routenAus(datei, mount) {
  const src = ohneKommentare(fs.readFileSync(datei, 'utf8'));
  const out = [];
  for (const m of require('./helpers/sources').routenAusQuelle(src, mount)) {
    const pfad = (mount + '/' + m[2].replace(/^\//, '')).replace(/\/+$/, '') || '/';
    out.push(`${m[1].toUpperCase()} ${pfad}`);
  }
  return out;
}

/**
 * Die Mountpunkte der Webapp aus server.ts lesen. Hart eingetragen wäre die
 * Liste genau so lange richtig, bis jemand einen Router dazustellt — und
 * dessen Routen fielen dann stillschweigend aus der Prüfung.
 */
function webRouter() {
  // Dieselbe Lesart wie in den übrigen Prüfungen (helpers/sources.js); api_v1 ist die zweite Oberfläche.
  return require('./helpers/sources').routerEinhaengungen();
}

/**
 * Erlaubte Überschneidungen — mit dem Grund, warum es hier ZWEI Umsetzungen
 * geben muss statt einer. Wer eine Zeile hinzufügt, schreibt den Grund dazu;
 * wer keinen hat, hat eine Doppelung gefunden.
 */
/**
 * Adressen, die es ZWEIMAL geben darf — mit dem Grund.
 */
const ERLAUBT = new Map([]);

/** Präfix weg: /api/v1/sets/x und /api/sets/x werden beide zu /sets/x. */
function ohnePraefix(eintrag) {
  return eintrag.replace(/ \/api(\/v1)?/, ' ');
}

test('keine unbegruendete Route auf beiden API-Oberflaechen', () => {
  const web = new Set();
  for (const r of webRouter()) for (const x of routenAus(r.datei, r.mount)) web.add(x);

  const v1 = new Set();
  const v1Dir = path.join(ROOT, 'routes/api_v1');
  for (const f of fs.readdirSync(v1Dir)) {
    if (!f.endsWith('.ts') || f === 'index.ts' || f === 'middleware.ts') continue;
    for (const x of routenAus(path.join(v1Dir, f), '/api')) v1.add(x);
  }

  // Selbstbeweis: Greift das Muster nicht mehr (umbenanntes `router`, andere
  // Schreibweise des Mountpunkts), waeren beide Mengen leer und der Test
  // gruen, ohne etwas geprueft zu haben.
  assert.ok(web.size >= 30, `Nur ${web.size} Webapp-Routen gefunden — Muster veraltet?`);
  assert.ok(v1.size >= 80, `Nur ${v1.size} v1-Routen gefunden — Muster veraltet?`);

  // Beide Seiten ohne Praefix vergleichen: Seit dem Umzug haengen die
  // Webapp-Router selbst unter /api/v1/<bereich>, und ein Vergleich der rohen
  // Adressen faende gar keine Ueberschneidung mehr — der Test waere gruen,
  // ohne etwas zu pruefen.
  const webN = new Set([...web].map(ohnePraefix));
  const v1N = new Set([...v1].map(ohnePraefix));
  const doppelt = [...webN].filter(r => v1N.has(r)).sort();
  const unbegruendet = doppelt.filter(r => !ERLAUBT.has(r));
  assert.deepEqual(
    unbegruendet,
    [],
    'Diese Adressen stehen auf BEIDEN Oberflaechen, ohne dass ein Grund ' +
      'eingetragen waere:\n  ' +
      unbegruendet.join('\n  ') +
      '\nZwei Umsetzungen derselben Antwort driften — gemessen bei ' +
      'GET /settings: Webapp 48, App 24. Entweder die Logik in einem Dienst ' +
      'zusammenlegen und beide Routen daraus bedienen, oder in ERLAUBT ' +
      'eintragen, WARUM es zwei sein muessen.',
  );

  // Eine Zeile, die niemand mehr braucht, ist eine Erlaubnis, die niemand
  // prueft — dieselbe Regel wie in scripts/check-global-settings.js.
  const veraltet = [...ERLAUBT.keys()].filter(r => !doppelt.includes(r));
  assert.deepEqual(
    veraltet,
    [],
    'Diese Eintraege in ERLAUBT beschreiben keine Ueberschneidung mehr — ' + 'streichen:\n  ' + veraltet.join('\n  '),
  );
});

test('jeder Router haengt unter /api/v1', () => {
  const NOCH_NICHT = new Map([]);

  const einhaengungen = webRouter();
  // Selbstbeweis: Findet das Muster keine Einhaengepunkte, prueft alles
  // darunter nichts und waere trotzdem gruen.
  // Einer: auth. Einstellungen, Sets, Teile und Figuren gingen in den v1-Router auf.
  assert.ok(
    einhaengungen.length >= 1,
    `Nur ${einhaengungen.length} Router-Einhaengepunkte in server.ts gefunden — Muster veraltet?`,
  );

  const daneben = einhaengungen
    .map(r => r.mount)
    .filter(m => !m.startsWith('/api/v1') && !NOCH_NICHT.has(m))
    .sort();
  assert.deepEqual(
    daneben,
    [],
    'Diese Router haengen NICHT unter /api/v1 und stehen auch nicht als ' +
      'begruendete Ausnahme da:\n  ' +
      daneben.join('\n  ') +
      '\nEntweder umhaengen oder in NOCH_NICHT eintragen, WARUM noch nicht.',
  );

  // Und die Ausnahme darf nicht liegenbleiben: Steht sie da, obwohl der Router
  // laengst umgezogen ist, sieht die Umstellung unfertiger aus als sie ist.
  const erledigt = [...NOCH_NICHT.keys()].filter(m => !einhaengungen.some(r => r.mount === m));
  assert.deepEqual(
    erledigt,
    [],
    'Diese Ausnahmen beschreiben keinen Einhaengepunkt mehr — streichen:\n  ' + erledigt.join('\n  '),
  );
});

/**
 * Auch die Routen, die DIREKT in server.ts stehen.
 */
test('auch die direkt angemeldeten Routen stehen unter /api/v1', () => {
  // Die EINE Ausnahme, und sie ist keine Nachlaessigkeit:
  // Die EINE Ausnahme — und sie ist eine Auslauf-Adresse, keine zweite
  // gleichrangige.
  const OHNE_VERSION = new Map([
    [
      'GET /api/img-proxy',
      'Auslauf-Adresse. Die kanonische ist /api/v1/img-proxy; alles, was der ' +
        'Server heute baut, beide Oberflaechen und die gespeicherten Zeilen ' +
        '(Migration 0014) benutzen sie. Bedient bleibt die alte, weil ' +
        'INSTALLIERTE App-Fassungen sie selbst zusammenbauen (ImageUrls.kt) — ' +
        'wer nicht aktualisiert, bekaeme sonst gar keine Teilebilder mehr. Dass ' +
        'nur noch die neue GEBAUT wird, haelt test/abgleich-img-proxy-v1.test.js fest.',
    ],
  ]);

  // Alle .ts des Serverbaums, nicht nur server.ts.
  const dateien = [path.join(ROOT, 'server.ts')];
  const lauf = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        lauf(p);
        continue;
      }
      if (e.name.endsWith('.ts')) dateien.push(p);
    }
  };
  for (const ordner of ['routes', 'src', 'jobs']) lauf(path.join(ROOT, ordner));
  assert.ok(dateien.length >= 30, `Nur ${dateien.length} Serverdateien gefunden`);

  // Auch Anmeldungen ueber eine KONSTANTE
  const quellen = dateien.map(d => ohneKommentare(fs.readFileSync(d, 'utf8')));
  const konstanten = new Map();
  for (const src of quellen)
    for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Z][A-Z0-9_]*)\s*=\s*'(\/api\/[^']*)'/g))
      konstanten.set(m[1], m[2]);

  const gefunden = [];
  for (const src of quellen) {
    for (const m of src.matchAll(/\bapp\.(get|post|put|patch|delete)\(\s*'(\/api\/[^']*)'/g))
      gefunden.push(`${m[1].toUpperCase()} ${m[2]}`);
    for (const m of src.matchAll(/\bapp\.(get|post|put|patch|delete)\(\s*([A-Z][A-Z0-9_]*)\s*,/g)) {
      const pfad = konstanten.get(m[2]);
      assert.ok(
        pfad,
        `app.${m[1]}(${m[2]}, …) meldet eine Route unter einem Bezeichner an, ` +
          'dessen Wert hier nicht auffindbar ist. Ohne ihn kann diese Pruefung ' +
          'nicht sagen, ob die Adresse unter /api/v1 liegt.',
      );
      gefunden.push(`${m[1].toUpperCase()} ${pfad}`);
    }
  }
  // Selbstbeweis: Findet das Muster nichts, prueft alles darunter nichts.
  // ZWEI ist der GEMESSENE Stand (die beiden Adressen des Bild-Proxys); health
  // und startup-status hängen im Router routes/gesundheit.ts.
  assert.ok(gefunden.length >= 2, `Nur ${gefunden.length} direkt angemeldete API-Routen gefunden — Muster veraltet?`);

  const daneben = gefunden.filter(r => !r.split(' ')[1].startsWith('/api/v1') && !OHNE_VERSION.has(r)).sort();
  assert.deepEqual(
    daneben,
    [],
    'Diese Adressen sind direkt an der App angemeldet, stehen nicht unter ' +
      '/api/v1 und haben keinen eingetragenen Grund:\n  ' +
      daneben.join('\n  ') +
      '\nEntweder umziehen oder in OHNE_VERSION eintragen, WARUM sie ' +
      'versionslos bleiben muss.',
  );

  // Dieselbe Gegenrichtung wie oben: eine Ausnahme fuer eine Route, die es
  // nicht mehr gibt, laesst die Umstellung unfertiger aussehen als sie ist.
  const veraltet = [...OHNE_VERSION.keys()].filter(r => !gefunden.includes(r));
  assert.deepEqual(
    veraltet,
    [],
    'Diese Ausnahmen beschreiben keine Route mehr — streichen:\n  ' + veraltet.join('\n  '),
  );
});

/**
 * Der Gesundheitscheck aus compose.yaml zeigt auf eine Adresse, die es gibt.
 */
test('der Gesundheitscheck aus compose.yaml zeigt auf eine echte Adresse', () => {
  const compose = fs.readFileSync(path.join(ROOT, 'compose.yaml'), 'utf8');
  const treffer = compose.match(/http:\/\/localhost:\d+(\/api\/[^'"\s)]*)/);
  assert.ok(treffer, 'compose.yaml enthaelt keinen Gesundheitscheck auf eine /api-Adresse');
  const adresse = treffer[1];

  const src = ohneKommentare(fs.readFileSync(path.join(ROOT, 'server.ts'), 'utf8'));
  const direkt = [...src.matchAll(/app\.get\(\s*'(\/api\/[^']*)'/g)].map(m => m[1]);
  // Und die GET-Routen der in server.ts eingehängten Router (routes/gesundheit.ts).
  for (const r of webRouter())
    for (const m of require('./helpers/sources').routenAusQuelle(
      ohneKommentare(fs.readFileSync(r.datei, 'utf8')),
      r.mount,
    ))
      if (m[1] === 'get') direkt.push(r.mount + m[2]);
  assert.ok(direkt.length >= 2, `Nur ${direkt.length} direkte GET-Routen gefunden — Muster veraltet?`);
  assert.ok(
    direkt.includes(adresse),
    `compose.yaml prueft ${adresse}; server.ts kennt nur ${direkt.join(', ')}. ` +
      'Der Container gaelte damit dauerhaft als „unhealthy", ohne dass die ' +
      'Anwendung selbst etwas davon merkt.',
  );
});
