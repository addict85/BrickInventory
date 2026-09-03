/**
 * Eine Adresse, eine Umsetzung — oder ein eingetragener Grund.
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 * Es gibt zwei API-Oberflächen: die Sitzungs-Routen der Webapp unter /api/…
 * und die Token-Routen der Android-App unter /api/v1/…. NACHGEMESSEN: 47 gegen
 * 89 Routen, und die Webapp ruft selbst 88 Adressen unter /v1/ auf — die
 * Trennung verläuft also längst nicht zwischen „Browser" und „Telefon",
 * sondern nur noch zwischen „Cookie" und „Bearer".
 *
 * Wo dieselbe Adresse auf BEIDEN Oberflächen steht, existiert die Antwort
 * zweimal. Und zweimal heisst: Sie driften. Genau das ist passiert —
 * GET /api/v1/settings baute seine Antwort selbst, las dabei nur
 * user_settings und lieferte für globale Schlüssel dauerhaft eine fest
 * verdrahtete Vorgabe. Die Webapp zeigte 48, die App zeigte 24.
 *
 * ── Warum eine Liste mit Gründen und kein Verbot ────────────────────────────
 * Vier Überschneidungen bleiben, und alle vier zu Recht: Anmelden und Abmelden
 * MÜSSEN sich unterscheiden, weil sie verschiedene Ausweise ausstellen bzw.
 * entwerten; /auth/me und /settings beantworten auf den beiden Oberflächen
 * verschiedene Fragen (siehe Begründungen unten). Ein pauschales Verbot wäre
 * also falsch. Was der Test verhindert, ist die FÜNFTE Überschneidung, die
 * niemand begründet hat.
 *
 * ── Warum gesucht und nicht aufgezählt ──────────────────────────────────────
 * Die Mountpunkte kommen aus server.ts, die Routen aus den Router-Dateien.
 * Ein neuer Router, eine neue Route, ein neuer Mountpunkt — alles ist von
 * selbst mitgeprüft. Eine Aufzählung wäre am Tag ihrer Entstehung korrekt und
 * danach nie wieder.
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
const ERLAUBT = new Map([
  ['POST /api/auth/login',
    'Stellt den Ausweis aus — die Webapp eine Sitzung im Cookie, die App einen ' +
    'Bearer-Token. Verschiedene Ergebnisse, nicht zwei Fassungen desselben. Die ' +
    'Prüfung der Zugangsdaten selbst steht gemeinsam in utils/auth.ts.'],
  ['POST /api/auth/logout',
    'Entwertet den Ausweis. Sitzung zerstören und Token-Zeile löschen sind ' +
    'verschiedene Vorgänge; die Webapp-Route macht beides, weil ein Browser ' +
    'beides halten kann.'],
  ['GET /api/auth/me',
    'Verschiedene Fragen: Die Webapp fragt „bin ich angemeldet?" und bekommt ' +
    'flach { loggedIn, id, username, isAdmin } frisch aus der Datenbank. Die App ' +
    'fragt „wem gehört dieser Token und wie lange gilt er?" und bekommt ' +
    '{ user, token_expires, token_last_used } aus dem Token-Cache.'],
  ['GET /api/settings',
    'Verschiedene Sichten auf dieselben Daten: Die Webapp bekommt alles ' +
    '(inklusive der globalen und — als Admin — der maskierten geheimen ' +
    'Schlüssel), die App eine ausdrücklich kuratierte Auswahl (APP_FELDER in ' +
    'routes/api_v1/settings.ts, Gegenstück zu UserSettings in AuthModels.kt). ' +
    'Gelesen wird seit der Zusammenlegung durch DIESELBE Funktion, ' +
    'readSettings() in utils/settings.ts — nur die Verpackung unterscheidet sich.'],
]);

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

  const doppelt = [...web].filter(r => v1.has(r)).sort();
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
