/**
 * The intermediate dialog when capturing a set only shows steps the
 * browser actually waits for.
 *
 * Counter-check: in public/js/progress.js setStep('metazz', …) → red “every addressed ps identifier also exists in the dialog”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, withoutComments } = require('./helpers/sources');

/** All server sources that could report progress. */
function serverSources() {
  const dirs = ['src', 'routes', 'jobs', 'clients'];
  const out = [];
  const run = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) run(p);
      else if (e.name.endsWith('.ts')) out.push([path.relative(ROOT, p), withoutComments(fs.readFileSync(p, 'utf8'))]);
    }
  };
  for (const d of dirs) run(path.join(ROOT, d));
  return out;
}

/**
 * Splits an argument list at the commas of the TOP level.
 *
 * Necessary because calls like `addSet(a, b, c, d=>{ … ; send(d); }, e, f)` contain
 * commas in the middle of the fourth argument. A mere split(',') would look for the
 * progress reporter in the wrong place.
 */
function argList(text) {
  const parts = [];
  let depth = 0,
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
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) depth--;
    if (c === ',' && depth === 0) {
      parts.push(act.trim());
      act = '';
      continue;
    }
    act += c;
  }
  if (act.trim()) parts.push(act.trim());
  return parts;
}

/** Cuts out the parenthesis contents of the call from `start`. */
function bracketContent(src, start) {
  let depth = 0,
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
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return src.slice(start + 1, i);
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
  const sources = serverSources();
  const alles = sources.map(([, s]) => s).join('\n');
  const reachable = new Set();

  // Steps that a route writes directly into its own stream are always
  // reachable — there is no passed-through reporter there.
  for (const m of alles.matchAll(/\bsend\(\{\s*step\s*:\s*'([^']+)'/g)) reachable.add(m[1]);
  // A JSON response instead of a stream (domain error, „exists“) makes readSSE() turn it into an event.
  const read = fs.readFileSync(path.join(ROOT, 'public', 'js', 'progress.js'), 'utf8');
  for (const m of read.matchAll(/onEvent\(\{\s*step:[^,}]*\?\s*'(\w+)'\s*:\s*'(\w+)'/g)) {
    reachable.add(m[1]);
    reachable.add(m[2]);
  }

  for (const [file, src] of sources) {
    for (const m of src.matchAll(/(?:async\s+)?function\s+(\w+)\s*\(/g)) {
      const name = m[1];
      const params = bracketContent(src, m.index + m[0].length - 1);
      if (params === null || !/\bsendProgress\b/.test(params)) continue;
      const idx = argList(params).findIndex(a => /^sendProgress\b/.test(a));
      assert.notEqual(idx, -1, `${file}: sendProgress parameter of ${name} not found`);

      // Does this function report steps at all?
      const body = bracketContent(src, src.indexOf('{', m.index + m[0].length)) ?? '';
      const reported = [...src.slice(m.index).matchAll(/sendProgress\(\{\s*step\s*:\s*'([^']+)'/g)].map(x => x[1]);
      if (!reported.length) continue;

      // Does any caller pass something other than null?
      let alive = false;
      for (const [, s2] of sources) {
        for (const c of s2.matchAll(new RegExp(`\\b${name}\\s*\\(`, 'g'))) {
          if (/function\s*$/.test(s2.slice(0, c.index))) continue; // the declaration itself
          const args = bracketContent(s2, c.index + c[0].length - 1);
          if (args === null) continue;
          const a = argList(args)[idx];
          if (a !== undefined && a !== 'null') {
            alive = true;
            break;
          }
        }
        if (alive) break;
      }
      if (alive) for (const g of reported) reachable.add(g);
      void body;
    }
  }
  return reachable;
}

const gallery = fs.readFileSync(path.join(ROOT, 'public', 'js', 'progress.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

test('every step in the progress dialog can also reach the browser', () => {
  const toggle = gallery.slice(gallery.indexOf('export function handleSseEvent'));
  const body = toggle.slice(0, toggle.indexOf('\n}\n'));
  const cases = [...body.matchAll(/case\s+'([^']+)'/g)].map(m => m[1]);
  assert.ok(cases.length >= 3, `handleSseEvent has only ${cases.length} cases — the anchor is no longer right`);

  const reachable = reachableSteps();
  assert.ok(reachable.size >= 4, `only ${reachable.size} reachable steps found — the anchor is no longer right`);

  const tot = cases.filter(f => !reachable.has(f));
  assert.deepEqual(
    tot,
    [],
    `The dialog handles steps that no server place sends any more: ${tot.join(', ')}. ` +
      'Either the server sends them again, or the case should be removed from handleSseEvent.',
  );
});

test('every addressed ps identifier also exists in the dialog', () => {
  const ids = new Set([...gallery.matchAll(/'ps-([a-z-]+)'/g)].map(m => 'ps-' + m[1]));
  // setStep() assembles the identifier from 'ps-' + name; collect both forms.
  for (const m of gallery.matchAll(/setStep\('([a-z-]+)'/g)) ids.add('ps-' + m[1]);
  assert.ok(ids.size >= 2, `only ${ids.size} ps identifiers found — the anchor is no longer right`);

  const absent = [...ids].filter(id => !html.includes(`id="${id}"`));
  assert.deepEqual(absent, [], `The frontend addresses elements that do not exist in index.html: ${absent.join(', ')}`);
});

test('no language key for the removed steps remains', () => {
  for (const file of ['de.js', 'en.js']) {
    const s = fs.readFileSync(path.join(ROOT, 'public', 'locales', file), 'utf8');
    for (const key of ['prog.step_instr', 'prog.step_parts', 'prog.step_partimgs', 'prog.step_price']) {
      assert.ok(!s.includes(`'${key}'`), `${file}: ${key} belongs to a removed step`);
    }
    assert.ok(s.includes("'prog.hint_background'"), `${file}: the hint about the background work is missing`);
  }
});

/**
 * Plays the flow through once instead of only searching for patterns.
 */
