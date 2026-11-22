/**
 * Functions without callers.
 *
 * Counter-check: a function without caller appended to src/sets/service.ts → red “no function without a single caller”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ROOT, ohneKommentare } = require('./helpers/sources');

/** All .ts sources of the server plus the tests as the reference corpus. */
function dateien(subfolder, extension) {
  const out = [];
  (function walk(d) {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git', 'public'].includes(e.name)) continue;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name.endsWith(extension)) out.push(abs);
    }
  })(path.join(ROOT, subfolder));
  return out;
}

test('no function without a single caller', () => {
  const sources = ['routes', 'src', 'jobs', 'db']
    .flatMap(d => dateien(d, '.ts'))
    .concat([path.join(ROOT, 'server.ts')]);
  const korpus = sources
    .concat(dateien('test', '.js'))
    .map(f => ohneKommentare(fs.readFileSync(f, 'utf8')))
    .join('\n');

  assert.ok(sources.length > 20, `only ${sources.length} source files found — the check would run into nothing`);

  const tot = [];
  let geprueft = 0;
  for (const datei of sources) {
    const src = ohneKommentare(fs.readFileSync(datei, 'utf8'));
    for (const m of src.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) {
      const name = m[1];
      geprueft++;
      const treffer = (korpus.match(new RegExp(`\\b${name}\\b`, 'g')) || []).length;
      // 1 hit = only the declaration itself.
      if (treffer <= 1) tot.push(`${path.relative(ROOT, datei)}: ${name}`);
    }
  }

  assert.ok(geprueft > 100, `only ${geprueft} functions checked — the pattern no longer matches`);
  assert.deepEqual(tot, [], `Functions without a caller:\n  ${tot.join('\n  ')}`);
});

/**
 * The second half: EXPORTED names without callers.
 */
test('no exported value without a single caller', () => {
  const sources = ['routes', 'src', 'jobs', 'db', 'clients', 'startup']
    .flatMap(d => dateien(d, '.ts'))
    .concat([path.join(ROOT, 'server.ts')]);
  const withTests = sources.concat(dateien('test', '.js'));
  assert.ok(sources.length > 20, `only ${sources.length} source files — the check would run into nothing`);

  const inhalt = new Map(withTests.map(f => [f, ohneKommentare(fs.readFileSync(f, 'utf8'))]));

  // Counted SEPARATELY per notation — see the self-proof below.
  const found = { inline: 0, liste: 0 };

  /** Exported VALUES (no types) of a file. */
  const exportedValues = src => {
    const namen = new Set();
    for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/gm)) {
      namen.add(m[1]);
      found.inline++;
    }
    for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm))
      for (const roh of m[1].split(',')) {
        const n = roh.trim().split(' as ').pop().trim();
        // Capitalized and without parentheses: can be a type — the
        // distinction is not reliably possible here, so when in doubt
        // leave it out. Better one finding fewer than a false alarm.
        if (n && !/^[A-Z][A-Za-z]*$/.test(n)) {
          namen.add(n);
          found.liste++;
        }
      }
    return namen;
  };

  /** Occurrences in the own file, without declaration and export list. */
  const ownUsage = (src, name) => {
    let n = 0;
    let inExportList = false;
    for (const z of src.split('\n')) {
      const t = z.trim();
      if (/^export\s*\{/.test(t)) {
        inExportList = !t.includes('}');
        continue;
      }
      if (inExportList) {
        if (t.includes('}')) inExportList = false;
        continue;
      }
      if (new RegExp(`^(export\\s+)?(async\\s+)?(function|const|class)\\s+${name}\\b`).test(t)) continue;
      n += (z.match(new RegExp(`\\b${name}\\b`, 'g')) || []).length;
    }
    return n;
  };

  const tot = [];
  for (const datei of sources) {
    const src = inhalt.get(datei);
    for (const name of exportedValues(src)) {
      const elsewhere = [...inhalt].some(([f, t]) => f !== datei && new RegExp(`\\b${name}\\b`).test(t));
      if (!elsewhere && ownUsage(src, name) === 0) tot.push(`${path.relative(ROOT, datei)}: ${name}`);
    }
  }

  // Self-proof, per notation INDIVIDUALLY
  //
  // Not as a sum: a self-proof that adds numbers covers up the death
  // of one summand — exactly the kind of error it is built against.
  assert.ok(
    found.inline > 70,
    `Only ${found.inline} exports of the form \`export function x\` found ` +
      '(MEASURED: 139) — this pattern is outdated.',
  );
  assert.ok(
    found.liste > 125,
    `Only ${found.liste} exports of the form \`export { x }\` found ` +
      '(MEASURED: 252) — this pattern is outdated. Exactly this one found upsert().',
  );

  assert.deepEqual(
    tot,
    [],
    'These names are exported and called NOWHERE — not even in their ' +
      'own file. Either the connection is missing, or the version is outdated; ' +
      'both age unnoticed.',
  );
});
