/**
 * Der Download-Knopf zeigt dorthin, wo der Workflow das APK wirklich ablegt.
 *
 * Knopf in jsdom (echtes Bündel), Workflow als Struktur. Die Release-Wege selbst
 * (Signieren, Prüfsummen, Fassungen) prüft der Android-Lauf:
 * Android-App/tools/release-wege.test.js.
 *
 * Gegenproben (10.11.2026 gemessen, je einzeln, zurückgenommen):
 *   b) Knopf aus index.html entfernt             → rot: Schritt 1 und 2
 *   c) Knopf hinter den QR-Code verschoben       → rot: Schritt 1 („hinter dem QR-Code“)
 * Gegenproben (12.11.2026 gemessen, je einzeln, zurückgenommen):
 *   d) Knopf wieder auf `releases/download/apk-neuste/…`        → rot: Schritt 2
 *   e) `"$APK"` aus `gh release create` in android-release.yml  → rot: Schritt 2
 *   f) LINK in android-release.yml wieder auf apk-neuste        → rot: Schritt 2
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { oeffneOberflaeche, sicht } = require('./helpers/oberflaeche');

/** Der Knopf, wie ihn die geöffnete Sicht „App“ zeigt. */
async function knopf() {
  const o = await oeffneOberflaeche({ '/v1/settings/tokens': { success: true, tokens: [] } });
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

test('1. der Knopf steht in der Sicht „App“, vor dem QR-Code, ohne fremdes Markenzeichen', async () => {
  const k = await knopf();
  assert.match(k.href, /^https:\/\/github\.com\//, 'Der Knopf zeigt nicht auf GitHub — dort liegt das APK.');
  assert.ok(k.sichtbar, 'Der Knopf ist in der geöffneten Sicht nicht zu sehen');
  // Erst die App holen, dann das Gerät verknüpfen; andersherum gibt es noch nichts zu scannen.
  assert.ok(k.vorQr, 'Der Knopf steht hinter dem QR-Code');
  // Googles Android-Roboter ist markenrechtlich gebunden; das Symbol ist bewusst ein eigenes.
  assert.ok(k.svg, 'Das Symbol kommt nicht als eigenes SVG mit.');
  assert.doesNotMatch(k.markup, /androidicons|google.*android.*logo|gstatic|play\.google\.com\/intl/i);
});

test('2. dieselbe Adresse wie im Workflow', async () => {
  const adresse = (await knopf()).href;
  // ── Aus dem Workflow: fester Link und der Name, unter dem das APK angelegt wird ──
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
