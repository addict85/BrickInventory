/**
 * Jede Adresse, die die Android-App aufruft, muss es auf dem Server geben.
 * Ausführlich: docs/begruendungen/test/abgleich-app-endpunkte.test.js.md#kopf
 */
// Abgleich Web↔App: läuft in web-ci auch bei Änderungen unter Android-App/ (paths-Filter).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { routerEinhaengungen } = require('./helpers/sources');
const ROOT = path.join(__dirname, '..');
// Je Bereich eine Datei (data/api/); geprüft wird der ganze Ordner.
const SERVICE = path.join(__dirname, '..', '..', 'Android-App', 'core-data', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'data', 'api');
const { apiQuelltext } = require('../scripts/kotlin-vertrag.js');

function ohneKommentare(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Pfade vergleichbar machen: Retrofit schreibt `{setNumber}`, Express `:setNumber`.
 * Beides wird zu `:X` — verglichen wird die FORM des Pfades, nicht der Name des
 * Platzhalters. Ein umbenannter Parameter ist keine Abweichung.
 */
function form(p) {
  return ('/' + p.trim().replace(/^\/+|\/+$/g, ''))
    .replace(/\{[^}]+\}/g, ':X')
    .replace(/:[A-Za-z_]\w*/g, ':X');
}

/** Alle `router.<verb>('<pfad>'` einer Datei, mit Mountpunkt davor. */
function routenAus(datei, mount) {
  const src = ohneKommentare(fs.readFileSync(datei, 'utf8'));
  const out = [];
  for (const m of src.matchAll(/router\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g))
    out.push(`${m[1].toUpperCase()} ${form(mount + '/' + m[2].replace(/^\//, ''))}`);
  return out;
}

function serverRouten() {
  const alle = new Set();
  // Einhaengepunkte aus server.ts GELESEN statt abgeschrieben: Eine
  // abgeschriebene Liste veraltet still. Siehe routerEinhaengungen().
  for (const r of routerEinhaengungen())
    for (const x of routenAus(r.datei, r.mount)) alle.add(x);

  const v1 = path.join(ROOT, 'routes/api_v1');
  for (const f of fs.readdirSync(v1)) {
    if (!f.endsWith('.ts') || f === 'index.ts' || f === 'middleware.ts') continue;
    for (const r of routenAus(path.join(v1, f), '/api/v1')) alle.add(r);
  }

  // Routen, die DIREKT an der App haengen
  // Ausführlich: docs/begruendungen/test/abgleich-app-endpunkte.test.js.md#stelle
  {
    const srv = fs.readFileSync(path.join(ROOT, 'server.ts'), 'utf8');
    for (const m of srv.matchAll(/\bapp\.(get|post|put|patch|delete)\(\s*['"](\/api\/[^'"]+)['"]/g))
      alle.add(`${m[1].toUpperCase()} ${m[2]}`);
  }

  return alle;
}

test('jede Adresse der Android-App existiert auf dem Server', () => {
  // Kein Überspringen, wenn der Baum fehlt: Ein stiller Durchlauf wäre genau
  // die Prüfung, die nie etwas findet.
  assert.ok(fs.existsSync(SERVICE), `App-Schnittstelle nicht gefunden unter ${SERVICE}`);

  const server = serverRouten();
  const kt = ohneKommentare(apiQuelltext(SERVICE));
  const aufrufe = [...kt.matchAll(/@(GET|POST|PUT|DELETE|PATCH)\(\s*"([^"]+)"\s*\)/g)]
    .map(m => ({ roh: `${m[1]} ${m[2]}`, norm: `${m[1]} ${form(m[2])}` }));

  assert.ok(server.size >= 120, `Nur ${server.size} Server-Routen gefunden — Muster veraltet?`);
  assert.ok(aufrufe.length >= 60, `Nur ${aufrufe.length} Retrofit-Aufrufe gefunden — Muster veraltet?`);

  const fehlend = [...new Set(aufrufe.filter(a => !server.has(a.norm)).map(a => a.roh))].sort();
  assert.deepEqual(fehlend, [],
    'Diese Adressen ruft die App auf, der Server hat sie nicht:\n  ' + fehlend.join('\n  ') +
    '\nEntweder die Route ist gelöscht worden und die Deklaration blieb stehen ' +
    '(dann streichen), oder sie fehlt auf dem Server (dann nachziehen). Beides ' +
    'endet sonst zur Laufzeit in einem 404, den man im eigenen Code sucht.');
});
