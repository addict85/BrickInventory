/**
 * EINE Adresse, eine Umsetzung — und nur noch EINE Oberfläche.
 *
 * ── Der Befund, mit dem dieser Test entstand ────────────────────────────────
 * Es gab zwei API-Oberflächen: die Sitzungs-Routen der Webapp unter /api/… und
 * die Token-Routen der App unter /api/v1/…. Wo dieselbe Adresse auf BEIDEN
 * stand, existierte die Antwort zweimal — und zweimal heisst: Sie driften.
 * Genau das war passiert: GET /api/v1/settings baute seine Antwort selbst, las
 * nur user_settings und lieferte für globale Schlüssel eine fest verdrahtete
 * Vorgabe. Die Webapp zeigte 48, die App zeigte 24.
 *
 * ── Was sich geändert hat ───────────────────────────────────────────────────
 * Marcos Frage „wurde die api zusammengeführt, so dass nur noch ein Endpunkt
 * besteht?" war mit nein zu beantworten. NACHGEMESSEN vor dem Umbau: Von 47
 * alten Routen hatten nur DREI ein Gegenstück unter /api/v1 — die beiden
 * Oberflächen waren also kaum doppelt, sondern grossteils disjunkt.
 * „Zusammenführen" hiess deshalb UMZIEHEN.
 *
 * Seither hängen sets, parts, settings und minifigs unter /api/v1/<bereich>;
 * es sind DIESELBEN Router-Objekte, nur an einer anderen Adresse.
 *
 * ── Was dieser Test jetzt festhält ──────────────────────────────────────────
 *  1. Jeder Router hängt unter /api/v1 — mit genau EINER eingetragenen
 *     Ausnahme: die Anmeldung. Sie ist der einzige Block mit einer echten
 *     Kollision (POST /auth/login, /auth/logout, GET /auth/me gibt es unter
 *     /api/v1 bereits, mit anderer Bedeutung: Bearer-Token statt Sitzung).
 *     Das zusammenzulegen heisst, zwei Anmeldeverfahren zu vereinen — daran
 *     hängt, ob man sich überhaupt noch anmelden kann. Eigener Schritt.
 *  2. Keine Adresse steht zweimal, ausser mit eingetragenem Grund.
 *
 * ── Warum gesucht und nicht aufgezählt ──────────────────────────────────────
 * Die Mountpunkte kommen aus server.ts, die Routen aus den Router-Dateien.
 * Ein neuer Router, eine neue Route, ein neuer Mountpunkt — alles ist von
 * selbst mitgeprüft. Eine Aufzählung wäre am Tag ihrer Entstehung korrekt und
 * danach nie wieder. Genau das ist zwei Nachbardateien passiert: Sie trugen
 * die Mountpunkte als Literal und wurden beim Umzug still falsch.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/** Kommentare entfernen — sonst zählen auskommentierte Routen mit. */
