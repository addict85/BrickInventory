/**
 * The download button points to where the workflow really stores the APK.
 *
 * Button in jsdom (real bundle), workflow as structure. The release paths themselves
 * (signing, checksums, versions) are checked by the Android run:
 * Android-App/tools/release-paths.test.js.
 *
 * Counter-checks (measured 10.11.2026, each alone, reverted):
 *   b) button removed from index.html            → red: steps 1 and 2
 *   c) button moved behind the QR code           → red: step 1 (“behind the QR code”)
 * Counter-checks (measured 12.11.2026, each alone, reverted):
 *   d) button back to `releases/download/apk-neuste/…`          → red: step 2
 *   e) `"$APK"` out of `gh release create` in android-release.yml → red: step 2
 *   f) LINK in android-release.yml back to apk-neuste           → red: step 2
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { openUi, sicht } = require('./helpers/ui');

/** The button as the opened “App” view shows it. */
async function knopf() {
  const o = await openUi({ '/v2/settings/tokens': { success: true, tokens: [] } });
  try {
    await sicht(o.w, 'app');
    const a = o.d.querySelector('a.apk-btn');
    const qr = o.d.getElementById('qr-container');
    assert.ok(a && qr, 'Download button or QR code missing in the „App“ view');
    const sichtbar = el => {
      for (let e = el; e; e = e.parentElement) if (e.style?.display === 'none' || e.hidden) return false;
      return true;
    };
    return {
      href: a.getAttribute('href'),
      sichtbar: sichtbar(a),
      vorQr: !!(a.compareDocumentPosition(qr) & o.w.Node.DOCUMENT_POSITION_FOLLOWING),
      svg: !!a.querySelector('svg'),
      markup: a.outerHTML,
    };
  } finally {
    o.w.close();
  }
}

test('1. the button is in the "app" view, before the QR code, without a foreign brand mark', async () => {
  const k = await knopf();
  assert.match(k.href, /^https:\/\/github\.com\//, 'Der Knopf zeigt nicht auf GitHub — dort liegt das APK.');
  assert.ok(k.sichtbar, 'The button is not visible in the opened view');
  // First get the app, then link the device; the other way round there is nothing to scan yet.
  assert.ok(k.vorQr, 'The button is behind the QR code');
  // Google's Android robot is bound by trademark law; the icon is deliberately our own.
  assert.ok(k.svg, 'The icon does not come along as its own SVG.');
  assert.doesNotMatch(k.markup, /androidicons|google.*android.*logo|gstatic|play\.google\.com\/intl/i);
});

test('2. the same address as in the workflow', async () => {
  const address = (await knopf()).href;
  // ── From the workflow: fixed link and the name under which the APK is created ──
  const yml = fs.readFileSync(path.join(ROOT, '..', '.github', 'workflows', 'android-release.yml'), 'utf8');
  const link = yml.match(/^\s*LINK="https:\/\/github\.com\/\$GITHUB_REPOSITORY\/(\S+)"/m)?.[1];
  assert.ok(link, 'No LINK found in the workflow anymore — pattern outdated?');
  const apkName = yml.match(/^\s*APK=.*\/([^/\s]+\.apk)/m)?.[1];
  assert.ok(apkName, 'No APK file name found in the workflow anymore — pattern outdated?');
  assert.match(yml, /gh release create "\$QUELLE" [^\n]*"\$APK"/, 'The release is created without $APK.');

  assert.equal(
    address,
    `https://github.com/addict85/BrickInventory/${link}`,
    'The button and the fixed link of the workflow point to different places.',
  );
  assert.ok(
    address.endsWith(`/releases/latest/download/${apkName}`),
    `The button points to "${address}", but the release carries the APK as "${apkName}". ` +
      'A click would end on the GitHub 404 page.',
  );
});
