/**
 * Zu jeder Route gehört jemand, der sie ruft — oder ein eingetragener Grund.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { routerEinhaengungen } = require('./helpers/sources');

const ROOT = path.join(__dirname, '..');
const { appSchnittstelle } = require('./helpers/vertrag');

function ohneKommentare(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function routesFrom(datei, mount) {
  const src = ohneKommentare(fs.readFileSync(datei, 'utf8'));
  const out = [];
  for (const m of require('./helpers/sources').routesFromSource(src, mount))
    out.push([m[1].toUpperCase(), (mount + '/' + m[2].replace(/^\//, '')).replace(/\/+$/, '')]);
  return out;
}

function allRoutes() {
  const out = [];
  // Einhaengepunkte aus server.ts GELESEN statt abgeschrieben: Eine
  // abgeschriebene Liste veraltet still. Siehe routerEinhaengungen().
  for (const r of routerEinhaengungen()) out.push(...routesFrom(r.datei, r.mount));
  const v1 = path.join(ROOT, 'routes/api_v1');
  for (const f of fs.readdirSync(v1)) {
    if (!f.endsWith('.ts') || f === 'index.ts' || f === 'middleware.ts') continue;
    out.push(...routesFrom(path.join(v1, f), '/api/v1'));
  }
  return out;
}

/** Browser-Code und Vorlagen; die Aufrufe der App stehen in shared/app-schnittstelle.json. */
function clientSources() {
  const dateien = [];
  const collect = (dir, extensions) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'build') collect(p, extensions);
        continue;
      }
      // app.bundle.js ist das Erzeugnis aus public/js/*.js — mitzuzaehlen
      // hiesse, jeden Aufruf doppelt zu sehen, und ein Aufruf, den es nur im
      // Erzeugnis gaebe, waere ein Fehler und kein Beleg.
      if (e.name === 'app.bundle.js') continue;
      if (extensions.some(x => e.name.endsWith(x))) dateien.push(p);
    }
  };
  collect(path.join(ROOT, 'public'), ['.js', '.html']);
  collect(path.join(ROOT, 'views'), ['.js', '.html', '.ejs']);
  return dateien;
}

/**
 * Routen ohne Aufrufer im Quelltext — mit dem Grund, warum das in Ordnung ist.
 * Wer eine Zeile hinzufügt, schreibt den Grund dazu; wer keinen hat, hat eine
 * Route gefunden, die niemand mehr braucht.
 */
// Fuenf Eintraege sind hier verschwunden, weil die Routen es sind
const WITHOUT_CALLER = new Map([
  ['GET /api/v1/health', 'Für Überwachung von aussen (Status, Details nur für Verwalter).'],
  ['GET /api/v1/health/live', 'Lebenszeichen des Prozesses für eine Überwachung von aussen.'],
  ['GET /api/v1/health/ready', 'Gesundheitsprüfung von compose.yaml (node -e im Container).'],
  // Die Token-Routen fehlen hier, weil ihre Oberfläche jetzt unter
  // „Angemeldete Geräte“ steht und sie damit einen Aufrufer haben.
  [
    'POST /api/v1/admin/img-probe',
    'Diagnosewerkzeug, von Hand gerufen: zeigt, was der Bild-Proxy vom ' +
      'Ursprungsserver bekommt. Entstanden, weil Minifiguren-Bilder über den ' +
      'Proxy fehlschlugen, im Browser aber luden.',
  ],
  [
    'POST /api/v1/admin/price-probe',
    'Diagnosewerkzeug, von Hand gerufen: zeigt, woher ein Preis stammt ' +
      '(Zustandswahl, Cache oder BrickLink-Antwort).',
  ],
  [
    'GET /api/v1/admin/image-diag/:setNumber',
    'Diagnosewerkzeug, von Hand gerufen: reine Beobachtung des Bildzustands ' + 'eines Sets, ohne etwas nachzuladen.',
  ],
  [
    'POST /api/v1/admin/forget-image-misses',
    'Wartungsgriff, von Hand gerufen: nimmt gemerkte Bild-Fehlanzeigen zurück, ' +
      'damit der Nachlauf es erneut versucht.',
  ],
  [
    'GET /api/v1/catalog/bricklink',
    'Gebündelte Abfrage der BrickLink-Nummern aus dem lokalen Katalog-Cache. ' +
      'Gegen BrickLink selbst geht das nicht (deren API kennt nur einzelne ' +
      'Artikel und drosselt) — deshalb existiert die Route, benutzt wird sie ' +
      'noch nicht.',
  ],
  [
    'POST /api/v1/auth/token-create',
    'Stellt einen App-Token für eine bereits bestehende Anmeldung aus ' +
      '(Sitzung ODER Token). Die App holt ihren Token beim Anmelden, die Webapp ' +
      'über den QR-Weg (/auth/qr-token) — dieser dritte Weg wird derzeit von ' +
      'keinem der beiden gerufen.',
  ],
]);

