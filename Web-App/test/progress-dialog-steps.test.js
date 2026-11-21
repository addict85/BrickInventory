/**
 * The intermediate dialog when capturing a set only shows steps the
 * browser actually waits for.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, ohneKommentare } = require('./helpers/sources');

/** All server sources that could report progress. */
function serverSources() {
  const dirs = ['src', 'routes', 'jobs', 'clients'];
  const out = [];
  const lauf = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) lauf(p);
      else if (e.name.endsWith('.ts')) out.push([path.relative(ROOT, p), ohneKommentare(fs.readFileSync(p, 'utf8'))]);
    }
  };
  for (const d of dirs) lauf(path.join(ROOT, d));
  return out;
}

/**
 * Splits an argument list at the commas of the TOP level.
 *
 * Necessary because calls like `addSet(a, b, c, d=>{ … ; send(d); }, e, f)` contain
 * commas in the middle of the fourth argument. A mere split(',') would look for the
 * progress reporter in the wrong place.
 */
function argumente(text) {
  const teile = [];
  let tiefe = 0,
    act = '',
    str = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (str) {
      if (c === str && text[i - 1] !== '\\') str = null;
      act += c;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      str = c;
      act += c;
      continue;
    }
    if ('([{'.includes(c)) tiefe++;
    if (')]}'.includes(c)) tiefe--;
    if (c === ',' && tiefe === 0) {
      teile.push(act.trim());
      act = '';
      continue;
    }
    act += c;
  }
  if (act.trim()) teile.push(act.trim());
  return teile;
}

/** Cuts out the parenthesis contents of the call from `start`. */
function bracketContent(src, start) {
  let tiefe = 0,
    str = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (str) {
      if (c === str && src[i - 1] !== '\\') str = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      str = c;
      continue;
    }
    if (c === '(') tiefe++;
    else if (c === ')') {
      tiefe--;
      if (tiefe === 0) return src.slice(start + 1, i);
    }
  }
  return null;
}

/**
 * Steps that can reach the browser.
 *
 * Approach: for every function with a `sendProgress` parameter the
 * position of this parameter is determined and it is checked whether any caller passes
 * something other than `null` there. Only then do the step names reported in the
 * body of this function count as reachable.
 */
