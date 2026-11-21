/**
 * The download button points to where the workflow really stores the APK.
 *
 * Button in jsdom (real bundle), workflow as structure. The release paths themselves
 * (signing, checksums, versions) are checked by the Android run:
 * Android-App/tools/release-wege.test.js.
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
  const o = await openUi({ '/v1/settings/tokens': { success: true, tokens: [] } });
  try {
    await sicht(o.w, 'app');
    const a = o.d.querySelector('a.apk-btn');
    const qr = o.d.getElementById('qr-container');
    assert.ok(a && qr, 'Download-Knopf oder QR-Code fehlt in der Sicht „App“');
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
  assert.ok(k.sichtbar, 'Der Knopf ist in der geöffneten Sicht nicht zu sehen');
  // First get the app, then link the device; the other way round there is nothing to scan yet.
  assert.ok(k.vorQr, 'Der Knopf steht hinter dem QR-Code');
  // Google's Android robot is bound by trademark law; the icon is deliberately our own.
  assert.ok(k.svg, 'Das Symbol kommt nicht als eigenes SVG mit.');
  assert.doesNotMatch(k.markup, /androidicons|google.*android.*logo|gstatic|play\.google\.com\/intl/i);
});

test('2. the same address as in the workflow', async () => {
  const adresse = (await knopf()).href;
  // ── From the workflow: fixed link and the name under which the APK is created ──
  const yml = fs.readFileSync(path.join(ROOT, '..', '.github', 'workflows', 'android-release.yml'), 'utf8');
  const link = yml.match(/^\s*LINK="https:\/\/github\.com\/\$GITHUB_REPOSITORY\/(\S+)"/m)?.[1];
  assert.ok(link, 'Im Workflow ist kein LINK mehr zu finden — Muster veraltet?');
  const apkName = yml.match(/^\s*APK=.*\/([^/\s]+\.apk)/m)?.[1];
  assert.ok(apkName, 'Im Workflow ist kein APK-Dateiname mehr zu finden — Muster veraltet?');
  assert.match(yml, /gh release create "\$QUELLE" [^\n]*"\$APK"/, 'Die Release wird ohne $APK angelegt.');

  assert.equal(
    adresse,
    `https://github.com/addict85/BrickInventory/${link}`,
    'Knopf und fester Link des Workflows zeigen auf verschiedene Orte.',
  );
  assert.ok(
    adresse.endsWith(`/releases/latest/download/${apkName}`),
    `Der Knopf zeigt auf "${adresse}", die Release trägt das APK aber als "${apkName}". ` +
      'Ein Klick endete auf der 404-Seite von GitHub.',
  );
});