function ohneKommentare(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Alle `router.<verb>('<pfad>'` einer Datei, mit vorangestelltem Mountpunkt. */
function routenAus(datei, mount) {
  const src = ohneKommentare(fs.readFileSync(datei, 'utf8'));
  const out = [];
  for (const m of src.matchAll(/router\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g)) {
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
  const src = ohneKommentare(fs.readFileSync(path.join(ROOT, 'server.ts'), 'utf8'));
  const out = [];
  for (const m of src.matchAll(/app\.use\(\s*['"](\/api\/[^'"]+)['"]\s*,\s*require\(\s*['"]\.\/(routes\/[^'"]+)['"]/g)) {
    if (m[2].startsWith('routes/api_v1')) continue;   // das IST die zweite Oberfläche
    out.push({ mount: m[1].replace(/\/+$/, ''), datei: path.join(ROOT, m[2] + '.ts') });
  }
  return out;
}

/**
 * Erlaubte Überschneidungen — mit dem Grund, warum es hier ZWEI Umsetzungen
 * geben muss statt einer. Wer eine Zeile hinzufügt, schreibt den Grund dazu;
 * wer keinen hat, hat eine Doppelung gefunden.
 */
/**
 * Adressen, die es ZWEIMAL geben darf — mit dem Grund.
 *
 * Verglichen wird OHNE Präfix (`/auth/login` statt `/api/v1/auth/login`), weil
 * genau das die Frage ist: Beantworten zwei Umsetzungen dieselbe Adresse?
 *
 * `GET /settings` stand hier und ist entfallen — die Webapp-Fassung war eine
 * Route ohne Aufrufer, die dasselbe lieferte wie /settings/raw, nur in einer
 * anderen Hülle. Damit bleibt genau die Anmeldung übrig.
 */
const ERLAUBT = new Map([
  ['POST /auth/login',
    'Stellt den Ausweis aus — die Webapp eine Sitzung im Cookie, die App einen ' +
    'Bearer-Token. Verschiedene Ergebnisse, nicht zwei Fassungen desselben. Die ' +
    'Prüfung der Zugangsdaten selbst steht gemeinsam in utils/auth.ts.'],
  ['POST /auth/logout',
    'Entwertet den Ausweis. Sitzung zerstören und Token-Zeile löschen sind ' +
    'verschiedene Vorgänge; die Webapp-Route macht beides, weil ein Browser ' +
    'beides halten kann.'],
  ['GET /auth/me',
    'Verschiedene Fragen: Die Webapp fragt „bin ich angemeldet?" und bekommt ' +
    'flach { loggedIn, id, username, isAdmin } frisch aus der Datenbank. Die App ' +
    'fragt „wem gehört dieser Token und wie lange gilt er?" und bekommt ' +
    '{ user, token_expires, token_last_used } aus dem Token-Cache.'],
]);

/** Präfix weg: /api/v1/sets/x und /api/sets/x werden beide zu /sets/x. */
function ohnePraefix(eintrag) {
  return eintrag.replace(/ \/api(\/v1)?/, ' ');
}


test('keine unbegruendete Route auf beiden API-Oberflaechen', () => {
  const web = new Set();
  for (const r of webRouter()) for (const x of routenAus(r.datei, r.mount)) web.add(x);

  const v1 = new Set();
  const v1Dir = path.join(ROOT, 'routes', 'api_v1');
  for (const f of fs.readdirSync(v1Dir)) {
    if (!f.endsWith('.ts') || f === 'index.ts' || f === 'middleware.ts') continue;
    for (const x of routenAus(path.join(v1Dir, f), '/api')) v1.add(x);
  }

  // Selbstbeweis: Greift das Muster nicht mehr (umbenanntes `router`, andere
  // Schreibweise des Mountpunkts), waeren beide Mengen leer und der Test
  // gruen, ohne etwas geprueft zu haben.
  assert.ok(web.size >= 40, `Nur ${web.size} Webapp-Routen gefunden — Muster veraltet?`);
  assert.ok(v1.size >= 80, `Nur ${v1.size} v1-Routen gefunden — Muster veraltet?`);

  // Beide Seiten ohne Praefix vergleichen: Seit dem Umzug haengen die
  // Webapp-Router selbst unter /api/v1/<bereich>, und ein Vergleich der rohen
  // Adressen faende gar keine Ueberschneidung mehr — der Test waere gruen,
  // ohne etwas zu pruefen.
  const webN = new Set([...web].map(ohnePraefix));
  const v1N  = new Set([...v1].map(ohnePraefix));
  const doppelt = [...webN].filter(r => v1N.has(r)).sort();
  const unbegruendet = doppelt.filter(r => !ERLAUBT.has(r));
  assert.deepEqual(unbegruendet, [],
    'Diese Adressen stehen auf BEIDEN Oberflaechen, ohne dass ein Grund ' +
    'eingetragen waere:\n  ' + unbegruendet.join('\n  ') +
    '\nZwei Umsetzungen derselben Antwort driften — gemessen bei ' +
    'GET /settings: Webapp 48, App 24. Entweder die Logik in utils/ ' +
    'zusammenlegen und beide Routen daraus bedienen, oder in ERLAUBT ' +
    'eintragen, WARUM es zwei sein muessen.');

  // Eine Zeile, die niemand mehr braucht, ist eine Erlaubnis, die niemand
  // prueft — dieselbe Regel wie in scripts/check-global-settings.js.
  const veraltet = [...ERLAUBT.keys()].filter(r => !doppelt.includes(r));
  assert.deepEqual(veraltet, [],
    'Diese Eintraege in ERLAUBT beschreiben keine Ueberschneidung mehr — ' +
    'streichen:\n  ' + veraltet.join('\n  '));
});

test('jeder Router haengt unter /api/v1 — mit genau einer eingetragenen Ausnahme', () => {
  // ── Marcos Frage ──────────────────────────────────────────────────────────
  // „Wurde die api zusammengefuehrt, so dass nur noch ein Endpunkt besteht?"
  //
  // Diese Regel ist die Antwort in Form einer Pruefung. Sie zaehlt die
  // Ausnahmen NICHT auf — sie liest die Einhaengepunkte aus server.ts und
  // laesst genau eine zu, die hier begruendet steht.
  const NOCH_NICHT = new Map([
    ['/api/auth',
     'Die Anmeldung zieht ZULETZT um: POST /auth/login, POST /auth/logout und ' +
     'GET /auth/me gibt es unter /api/v1 bereits, mit anderer Bedeutung ' +
     '(Bearer-Token statt Sitzung). Das zusammenzulegen heisst, zwei ' +
     'Anmeldeverfahren zu vereinen — daran haengt, ob man sich ueberhaupt noch ' +
     'anmelden kann. Eigener Schritt, eigener Lauf.'],
  ]);

  const einhaengungen = webRouter();
  // Selbstbeweis: Findet das Muster keine Einhaengepunkte, prueft alles
  // darunter nichts und waere trotzdem gruen.
  assert.ok(einhaengungen.length >= 4,
    `Nur ${einhaengungen.length} Router-Einhaengepunkte in server.ts gefunden — Muster veraltet?`);

  const daneben = einhaengungen
    .map(r => r.mount)
    .filter(m => !m.startsWith('/api/v1') && !NOCH_NICHT.has(m))
    .sort();
  assert.deepEqual(daneben, [],
    'Diese Router haengen NICHT unter /api/v1 und stehen auch nicht als ' +
    'begruendete Ausnahme da:\n  ' + daneben.join('\n  ') +
    '\nEntweder umhaengen oder in NOCH_NICHT eintragen, WARUM noch nicht.');

  // Und die Ausnahme darf nicht liegenbleiben: Steht sie da, obwohl der Router
  // laengst umgezogen ist, sieht die Umstellung unfertiger aus als sie ist.
  const erledigt = [...NOCH_NICHT.keys()]
    .filter(m => !einhaengungen.some(r => r.mount === m));
  assert.deepEqual(erledigt, [],
    'Diese Ausnahmen beschreiben keinen Einhaengepunkt mehr — streichen:\n  ' +
    erledigt.join('\n  '));
});
