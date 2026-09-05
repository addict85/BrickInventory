/**
 * Jede Adresse, die die Android-App aufruft, muss es auf dem Server geben.
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 * NACHGEMESSEN: BrickApiService.kt deklarierte
 * `GET api/settings/admin/default-condition`. Diese Route ist in Etappe 7
 * gelöscht worden — an ihrer Stelle steht in routes/settings.ts nur noch ein
 * Kommentar, der auf /api/v1/settings/default-condition verweist. Die
 * Deklaration blieb stehen und sah aus wie ein unterstützter Aufruf.
 *
 * Hier ging nichts kaputt, weil sie niemand aufrief. Genau das ist der Punkt:
 * Der nächste, der die Methode benutzt, bekommt 404 — und sucht den Fehler in
 * seinem eigenen Code, denn die Schnittstelle behauptet ja, es gäbe die Route.
 *
 * ── Warum auf der Webapp-Seite ──────────────────────────────────────────────
 * Die Prüfung braucht BEIDE Bäume. Die Android-Tests laufen nur im
 * GitHub-Lauf (rund zehn Minuten); `npm test` läuft vor jedem Commit. Eine
 * Prüfung, die man selten ausführt, findet selten etwas.
 *
 * ── Warum gesucht und nicht aufgezählt ──────────────────────────────────────
 * Beide Seiten werden geparst: die Routen aus den Router-Dateien, die
 * Aufrufe aus den Retrofit-Anmerkungen. Eine neue Methode in der App ist von
 * selbst mitgeprüft. Selbstbeweis über Mindestzahlen — greift ein Muster
 * nicht mehr, wären beide Mengen leer und der Test grün, ohne etwas geprüft
 * zu haben.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { routerEinhaengungen } = require('./helpers/sources');
const ROOT = path.join(__dirname, '..');
const SERVICE = path.join(ROOT, '..', 'Android-App', 'app', 'src', 'main',
  'java', 'ch', 'brickinventoryapp', 'data', 'api', 'BrickApiService.kt');

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
  // Einhaengepunkte aus server.ts GELESEN statt abgeschrieben. Die Liste stand
  // hier als Literal und wurde beim Zusammenlegen der API-Oberflaechen still
  // falsch — samt „ENOENT: routes/finance.ts". Siehe routerEinhaengungen().
  for (const r of routerEinhaengungen())
    for (const x of routenAus(r.datei, r.mount)) alle.add(x);

  const v1 = path.join(ROOT, 'routes', 'api_v1');
  for (const f of fs.readdirSync(v1)) {
    if (!f.endsWith('.ts') || f === 'index.ts' || f === 'middleware.ts') continue;
    for (const r of routenAus(path.join(v1, f), '/api/v1')) alle.add(r);
  }

  // ── Routen, die DIREKT an der App haengen (Nachtrag 136) ──────────────────
  //
  // `serverRouten()` las nur `router.<verb>('<pfad>')` aus den Router-Dateien.
  // Zwei Adressen stehen aber in server.ts unmittelbar an der App:
  //
  //     app.get('/api/v1/startup-status', …)
  //     app.get('/api/v1/health', …)
  //
  // Beide absichtlich dort und absichtlich vor allen Waechtern — sie werden
  // gebraucht, BEVOR sich jemand anmelden kann. Dieselbe Sorte Luecke, die
  // dieser Baum immer wieder hat: eine Sache in zwei Schreibweisen und eine
  // Suche, die nur eine kennt.
  //
  // Aufgefallen, als die App den Startzustand zu rufen begann: Der Test meldete
  // „der Server hat sie nicht", obwohl die Route seit jeher da ist.
  {
    const srv = fs.readFileSync(path.join(ROOT, 'server.ts'), 'utf8');
    for (const m of srv.matchAll(/\bapp\.(get|post|put|patch|delete)\(\s*['"](\/api\/[^'"]+)['"]/g))
      alle.add(`${m[1].toUpperCase()} ${m[2]}`);
  }

  // registerAcquisitionRoutes() baut diese Routen zur Laufzeit zusammen — der
  // Parser oben sieht sie nicht, weil kein Pfad-Literal dasteht.
  for (const basis of ['/sets/:X/acquisitions', '/parts/:X/:X/acquisitions', '/minifigs/:X/acquisitions'])
    for (const verb of ['PUT', 'DELETE']) alle.add(`${verb} /api/v1${basis}/:X`);

  return alle;
}

test('jede Adresse der Android-App existiert auf dem Server', () => {
  // Kein Überspringen, wenn der Baum fehlt: Ein stiller Durchlauf wäre genau
  // die Prüfung, die nie etwas findet.
  assert.ok(fs.existsSync(SERVICE), `BrickApiService.kt nicht gefunden unter ${SERVICE}`);

  const server = serverRouten();
  const kt = ohneKommentare(fs.readFileSync(SERVICE, 'utf8'));
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
