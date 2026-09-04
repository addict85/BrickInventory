/**
 * Jede Adresse, die die Webapp aufruft, muss es auf dem Server geben.
 *
 * ── Warum es diese Prüfung gibt ─────────────────────────────────────────────
 * Für die Android-App steht das seit test/app-endpunkte.test.js fest — dort
 * fiel damit eine Methode auf, die auf eine längst gelöschte Route zeigte.
 * Für die Webapp gab es die Gegenprobe nicht, obwohl das Risiko dort GRÖSSER
 * ist: Ein falscher Pfad im Browser scheitert erst zur Laufzeit, und etliche
 * Aufrufe enden auf `.catch(() => null)` — dann fehlt einfach ein Diagramm,
 * ohne dass irgendwo etwas rot wird.
 *
 * ── Was das Parsen schwierig macht (und schon dreimal danebenlag) ───────────
 * 1. Der Pfad ist oft ein Template-Literal mit VERSCHACHTELTEN Ausdrücken:
 *    `/v1/parts/${nr}/${farbe}${owner ? `?owner=${owner}` : ''}`
 *    Wer zuerst am `?` abschneidet, zerschneidet den Ausdruck und behält ein
 *    `${owner ` übrig. Erst die `${…}` auflösen (innerste zuerst, bis nichts
 *    mehr passt), DANN am `?` kappen.
 * 2. `fetch()` ist nicht immer GET — die Methode steht im zweiten Argument.
 * 3. Drei Routen stehen direkt in server.ts, nicht in einem Router.
 * Alle drei Punkte haben beim Nachmessen falsche Treffer erzeugt; sie stehen
 * hier, damit die nächste Fassung nicht wieder daran scheitert.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ohneKommentare, routerEinhaengungen } = require('./helpers/sources');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'public', 'js');

/** `/api/sets/:setNumber` → `/api/sets/:X` — verglichen wird die FORM. */
function form(p) {
  return ('/' + String(p).replace(/^\/+|\/+$/g, '')).replace(/\/:[A-Za-z_]\w*/g, '/:X');
}

/**
 * Template-Ausdrücke auflösen, dann den Abfrageteil abschneiden.
 *
 * Ein `${…}` ist nur dann ein PFADABSCHNITT, wenn direkt ein `/` davorsteht:
 *
 *     `/v1/parts/${nr}/${farbe}`            → /v1/parts/:X/:X
 *     `/v1/minifigs/${nr}${owner ? …: ''}`  → /v1/minifigs/:X
 *
 * Im zweiten Fall hängt der Ausdruck am Segment und liefert einen
 * Abfrageteil oder gar nichts. Ohne diese Unterscheidung entstand
 * `/v1/minifigs/:X:X` — ein Pfad, den es nirgends gibt, und vier falsche
 * Treffer beim Nachmessen.
 */
