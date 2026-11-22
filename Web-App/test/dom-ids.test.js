/**
 * DOM consistency: every element ID statically referenced via G('...') from the
 * frontend modules must exist in index.html. Exactly this class of error
 * (JS accesses renamed/removed IDs) otherwise only shows at runtime
 * as a silent TypeError.
 *
 * Counter-check: `G('zz-missing-id')` appended to public/js/init.js → red “G('...') IDs from init.js exist in index.html”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ohneKommentare } = require('./helpers/sources');

const PUB = path.join(__dirname, '..', 'public');
// app.bundle.js is a BUILD RESULT (scripts/build-frontend.js concatenates the
// source files into it) and only lives locally/in the image, not in the repo. If it
// were checked too, every test would report duplicate declarations — once from the
// source, once from the bundle.
const JS_FILES = fs
  .readdirSync(path.join(PUB, 'js'))
  .filter(f => f.endsWith('.js'))
  .filter(f => f !== 'app.bundle.js' && !f.startsWith('.'));

// Known IDs = index.html + all id="..." literals created in JS templates
// (many modals build their content at runtime as a template string).
const knownIds = new Set();
const collect = src => {
  for (const m of src.matchAll(/id=\\?"([^"\\]+)\\?"/g)) knownIds.add(m[1]);
  for (const m of src.matchAll(/id='([^']+)'/g)) knownIds.add(m[1]);
  // Also elements the code creates ITSELF: `el.id = 'name'`.
  for (const m of src.matchAll(/\.id\s*=\s*'([^']+)'/g)) knownIds.add(m[1]);
  for (const m of src.matchAll(/\.id\s*=\s*"([^"]+)"/g)) knownIds.add(m[1]);
  // And the fourth path: the view building block sets the id as an OPTION.
  for (const m of src.matchAll(/valueId:\s*'([^']+)'/g)) knownIds.add(m[1]);
  for (const m of src.matchAll(/valueId:\s*"([^"]+)"/g)) knownIds.add(m[1]);
  // And the fifth path: the storage location building block creates TWO elements from
  // one identifier — the text field `id` and the select `id-sel`
  // (admin.js, locationBlock). Since the field is a select with
  // new entry, the id literal no longer stands at the call site, …
  for (const m of src.matchAll(/locationBlock\(\s*'([^']+)'/g)) {
    knownIds.add(m[1]);
    knownIds.add(m[1] + '-sel');
  }
};
collect(fs.readFileSync(path.join(PUB, 'index.html'), 'utf8'));
for (const f of JS_FILES) collect(fs.readFileSync(path.join(PUB, 'js', f), 'utf8'));

// Exceptions — and the list is EMPTY, on purpose.
const ALLOWED_MISSING = new Set();

for (const file of JS_FILES) {
  test(`G('...') IDs from ${file} exist in index.html`, () => {
    // ohneKommentare: what is searched for are IDs in the CODE. An explanatory comment that
    // describes which G('…') stood here before and why it is gone is
    // not a use — without this step the test reports an ID that
    // nobody fetches anymore. The same trap against which helpers/sources.js …
    const src = ohneKommentare(fs.readFileSync(path.join(PUB, 'js', file), 'utf8'));
    const ids = [...src.matchAll(/G\(\s*'([^'+]+)'\s*\)/g)].map(m => m[1]);
    const missing = [...new Set(ids)].filter(id => !knownIds.has(id) && !ALLOWED_MISSING.has(id));
    assert.deepEqual(missing, [], `Fehlende IDs: ${missing.join(', ')}`);
  });
}

test('every module file hangs in the bundle graph', () => {
  // What these two tests used to check
  const { STANDALONE } = require('../scripts/build-frontend.js');
  const entry = fs.readFileSync(path.join(PUB, 'js', 'main.js'), 'utf8');
  const imported = new Set([...entry.matchAll(/from\s+'\.\/([^']+)'|import\s+'\.\/([^']+)'/g)].map(m => m[1] || m[2]));
  const actual = fs.readdirSync(path.join(PUB, 'js')).filter(f => f.endsWith('.js'));
  const orphans = actual.filter(f => !STANDALONE.has(f) && !imported.has(f) && f !== 'registry.js');
  assert.deepEqual(orphans, [], `Nicht im Modulgraphen und damit nie ausgeliefert: ${orphans.join(', ')}`);
});
