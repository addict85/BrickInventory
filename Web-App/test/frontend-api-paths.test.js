/**
 * Jeder API-Pfad des Frontends trifft eine Route des Servers.
 *
 * ── Marcos Befund (Nachtrag 141) ────────────────────────────────────────────
 * „Auf dem Detail-Dialog ist ein '—' beim Kaufpreis. Wenn ich auf Kaufpreise
 * bearbeiten klicke, ist im neuen Dialog die Tabelle leer."
 *
 * Elf Aufrufe in js/13-acquisition-modals.js sprachen
 *     /api/parts/…/acquisitions   und  /api/minifigs/…/acquisitions
 * an. Diese Routen gibt es NUR unter /api/v1/. `api()` hängt lediglich `/api`
 * davor — die Anfragen liefen ins Leere, und der Dialog zeigte „—" statt eines
 * Fehlers, weil der Aufruf ein `.catch(() => null)` trägt.
 *
 * Der Fehler ist ALT: schon in hardened-221, vor dem Aufteilen der Datei.
 *
 * ── Warum auch Pfade in VARIABLEN geprüft werden ────────────────────────────
 * Der erste Entwurf sah nur `api('GET', '/…')` — und schwieg. Denn genau die
 * kaputten Pfade entstehen vorher in einer Variablen:
 *
 *     const acqUrl = type === 'fig' ? `/minifigs/…` : `/parts/…`;
 *     const ad = await api('GET', acqUrl);
 *
 * Deshalb werden zusätzlich alle Pfad-Literale geprüft, deren erstes Segment
 * der Server unter /api kennt. Ihre HTTP-Methode ist unbekannt; es genügt, dass
 * IRGENDEINE Methode die Route bedient.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/** Alle Routen des Servers als [METHODE, vollständiger Pfad]. */
function routen() {
  const raus = new Set();
  const server = fs.readFileSync(path.join(ROOT, 'server.ts'), 'utf8');

  // app.use('/api/x', require('./routes/y'))
  for (const m of server.matchAll(/app\.use\('(\/api[^']*)',\s*require\('\.\/([\w/]+)'\)/g)) {
    sammle(m[2], m[1]);
  }
  // api_v1 wird über index.ts eingebunden — die Dateien direkt lesen.
  for (const f of fs.readdirSync(path.join(ROOT, 'routes', 'api_v1'))) {
    if (f.endsWith('.ts')) sammle(`routes/api_v1/${f.replace(/\.ts$/, '')}`, '/api/v1');
  }

  function sammle(rel, praefix) {
    const datei = path.join(ROOT, rel + '.ts');
    if (!fs.existsSync(datei)) return;
    const s = fs.readFileSync(datei, 'utf8');
    for (const m of s.matchAll(/router\.(get|post|put|delete|patch)\(\s*['`]([^'`]*)['`]/g)) {
      raus.add(`${m[1].toUpperCase()} ${(praefix + m[2]).replace(/\/\//g, '/')}`);
    }
    // registerAcquisitionRoutes() erzeugt <routeBase> und <routeBase>/:<idParam>
    for (const m of s.matchAll(/routeBase:\s*'([^']+)'[\s\S]{0,120}?idParam:\s*'(\w+)'/g)) {
      const basis = praefix + m[1];
      for (const me of ['GET', 'POST']) raus.add(`${me} ${basis}`);
      for (const me of ['PUT', 'DELETE']) raus.add(`${me} ${basis}/:${m[2]}`);
    }
  }
  return [...raus].map(z => { const [me, ...r] = z.split(' '); return [me, r.join(' ')]; });
}

const ROUTEN = routen();

function passt(methode, pfad) {
  const tp = pfad.replace(/^\/|\/$/g, '').split('/');
  return ROUTEN.some(([rm, rp]) => {
    if (rm !== methode) return false;
    const tr = rp.replace(/^\/|\/$/g, '').split('/');
    if (tr.length !== tp.length && !rp.endsWith('*')) return false;
    return tr.every((a, i) => a.startsWith(':') || a === '*' || tp[i] === ':x' || a === tp[i]);
  });
}

/** `${…}` wird zu einem Platzhalter-Segment, Abfrageteil fällt weg. */
function normieren(roh) {
  return '/api' + roh.replace(/\$\{[^}]*\}/g, ':x').split('?')[0].replace(/\/$/, '');
}

test('jeder API-Pfad des Frontends trifft eine Route', () => {
  assert.ok(ROUTEN.length > 100, `nur ${ROUTEN.length} Routen gefunden — das Muster greift nicht mehr`);

  // Erste Wegsegmente, die der Server unter /api kennt.
  const segmente = new Set(ROUTEN
    .map(([, rp]) => rp.replace(/^\//, '').split('/')[1])
    .filter(Boolean));

  const dir = path.join(ROOT, 'public', 'js');
  const fehler = [];
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.js') && x !== 'app.bundle.js')) {
    const s = fs.readFileSync(path.join(dir, f), 'utf8');

    const direkt = new Map();
    for (const m of s.matchAll(/api\(\s*'(GET|POST|PUT|DELETE|PATCH)'\s*,\s*(`[^`]*`|'[^']*')/g)) {
      const p = normieren(m[2].slice(1, -1));
      if (!direkt.has(p)) direkt.set(p, new Set());
      direkt.get(p).add(m[1]);
    }
    for (const [p, methoden] of direkt) {
      for (const me of methoden) {
        if (!passt(me, p)) fehler.push(`${f}: ${me} ${p} — keine passende Route`);
      }
    }

    // Pfade, die erst in eine Variable gebaut werden.
    for (const m of s.matchAll(/`(\/[^`]*)`/g)) {
      const p = normieren(m[1]);
      const seg = p.replace(/^\/api\/?/, '').split('/')[0];
      if (!segmente.has(seg) || direkt.has(p)) continue;
      if (!['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].some(me => passt(me, p))) {
        fehler.push(`${f}: ${p} — keine passende Route (Pfad in einer Variablen)`);
      }
    }
  }
  assert.deepEqual(fehler, [],
    'Frontend-Pfade ohne Route:\n  ' + fehler.join('\n  ') +
    '\nSolche Aufrufe scheitern still, wenn ein .catch() daran hängt.');
});
