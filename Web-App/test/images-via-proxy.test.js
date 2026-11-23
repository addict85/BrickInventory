/**
 * Every image goes via the own server — otherwise the policy blocks it.
 *
 * ── Counter-check (performed, result in the commit) ─────────────────────────
 *   The old line in merkliste.js restored → red.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ohneKommentare } = require('./helpers/sources');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'public', 'js');

/** Fields that can carry a FOREIGN address. */
const IMAGE_FIELD = /image_url|image_local|imageUrl|set_img_url|thumbUrl\(/;

// That the policy only allows img-src 'self' data: blob: is checked by security-across-cut-db.test.js
// on every response of the real server; the rule below relies on that.
test('no src attribute inserts an image field without imgUrl()/fullUrl()', () => {
  const dateien = fs.readdirSync(JS).filter(f => f.endsWith('.js') && f !== 'app.bundle.js');
  assert.ok(dateien.length >= 10, `Only ${dateien.length} scripts — does the search still match?`);

  const treffer = [];
  let geprueft = 0;
  for (const name of dateien) {
    const src = ohneKommentare(fs.readFileSync(path.join(JS, name), 'utf8'));
    // src="${ … }" in a template — the form in which the UIs
    // write images.
    const pruefe = (ausdruck, index) => {
      geprueft++;
      if (!IMAGE_FIELD.test(ausdruck)) return; // not an image field — irrelevant
      if (/\b(imgUrl|fullUrl)\(/.test(ausdruck)) return;
      treffer.push(`${name}:${src.slice(0, index).split('\n').length}`);
    };
    for (const m of src.matchAll(/\bsrc="\$\{([^}]*(?:\}[^"]*\{[^}]*)*)\}"/g)) pruefe(m[1], m.index);
    // And the templates via imageTag({ src: … }) — up to the comma at bracket depth 0.
    for (const m of src.matchAll(/imageTag\(\{\s*src:\s*/g)) {
      let i = m.index + m[0].length,
        depth = 0,
        ausdruck = '';
      for (; i < src.length; i++) {
        const c = src[i];
        if ('([{'.includes(c)) depth++;
        else if (')]}'.includes(c)) {
          if (depth === 0) break;
          depth--;
        } else if (c === ',' && depth === 0) break;
        ausdruck += c;
      }
      pruefe(ausdruck, m.index);
    }
  }
  assert.ok(geprueft >= 5, `Only ${geprueft} src insertions found — does the search still match?`);
  assert.deepEqual(
    treffer,
    [],
    'Here an image address stands unfiltered in src. If it is absolute (CDN), ' +
      "the policy img-src 'self' blocks loading — exactly Marco’s finding.",
  );
});
