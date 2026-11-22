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
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { stempleAssets, fileStamp } = _req('src/infra/assetStempel.js');

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
    const vorher = stampFrom(stempleAssets(HTML, dir));
    assert.ok(vorher && vorher !== 'alt', `Kein Stempel gesetzt: ${vorher}`);

    fs.writeFileSync(path.join(dir, 'a.css'), '.a{color:blue;padding:1px}');
    const nachher = stampFrom(stempleAssets(HTML, dir));
    assert.notEqual(
      nachher,
      vorher,
      'Nach dem Ändern steht dieselbe Adresse da — dann behält jeder Browser ' +
        'seine alte Kopie, bis zu sieben Tage lang. Genau das war Marcos Befund.',
    );

    // And the case that justifies the SIZE in the stamp: same mtime,
    // different content. Without the size it could not be told apart.
    const st = fs.statSync(path.join(dir, 'a.css'));
    fs.writeFileSync(path.join(dir, 'a.css'), '.a{color:blue;padding:1px}/*x*/');
    fs.utimesSync(path.join(dir, 'a.css'), st.atime, st.mtime);
    assert.notEqual(
      stampFrom(stempleAssets(HTML, dir)),
      nachher,
      'Bei gleicher Änderungszeit, aber anderer Grösse bleibt die Adresse ' +
        'gleich — dann fehlt die Grösse im Stempel.',
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
    const a = stampFrom(stempleAssets(HTML, dir));
    await new Promise(r => setTimeout(r, 20));
    const b = stampFrom(stempleAssets(HTML, dir));
    assert.equal(
      a,
      b,
      'Zwei Aufrufe liefern verschiedene Adressen, obwohl sich nichts geändert ' +
        'hat — dann lädt der Browser bei jedem Aufruf alles neu.',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing file leaves the existing value in place', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stempel-leer-'));
  try {
    assert.equal(
      stempleAssets(HTML, dir),
      HTML,
      'Für eine Datei, die es nicht gibt, wurde etwas gestempelt — eine ' +
        'fehlende Datei ist ein anderes Problem und darf die Adressen der ' +
        'übrigen nicht verwackeln.',
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
    assert.equal(stempleAssets(roh, dir), roh, 'Ein bewusst unversionierter Verweis wurde angefasst.');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the renderer really stamps', () => {
  // A rule nobody calls is the most expensive way of doing nothing —
  // and the cases above would stay green because they call the function
  // directly. The same gap as with sitzung-beruehrung and
  // sitzung-leerlauf, closed there with the same rationale.
  const idx = fs.readFileSync(path.join(ROOT, 'src/profile/indexHtml.ts'), 'utf8');
  assert.match(
    idx,
    /return stampAssetsCached\(out, PUBLIC_DIR\)/,
    'src/profile/indexHtml.ts stempelt die Assets nicht mehr — dann gilt wieder die ' +
      'Zahl aus package.json, und die steht still, wenn niemand den Bumper läuft.',
  );
  // LAST, after the language swap: the language file itself carries a `?v=`.
  //
  // The anchor is `lang !== ` and NOT `/locales/`. The first attempt took
  // the latter — and hit a comment further up (position 3150 instead of
  // 4882), making the case red although the order was right. A
  // check that hangs on the wrong word measures the wrong thing.
  assert.ok(
    idx.indexOf('stampAssetsCached(out') > idx.indexOf('lang !== '),
    'Gestempelt wird vor dem Austausch der Sprachdatei — dann hängt der ' +
      'Stempel der deutschen Datei an der englischen.',
  );
});
