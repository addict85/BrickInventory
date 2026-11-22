/**
 * The footers of the four detail dialogs — what stands there and how big it is.
 *
 * Counter-checks (all three performed):
 *   1. `btn-sm` reset on #man-detail-del            → step 1 red.
 *   2. the BrickLink button copied back into the set modal → step 2 red.
 *   3. the “back" button reinserted in #man-detail-modal → step 3 red.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

/** Cut out the body of a dialog by its id. */
function dialog(id) {
  const ab = html.indexOf(`id="${id}"`);
  assert.ok(ab > 0, `Dialog #${id} nicht gefunden — Markup umgebaut?`);
  // Up to the next dialog start; the last one reaches to the end of the file.
  const naechster = html.indexOf('<div class="ovl"', ab);
  return html.slice(ab, naechster > 0 ? naechster : html.length);
}

// The three dialogs with a trash. The fourth (#setitem-modal, parts FROM
// sets) has none: what belongs to a set is deleted via the set.
const WITH_TRASH = [
  ['Set-Detail', 'set-modal', 'btn-md'],
  ['Merkposten-Detail', 'mk-detail-modal', 'mk-m-del'],
  ['Teile/Figuren', 'man-detail-modal', 'man-detail-del'],
];

test('the trash is the same size in every detail dialog', () => {
  for (const [name, modal, knopf] of WITH_TRASH) {
    const zeile = dialog(modal)
      .split('\n')
      .find(z => z.includes(`id="${knopf}"`));
    assert.ok(zeile, `${name}: der Papierkorb #${knopf} fehlt`);
    const klassen = /class="([^"]*)"/.exec(zeile)?.[1] ?? '';
    assert.ok(
      klassen.includes('btn') && klassen.includes('bd'),
      `${name}: #${knopf} traegt nicht mehr „btn bd" (${klassen})`,
    );
    assert.ok(
      !klassen.includes('btn-sm'),
      `${name}: #${knopf} traegt „btn-sm" und ist damit kleiner als in den ` +
        'anderen Detail-Dialogen — genau Marcos Befund.',
    );
  }
});

test('the set detail no longer shows purchase addresses', () => {
  // Both buttons still stand in the catalog and wishlist item detail:
  // whoever wants to buy does NOT have the set yet. The test therefore does not check
  // “nowhere", but “not HERE".
  const set = dialog('set-modal');
  for (const id of ['m-bricklink', 'm-vergleich']) {
    assert.ok(
      !set.includes(`id="${id}"`),
      `Das Set-Detail zeigt wieder #${id}. Marcos Vorgabe: dort keine Kaufadressen.`,
    );
  }
  // And the opposite direction, so that the test does not turn green by deleting:
  // where they belong, they must still stand.
  for (const [modal, id] of [
    ['cat-modal', 'cat-m-bricklink'],
    ['mk-detail-modal', 'mk-m-bricklink'],
    ['mk-detail-modal', 'mk-m-comparison'],
  ]) {
    assert.ok(dialog(modal).includes(`id="${id}"`), `#${id} fehlt in #${modal} — dort gehoert die Adresse hin.`);
  }
});

test('the part/figure dialog has no second way out', () => {
  // The ✕ in the header closes the dialog. A “back" in the footer was
  // the same handle a second time.
  const man = dialog('man-detail-modal');
  const fuss = man.slice(man.indexOf('class="mfooter"'));
  assert.ok(
    !fuss.includes('acq.back'),
    'Der „Zurueck"-Knopf steht wieder in der Fusszeile des Teile-/Figuren-Dialogs.',
  );
  assert.ok(man.includes('data-click="closeManDetail"'), 'Ohne ✕ im Kopf waere der Dialog jetzt eine Sackgasse.');
});

/**
 * Title and footer bar of the dialogs stay in place when scrolling.
 *
 * Counter-checks (performed):
 *   a) a <div> put around the body of #set-modal     -> step 1 red.
 *   b) `position:sticky` removed from .mhd           -> step 2 red.
 *   c) the negative offset set to 0                  -> step 2 red.
 *   d) the padding variables removed from .modal     -> step 2 red.
 */
