/**
 * The `?v=` stamp comes from the FILE, not from a set number.
 *
 * ── Counter-checks (performed, results copied down) ─────────────────────────
 *
 *   A  `stampAssetsCached(...)` removed from src/profile/indexHtml.ts
 *      → “the renderer really stamps" red
 *   B  the size omitted from the stamp (mtime only)
 *      → “a changed file gets a new address" red — but only at
 *        the SECOND assertion (same mtime, different size). The first
 *        would stay green because writing also changes the mtime.
 *   C  stamp from `Date.now()` instead of from the file
 *      → “an unchanged file keeps its address" red.
 *        On the first attempt C was GREEN: without a pause both calls fell into
 *        the same millisecond. The case passed by chance. Since then there is
 *        a pause in between — the counter-check repaired the check,
 *        not the other way round.
 *   D  `return stampAssetsCached(…)` in startPageHtml() replaced by `return out`
 *      → “the renderer really stamps” red (runs the renderer with a stub context).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { stampAssets, fileStamp } = _req('src/infra/assetStamp.js');

/** A throwaway directory with a file in it. */
function build(inhalt) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stempel-'));
  fs.writeFileSync(path.join(dir, 'a.css'), inhalt);
  return dir;
}
const HTML = '<link rel="stylesheet" href="/a.css?v=alt">';
const stampFrom = s => (s.match(/\?v=([^"]*)/) || [])[1];

test('a changed file gets a new address', () => {
  const dir = build('.a{color:red}');
  try {
    const vorher = stampFrom(stampAssets(HTML, dir));
    assert.ok(vorher && vorher !== 'alt', `No stamp set: ${vorher}`);

    fs.writeFileSync(path.join(dir, 'a.css'), '.a{color:blue;padding:1px}');
    const nachher = stampFrom(stampAssets(HTML, dir));
    assert.notEqual(
      nachher,
      vorher,
      'After the change the same address is there — then every browser keeps ' +
        'its old copy for up to seven days. That was exactly Marco’s finding.',
    );

    // And the case that justifies the SIZE in the stamp: same mtime,
    // different content. Without the size it could not be told apart.
    const st = fs.statSync(path.join(dir, 'a.css'));
    fs.writeFileSync(path.join(dir, 'a.css'), '.a{color:blue;padding:1px}/*x*/');
    fs.utimesSync(path.join(dir, 'a.css'), st.atime, st.mtime);
    assert.notEqual(
      stampFrom(stampAssets(HTML, dir)),
      nachher,
      'With the same modification time but a different size the address stays ' +
        'the same — then the size is missing in the stamp.',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an unchanged file keeps its address', async () => {
  // The half one forgets: a stamp that ALWAYS changes (say
  // from the time of day) would pass the case above and invalidate on every
  // page load a 223 KB bundle and six designs.
  //
  // counter-check C, not reflection.
  const dir = build('.a{color:red}');
  try {
    const a = stampFrom(stampAssets(HTML, dir));
    await new Promise(r => setTimeout(r, 20));
    const b = stampFrom(stampAssets(HTML, dir));
    assert.equal(
      a,
      b,
      'Two calls deliver different addresses although nothing has changed ' +
        '— then the browser reloads everything on every call.',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing file leaves the existing value in place', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stempel-leer-'));
  try {
    assert.equal(
      stampAssets(HTML, dir),
      HTML,
      'Something was stamped for a file that does not exist — a ' +
        'missing file is a different problem and must not shake the addresses of the ' +
        'others.',
    );
    assert.equal(fileStamp(path.join(dir, 'gibtsnicht.css')), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a reference without ?v= stays untouched', () => {
  const dir = build('.a{}');
  try {
    const roh = '<link href="/a.css"><script src="/b.js"></script>';
    assert.equal(stampAssets(roh, dir), roh, 'A deliberately unversioned reference was touched.');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the renderer really stamps', async () => {
  // A rule nobody calls does nothing; the start page must carry the stamps of the files it names —
  // and the stamp of the language file it serves, not of the German one it replaced.
  // Straight from dist/: _req binds area functions to the test services, here k is the stub.
  const { startPageHtml } = require(path.join(ROOT, 'dist', 'src/profile/indexHtml.js'));
  const k = {
    config: { production: false },
    clock: { now: () => Date.now() },
    settings: {
      themeFor: async () => ({ own: 'classic' }),
      globalValue: async () => 'classic',
      userSettings: async () => ({ language: 'en' }),
    },
  };
  const out = await startPageHtml(k, 1);
  const pub = path.join(ROOT, 'public');
  const styles = fileStamp(path.join(pub, 'styles.css'));
  const en = fileStamp(path.join(pub, 'locales', 'en.js'));
  assert.ok(styles && en, 'the stamp of the files could not be computed');
  assert.ok(out.includes(`/styles.css?v=${styles}`), 'the start page does not carry the stamp of styles.css');
  assert.ok(out.includes(`/locales/en.js?v=${en}`), 'the English language file carries a foreign stamp');
});