function reachableSteps() {
  const quellen = serverSources();
  const alles = quellen.map(([, s]) => s).join('\n');
  const erreichbar = new Set();

  // Steps that a route writes directly into its own stream are always
  // reachable — there is no passed-through reporter there.
  for (const m of alles.matchAll(/\bsend\(\{\s*step\s*:\s*'([^']+)'/g)) erreichbar.add(m[1]);
  // A JSON response instead of a stream (domain error, „exists“) makes readSSE() turn it into an event.
  const lesen = fs.readFileSync(path.join(ROOT, 'public', 'js', 'progress.js'), 'utf8');
  for (const m of lesen.matchAll(/onEvent\(\{\s*step:[^,}]*\?\s*'(\w+)'\s*:\s*'(\w+)'/g)) {
    erreichbar.add(m[1]);
    erreichbar.add(m[2]);
  }

  for (const [datei, src] of quellen) {
    for (const m of src.matchAll(/(?:async\s+)?function\s+(\w+)\s*\(/g)) {
      const name = m[1];
      const params = bracketContent(src, m.index + m[0].length - 1);
      if (params === null || !/\bsendProgress\b/.test(params)) continue;
      const idx = argumente(params).findIndex(a => /^sendProgress\b/.test(a));
      assert.notEqual(idx, -1, `${datei}: sendProgress-Parameter von ${name} nicht gefunden`);

      // Does this function report steps at all?
      const rumpf = bracketContent(src, src.indexOf('{', m.index + m[0].length)) ?? '';
      const gemeldet = [...src.slice(m.index).matchAll(/sendProgress\(\{\s*step\s*:\s*'([^']+)'/g)].map(x => x[1]);
      if (!gemeldet.length) continue;

      // Does any caller pass something other than null?
      let lebt = false;
      for (const [, s2] of quellen) {
        for (const c of s2.matchAll(new RegExp(`\\b${name}\\s*\\(`, 'g'))) {
          if (/function\s*$/.test(s2.slice(0, c.index))) continue; // the declaration itself
          const args = bracketContent(s2, c.index + c[0].length - 1);
          if (args === null) continue;
          const a = argumente(args)[idx];
          if (a !== undefined && a !== 'null') {
            lebt = true;
            break;
          }
        }
        if (lebt) break;
      }
      if (lebt) for (const g of gemeldet) erreichbar.add(g);
      void rumpf;
    }
  }
  return erreichbar;
}

const galerie = fs.readFileSync(path.join(ROOT, 'public', 'js', 'progress.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

test('every step in the progress dialog can also reach the browser', () => {
  const schalter = galerie.slice(galerie.indexOf('export function handleSseEvent'));
  const rumpf = schalter.slice(0, schalter.indexOf('\n}\n'));
  const faelle = [...rumpf.matchAll(/case\s+'([^']+)'/g)].map(m => m[1]);
  assert.ok(faelle.length >= 3, `handleSseEvent hat nur ${faelle.length} Fälle — Anker stimmt nicht mehr`);

  const erreichbar = reachableSteps();
  assert.ok(erreichbar.size >= 4, `nur ${erreichbar.size} erreichbare Schritte gefunden — Anker stimmt nicht mehr`);

  const tot = faelle.filter(f => !erreichbar.has(f));
  assert.deepEqual(
    tot,
    [],
    `Der Dialog behandelt Schritte, die keine Serverstelle mehr sendet: ${tot.join(', ')}. ` +
      'Entweder sendet der Server sie wieder, oder der Fall gehört aus handleSseEvent entfernt.',
  );
});

test('every addressed ps identifier also exists in the dialog', () => {
  const ids = new Set([...galerie.matchAll(/'ps-([a-z-]+)'/g)].map(m => 'ps-' + m[1]));
  // setStep() assembles the identifier from 'ps-' + name; collect both forms.
  for (const m of galerie.matchAll(/setStep\('([a-z-]+)'/g)) ids.add('ps-' + m[1]);
  assert.ok(ids.size >= 2, `nur ${ids.size} ps-Kennungen gefunden — Anker stimmt nicht mehr`);

  const fehlend = [...ids].filter(id => !html.includes(`id="${id}"`));
  assert.deepEqual(fehlend, [], `Frontend spricht Elemente an, die es in index.html nicht gibt: ${fehlend.join(', ')}`);
});

test('no language key for the removed steps remains', () => {
  for (const datei of ['de.js', 'en.js']) {
    const s = fs.readFileSync(path.join(ROOT, 'public', 'locales', datei), 'utf8');
    for (const key of ['prog.step_instr', 'prog.step_parts', 'prog.step_partimgs', 'prog.step_price']) {
      assert.ok(!s.includes(`'${key}'`), `${datei}: ${key} gehört zu einem entfernten Schritt`);
    }
    assert.ok(s.includes("'prog.hint_background'"), `${datei}: Hinweis auf die Hintergrundarbeit fehlt`);
  }
});

/**
 * Plays the flow through once instead of only searching for patterns.
 */
test('after the last event no item hangs on “active”', () => {
  // ── Sending order, as the capture stream produces it ───────────────
  // The route reports before and after supplementing itself; in between fetchCatalog() reports.
  const lies = rel => ohneKommentare(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  const route = require('./helpers/sources').kompakt(lies('routes/api_v1/setsImport.ts'));
  // The route and its helper supplementInStream (before the router factory).
  const strom =
    route.slice(
      route.indexOf("router.endpunkt('POST /api/v1/sets/add-stream'"),
      route.indexOf("router.endpunkt('POST /api/v1/sets/:setNumber/parts'"),
    ) +
    route.slice(
      route.indexOf('async function supplementInStream('),
      route.indexOf('export function buildSetsImportRouter'),
    );
  assert.ok(strom.includes('setSupplement('), 'Erfassungsstrom nicht gefunden — Anker stimmt nicht mehr');
  const erfassen = lies('src/sets/addSet.ts');
  const katalog = erfassen.slice(
    erfassen.indexOf('async function fetchCatalog('),
    erfassen.indexOf('export async function setSupplement('),
  );
  const schritte = t => [...t.matchAll(/step\s*:\s*'([^']+)'/g)].map(m => m[1]);
  const [vor, nach] = strom.split('setSupplement(');
  const sequence = [...schritte(vor), ...schritte(katalog), ...schritte(nach)];
  assert.ok(sequence.length >= 4, `der Strom meldet nur ${sequence.length} Schritte — Anker stimmt nicht mehr`);

  // ── Switching logic, as handleSseEvent() executes it ───────────────────────
  const schalter = galerie.slice(galerie.indexOf('export function handleSseEvent'));
  const rumpf = schalter.slice(0, schalter.indexOf('\n}\n'));
  const wirkung = {};
  for (const branch of rumpf.split(/(?=\bcase\s+')/)) {
    const c = branch.match(/^case\s+'([^']+)'\s*:/);
    if (!c) continue;
    wirkung[c[1]] = [...branch.matchAll(/setStep\('([a-z-]+)'\s*,\s*'(\w+)'\)/g)].map(m => [m[1], m[2]]);
  }

  // ── Playing through ─────────────────────────────────────────────────────────
  const zustand = {};
  for (const ereignis of sequence) {
    for (const [punkt, wert] of wirkung[ereignis] || []) zustand[punkt] = wert;
  }

  const haengt = Object.entries(zustand)
    .filter(([, w]) => w === 'active')
    .map(([k]) => k);
  assert.deepEqual(
    haengt,
    [],
    `Diese Punkte bleiben am Ende auf „aktiv" hängen: ${haengt.join(', ')}. ` +
      'Entweder sendet der Server ein abschliessendes Ereignis dafür, oder der ' +
      'Punkt gehört nicht in den Dialog — er zeigt sonst dauerhaft Arbeit an, ' +
      'auf die niemand wartet.',
  );

  // And every point that EXISTS in the dialog must also be reached by the flow.
  const gezeigt = [...html.matchAll(/class="prog-step" id="ps-([a-z-]+)"/g)].map(m => m[1]);
  assert.ok(gezeigt.length >= 2, `nur ${gezeigt.length} Punkte im Dialog — Anker stimmt nicht mehr`);
  const neverTouched = gezeigt.filter(g => !(g in zustand));
  assert.deepEqual(
    neverTouched,
    [],
    `Diese Punkte stehen im Dialog, werden aber nie geschaltet: ${neverTouched.join(', ')}`,
  );
});