test('jede Route hat einen Aufrufer oder einen eingetragenen Grund', () => {
  const routen = allRoutes();
  const quellen = clientSources();
  assert.ok(quellen.length >= 20, `Nur ${quellen.length} Client-Dateien gefunden — Pfade veraltet?`);
  const text = [
    ...quellen.map(p => fs.readFileSync(p, 'utf8')),
    ...appSchnittstelle().routen.map(r => r.pfad),
    ...appSchnittstelle().adressen,
  ].join('\n');

  assert.ok(routen.length >= 120, `Nur ${routen.length} Routen gefunden — Muster veraltet?`);

  const ohne = [];
  let withCaller = 0;
  for (const [verb, pfad] of routen) {
    // Bis zum ersten Platzhalter suchen: Den Rest baut der Client zusammen.
    const stamm = pfad.split('/:')[0].replace(/\/+$/, '');
    if (!stamm) continue;
    const shapes = [stamm, stamm.slice(1), stamm.slice('/api'.length)].filter(Boolean);
    if (shapes.some(f => text.includes(f))) {
      withCaller++;
      continue;
    }
    ohne.push(`${verb} ${pfad}`);
  }

  // Selbstbeweis: Faende das Muster gar nichts, waere `ohne` die ganze Liste
  // und der Test rot — der umgekehrte Fall ist gefaehrlicher: Passte jeder
  // Pfad auf irgendetwas, waere `ohne` leer und der Test gruen, ohne etwas
  // geprueft zu haben. Deshalb beide Seiten festnageln.
  assert.ok(withCaller >= 100, `Nur ${withCaller} Routen mit Aufrufer — findet die Suche noch, was sie soll?`);
  assert.ok(
    ohne.length > 0,
    'Keine einzige Route ohne Aufrufer — das waere schoen, ist aber ' +
      'verdaechtig: Die Suche trifft dann vermutlich auf alles.',
  );

  const unexplained = ohne.filter(r => !WITHOUT_CALLER.has(r)).sort();
  assert.deepEqual(
    unexplained,
    [],
    'Diese Routen ruft kein Client, und es steht kein Grund dabei:\n  ' +
      unexplained.join('\n  ') +
      '\nEntweder sie wird nicht mehr gebraucht (dann entfernen), oder es gibt ' +
      'einen Grund (E-Mail-Link, Diagnosewerkzeug, geplante Oberflaeche) — dann ' +
      'in WITHOUT_CALLER eintragen, damit der Naechste ihn nicht neu herleiten muss.',
  );

  // Eine Zeile, die niemand mehr braucht, ist eine Erlaubnis, die niemand
  // prueft — dieselbe Regel wie in scripts/check-global-settings.js.
  const veraltet = [...WITHOUT_CALLER.keys()].filter(r => !ohne.includes(r)).sort();
  assert.deepEqual(
    veraltet,
    [],
    'Diese Eintraege beschreiben keine aufruferlose Route mehr — entweder ist ' +
      'sie geloescht worden oder sie hat jetzt einen Aufrufer. Zeile streichen:\n  ' +
      veraltet.join('\n  '),
  );
});
