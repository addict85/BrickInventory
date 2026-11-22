/**
 * Every API path of the frontend hits a route of the server.
 *
 * Counter-check: `api('GET', '/v2/zz-nowhere')` appended to public/js/catalog.js → red “every API path of the frontend hits a route”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathForm, readLiteral } = require('./helpers/sources');

const ROOT = path.join(__dirname, '..');

/** All routes of the server as [METHOD, full path]. */
function routen() {
  const raus = new Set();
  // The mount points from server.ts (helpers/sources.js), without routes/api.
  for (const r of require('./helpers/sources').routerMounts()) collect(`routes/${r.name}`, r.mount);
  // routes/api is included via index.ts — read the files directly.
  for (const f of fs.readdirSync(path.join(ROOT, 'routes/api'))) {
    if (f.endsWith('.ts')) collect(`routes/api/${f.replace(/\.ts$/, '')}`, '/api/v2');
  }
  // And the few that hang directly in server.ts (startup-status, health …).
  const srv = fs.readFileSync(path.join(ROOT, 'server.ts'), 'utf8');
  for (const m of srv.matchAll(/app\.(get|post|put|delete|patch)\(\s*'(\/api\/[^']+)'/g))
    raus.add(`${m[1].toUpperCase()} ${m[2]}`);

  function collect(rel, praefix) {
    const datei = path.join(ROOT, rel + '.ts');
    if (!fs.existsSync(datei)) return;
    const s = fs.readFileSync(datei, 'utf8');
    for (const m of require('./helpers/sources').routesFromSource(s, praefix)) {
      raus.add(`${m[1].toUpperCase()} ${(praefix + m[2]).replace(/\/\//g, '/')}`);
    }
  }
  return [...raus].map(z => {
    const [me, ...r] = z.split(' ');
    return [me, r.join(' ')];
  });
}

const ROUTES = routen();

function passt(methode, path) {
  const tp = path.replace(/^\/|\/$/g, '').split('/');
  return ROUTES.some(([rm, rp]) => {
    if (rm !== methode) return false;
    const tr = rp.replace(/^\/|\/$/g, '').split('/');
    if (tr.length !== tp.length && !rp.endsWith('*')) return false;
    return tr.every((a, i) => a.startsWith(':') || a === '*' || tp[i] === ':x' || a === tp[i]);
  });
}

/**
 * `${…}` becomes a placeholder segment, the query part drops.
 */
function normalize(roh) {
  return ('/api' + pathForm(roh, ':x')).replace(/\/$/, '');
}

test('every API path of the frontend hits a route', () => {
  assert.ok(ROUTES.length > 100, `only ${ROUTES.length} routes found — the pattern no longer matches`);

  // First path segments the server knows under /api.
  const segmentList = new Set(ROUTES.map(([, rp]) => rp.replace(/^\//, '').split('/')[1]).filter(Boolean));

  // Also the .js directly under public/
  const dateien = [
    ...fs
      .readdirSync(path.join(ROOT, 'public'))
      .filter(x => x.endsWith('.js'))
      .map(x => [x, path.join(ROOT, 'public', x)]),
    ...fs
      .readdirSync(path.join(ROOT, 'public', 'js'))
      .filter(x => x.endsWith('.js') && x !== 'app.bundle.js')
      .map(x => [x, path.join(ROOT, 'public', 'js', x)]),
  ];
  const error = [];
  for (const [f, voll] of dateien) {
    const s = fs.readFileSync(voll, 'utf8');

    const direct = new Map();
    // The literal is READ, not cut with a pattern: here
    // stood ``(`[^`]*`|'[^']*')``, and that breaks at a backtick
    // inside. MEASURED it delivered for
    for (const m of s.matchAll(/\bapi(?:Roh|Raw)?\(\s*'(GET|POST|PUT|DELETE|PATCH)'\s*,\s*/g)) {
      const lit = readLiteral(s, m.index + m[0].length);
      if (!lit?.text.startsWith('/')) continue;
      const p = normalize(lit.text);
      if (!direct.has(p)) direct.set(p, new Set());
      direct.get(p).add(m[1]);
    }
    for (const [p, methods] of direct) {
      for (const me of methods) {
        if (!passt(me, p)) error.push(`${f}: ${me} ${p} — keine passende Route`);
      }
    }

    // Paths that are first built into a variable.
    for (const m of s.matchAll(/`\//g)) {
      const lit = readLiteral(s, m.index);
      if (!lit) continue;
      const p = normalize(lit.text);
      const seg = p.replace(/^\/api\/?/, '').split('/')[0];
      if (!segmentList.has(seg) || direct.has(p)) continue;
      if (!['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].some(me => passt(me, p))) {
        error.push(`${f}: ${p} — keine passende Route (Pfad in einer Variablen)`);
      }
    }
  }
  // Self-proof: without it a renamed public/i18n.js would be
  // invisible again — and the rule permanently green without ever looking. MEASURED
  // when extending: i18n.js is included.
  assert.ok(
    dateien.some(([f]) => f === 'i18n.js'),
    'public/i18n.js is not read — exactly the gap that let a 404 through on 25.09.',
  );

  assert.deepEqual(
    error,
    [],
    'Frontend paths without a route:\n  ' +
      error.join('\n  ') +
      '\nSuch calls fail silently when a .catch() is attached.',
  );
});