test('title and footer bar stick — and can do so', () => {
  // ── 1. Prerequisite: direct child of the scroll area ──────────────────────
  //
  // Searched, not enumerated: every dialog with a .mhd is checked, a
  // new one is thus included automatically.
  const dialoge = [...html.matchAll(/<div class="ovl"[^>]*id="([\w-]+)"/g)].map(m => m[1]);
  assert.ok(
    dialoge.length >= 8,
    `Nur ${dialoge.length} Dialoge gefunden — Muster veraltet? Ohne Fund prueft der Rest nichts.`,
  );

  let withBar = 0;
  for (const id of dialoge) {
    const rumpf = dialog(id);
    if (!/class="mhd"/.test(rumpf)) continue;
    withBar++;
    // Between `<div class="modal…">` and `<div class="mhd">` no further
    // opening <div> may stand.
    const abModal = rumpf.search(/<div class="modal/);
    assert.ok(abModal >= 0, `#${id}: kein .modal gefunden`);
    const untilHeader = rumpf.slice(abModal, rumpf.indexOf('<div class="mhd"'));
    const dazwischen = (untilHeader.match(/<div\b/g) || []).length - 1; // subtract the .modal itself
    assert.equal(
      dazwischen,
      0,
      `#${id}: zwischen .modal und .mhd liegen ${dazwischen} weitere <div>. ` +
        `position:sticky wirkt nur gegen den naechsten ROLLBEREICH, und das ist .modal ` +
        `(overflow-y:auto). Mit einem Element dazwischen hoert die Titelleiste ` +
        `stillschweigend auf zu kleben — kein Fehler, keine Warnung.`,
    );
  }
  assert.ok(withBar >= 6, `Nur ${withBar} Dialoge mit Titelleiste — zu wenig, da stimmt das Muster nicht mehr.`);

  // ── 2. The rules themselves ───────────────────────────────────────────────
  //
  // Comments out BEFORE searching: the explanation blocks in these files
  // quote the rules in question (“here stood `.mhd { position:
  // sticky; top: 0 }`"). Without that the check reports the explanatory text as a
  // violation — exactly that happened while writing this file.
  const withoutCssComments = t => t.replace(/\/\*[\s\S]*?\*\//g, '');
  const css = withoutCssComments(fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8'));
  const regel = wahl => {
    const ab = css.indexOf(wahl + '{');
    assert.ok(ab > 0, `${wahl} nicht mehr in styles.css gefunden`);
    return css.slice(ab, css.indexOf('}', ab));
  };

  const kopf = regel('.mhd'),
    fuss = regel('.mfooter');
  assert.match(kopf, /position:sticky/, 'Die Titelleiste klebt nicht mehr.');
  assert.match(fuss, /position:sticky/, 'Die Fussleiste klebt nicht mehr.');
  assert.match(
    kopf,
    /top:calc\(var\(--modal-pady\) \* -1\)/,
    'Der Versatz der Titelleiste ist nicht mehr die negative Polsterung. Mit top:0 ' +
      'bleibt sie um genau diese Polsterung zu tief stehen — in Chromium gemessen: 28px.',
  );
  assert.match(
    fuss,
    /bottom:calc\(var\(--modal-padb\) \* -1\)/,
    'Der Versatz der Fussleiste ist nicht mehr die negative Polsterung.',
  );
  // Full width: without the negative side margins a strip remains left and right
  // through which the content visibly scrolls past.
  for (const [name, r] of [
    ['Titelleiste', kopf],
    ['Fussleiste', fuss],
  ])
    assert.match(
      r,
      /calc\(var\(--modal-padx\) \* -1\)/,
      `${name}: kein negativer Seitenrand — dann geht sie nicht ueber die volle Breite.`,
    );
  // Opaque, otherwise the content shines through.
  for (const [name, r] of [
    ['Titelleiste', kopf],
    ['Fussleiste', fuss],
  ])
    assert.match(r, /background:var\(--sur\)/, `${name}: kein eigener Hintergrund.`);
  // The divider is SHAPE, not color — Marco has a red-green deficiency.
  assert.match(kopf, /border-bottom:1px solid/, 'Der Titelleiste fehlt die Trennlinie.');
  assert.match(fuss, /border-top:1px solid/, 'Der Fussleiste fehlt die Trennlinie.');

  const modal = regel('.modal');
  for (const v of ['--modal-padx', '--modal-pady', '--modal-padb'])
    assert.ok(
      modal.includes(v + ':'),
      `.modal setzt ${v} nicht mehr. Die Leisten rechnen damit ihre negativen Raender; ` +
        `ohne die Variable faellt calc() aus und die Leisten sitzen falsch.`,
    );

  // ── 3. The phone version must not turn back the padding ───────────────────
  const mobil = withoutCssComments(fs.readFileSync(path.join(__dirname, '..', 'public', 'mobile.css'), 'utf8'));
  assert.doesNotMatch(
    mobil,
    /\.mhd\s*\{[^}]*position:\s*sticky/,
    'mobile.css setzt .mhd wieder selbst auf sticky. Diese Regel gab es dort schon ' +
      'einmal — mit top:0 und eigener Polsterung, wodurch die Leiste zu tief stand. ' +
      'Die Regel steht jetzt in styles.css fuer alle Breiten.',
  );
  assert.match(
    mobil,
    /--modal-padx:/,
    'Die Handyfassung setzt ihre Polsterung nicht ueber die Variablen — dann sind die ' +
      'Leisten dort um die Differenz zu breit.',
  );
});