function pfadForm(roh) {
  let s = String(roh);
  let vor = null;
  while (vor !== s) { vor = s; s = s.replace(/\$\{[^{}]*\}/g, '\u0000'); }
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '\u0000') { out += s[i]; continue; }
    if (out.endsWith('/')) { out += ':X'; continue; }
    break;                       // Anhängsel, kein Abschnitt → hier endet der Pfad
  }
  return form(out.split('?')[0].replace(/'\s*\+.*$/, ''));
}

function serverRouten() {
  const alle = new Set();
  const sammle = (datei, mount) => {
    const src = ohneKommentare(fs.readFileSync(datei, 'utf8'));
    for (const m of src.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g))
      alle.add(`${m[1].toUpperCase()} ${form(mount + '/' + m[2].replace(/^\//, ''))}`);
  };
  // Einhaengepunkte aus server.ts GELESEN statt abgeschrieben. Die Liste stand
  // hier als Literal und wurde beim Zusammenlegen der API-Oberflaechen still
  // falsch — samt „ENOENT: routes/finance.ts". Siehe routerEinhaengungen().
  for (const r of routerEinhaengungen()) sammle(r.datei, r.mount);
  const v1 = path.join(ROOT, 'routes', 'api_v1');
  for (const f of fs.readdirSync(v1)) {
    if (!f.endsWith('.ts') || f === 'index.ts' || f === 'middleware.ts') continue;
    sammle(path.join(v1, f), '/api/v1');
  }
  // registerAcquisitionRoutes() baut diese zur Laufzeit zusammen.
  for (const basis of ['/sets/:X/acquisitions', '/parts/:X/:X/acquisitions', '/minifigs/:X/acquisitions'])
    for (const verb of ['GET', 'POST', 'PUT', 'DELETE']) alle.add(`${verb} /api/v1${basis}/:X`);
  // Und die drei, die direkt in server.ts hängen.
  const srv = ohneKommentare(fs.readFileSync(path.join(ROOT, 'server.ts'), 'utf8'));
  for (const m of srv.matchAll(/app\.(get|post|put|delete)\(\s*'(\/api\/[^']+)'/g))
    alle.add(`${m[1].toUpperCase()} ${form(m[2])}`);
  return alle;
}

/**
 * Ein Zeichenketten-Literal ab Position `i` lesen — mit VERSCHACHTELTEN
 * Template-Ausdrücken.
 *
 * Ein einzelner regulärer Ausdruck kann das nicht: Der Pfad
 * `/v1/parts/${nr}${owner ? `?owner=${owner}` : ''}` enthält BACKTICKS in
 * seinem eigenen Inneren. Jedes `[^`]+` bricht dort ab und liefert einen
 * halben Ausdruck — beim Nachmessen kamen so fünf falsche Treffer heraus.
 */
function leseLiteral(src, i) {
  const anf = src[i];
  if (anf !== '`' && anf !== "'" && anf !== '"') return null;
  let j = i + 1, tiefe = 0;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') { j += 2; continue; }
    if (anf === '`' && c === '$' && src[j + 1] === '{') { tiefe++; j += 2; continue; }
    if (tiefe > 0) {
      if (c === '{') tiefe++;
      else if (c === '}') tiefe--;
      // Innerhalb eines ${…} darf ein weiteres Literal stehen; es wird
      // mitgelesen, damit sein Inhalt die Zählung nicht durcheinanderbringt.
      else if (c === '`' || c === "'" || c === '"') {
        const inner = leseLiteral(src, j);
        if (inner) { j = inner.ende; continue; }
      }
      j++; continue;
    }
    if (c === anf) return { text: src.slice(i + 1, j), ende: j + 1 };
    j++;
  }
  return null;
}

/** Alle Aufrufe der Webapp: api('VERB', pfad) und fetch(pfad, { method }). */
function webAufrufe() {
  const out = [];
  for (const datei of fs.readdirSync(JS)) {
    if (!datei.endsWith('.js') || datei === 'app.bundle.js') continue;
    const src = ohneKommentare(fs.readFileSync(path.join(JS, datei), 'utf8'));
    const zeileVon = (i) => src.slice(0, i).split('\n').length;

    for (const m of src.matchAll(/api\(\s*'(GET|POST|PUT|DELETE)'\s*,\s*/g)) {
      const lit = leseLiteral(src, m.index + m[0].length);
      if (!lit || !lit.text.startsWith('/')) continue;
      out.push({ datei, zeile: zeileVon(m.index), verb: m[1], pfad: pfadForm('/api' + lit.text) });
    }
    for (const m of src.matchAll(/fetch\(\s*/g)) {
      const lit = leseLiteral(src, m.index + m[0].length);
      if (!lit || !lit.text.startsWith('/api/')) continue;
      // Die Methode steht im zweiten Argument; ohne Angabe ist es GET.
      const rest = src.slice(lit.ende, lit.ende + 300);
      const verb = (rest.match(/method\s*:\s*['"`](\w+)['"`]/) || [, 'GET'])[1].toUpperCase();
      out.push({ datei, zeile: zeileVon(m.index), verb, pfad: pfadForm(lit.text) });
    }
  }
  return out;
}

test('jede Adresse der Webapp existiert auf dem Server', () => {
  const server = serverRouten();
  const aufrufe = webAufrufe();

  // Selbstbeweis in beide Richtungen: Findet eines der Muster nichts, wäre die
  // Fehlerliste leer und der Test grün, ohne etwas geprüft zu haben.
  assert.ok(server.size >= 120, `Nur ${server.size} Server-Routen gefunden — Muster veraltet?`);
  assert.ok(aufrufe.length >= 100, `Nur ${aufrufe.length} Webapp-Aufrufe gefunden — Muster veraltet?`);

  const fehlend = [...new Set(aufrufe
    .filter(a => !server.has(`${a.verb} ${a.pfad}`))
    .map(a => `${a.datei}:${a.zeile}  ${a.verb} ${a.pfad}`))].sort();

  assert.deepEqual(fehlend, [],
    'Diese Adressen ruft die Webapp auf, der Server hat sie nicht:\n  ' + fehlend.join('\n  ') +
    '\nIm Browser scheitert das erst zur Laufzeit — und wo der Aufruf auf ' +
    '.catch(() => null) endet, fehlt danach still ein Teil der Anzeige.');
});
