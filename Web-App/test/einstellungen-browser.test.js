/**
 * Das Port-Feld der SMTP-Einstellungen bleibt in seiner Karte — gemessen in
 * Chrome mit den echten Stylesheets und dem echten Markup der Karte aus
 * index.html, bei 1440 und 390 px Breite.
 *
 * Vorher: grid-template-columns:1fr 120px, aber .fg hat min-width:145px; die
 * Port-Spalte wurde 145 px breit und ragte rechts über die Karte hinaus.
 *
 * Ohne Chrome (CHROME_BIN, google-chrome, chromium) wird übersprungen.
 *
 * Gegenprobe (am 28.10. gemessen): .host-port .fg{min-width:0} entfernt →
 * rot: „1440: Port ragt … hinaus“.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { JSDOM } = require('jsdom');

const PUBLIC = path.join(__dirname, '..', 'public');
const STILE = ['tokens.css', 'styles.css', 'mobile.css'];

function chrome() {
  const kandidaten = [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'];
  return kandidaten.find(k => k && fs.existsSync(k)) ?? null;
}

/** Die SMTP-Karte, wie sie in index.html steht. */
function smtpKarte() {
  const d = new JSDOM(fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8')).window.document;
  const karte = d.getElementById('smtp-port')?.closest('.ssec');
  assert.ok(karte, 'Die SMTP-Karte ist nicht mehr zu finden');
  return karte.outerHTML;
}

function testseite() {
  const css = STILE.map(s => `<link rel="stylesheet" href="file://${path.join(PUBLIC, s)}">`).join('\n');
  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">${css}</head>
<body><main><div class="sgrid2">${smtpKarte()}</div></main><pre id="ergebnis"></pre>
<script>
window.addEventListener('load', () => {
  const karte = document.getElementById('smtp-port').closest('.ssec');
  const k = karte.getBoundingClientRect(), p = document.getElementById('smtp-port').getBoundingClientRect();
  const innen = k.right - parseFloat(getComputedStyle(karte).paddingRight);
  document.getElementById('ergebnis').textContent = 'ERGEBNIS' + JSON.stringify({ port: p.right, innen, breite: p.width }) + 'ENDE';
});
</script></body></html>`;
}

test('das Port-Feld bleibt in der Karte', (t) => {
  const bin = chrome();
  if (!bin) { t.skip('kein Chrome gefunden'); return; }
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'einstellungen-'));
  t.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
  const datei = path.join(ordner, 'seite.html');
  fs.writeFileSync(datei, testseite());
  for (const breite of [1440, 390]) {
    const dom = execFileSync(bin, ['--headless', '--no-sandbox', '--disable-gpu', '--allow-file-access-from-files',
      `--window-size=${breite},900`, '--virtual-time-budget=3000', '--dump-dom', `file://${datei}`],
      { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'ignore'] });
    const m = /ERGEBNIS(.*?)ENDE/s.exec(dom);
    assert.ok(m, 'Die Testseite hat kein Ergebnis geschrieben');
    const e = JSON.parse((m[1] ?? '').replace(/&quot;/g, '"'));
    assert.ok(e.breite > 40, `${breite}: Port-Feld nur ${e.breite} px breit`);
    assert.ok(e.port <= e.innen + 0.5, `${breite}: Port ragt ${Math.round(e.port - e.innen)} px über die Karte hinaus`);
  }
});
