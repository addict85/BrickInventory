/**
 * Am Telefon bleibt jede Finanzkachel innerhalb der Seite, auch mit langen
 * Beträgen. Gemessen im Browser mit den echten Stylesheets: Fenster 500 px
 * (kleiner lässt Headless-Chrome nicht zu, die Telefonregeln greifen), Inhalt
 * in einem 412 px breiten Rahmen wie auf einem Pixel-Telefon.
 *
 * Ohne Chrome (CHROME_BIN, google-chrome, chromium) wird übersprungen.
 *
 * Gegenprobe (am 28.10.2026 gemessen): .fgrid in mobile.css wieder
 * `1fr 1fr` → rot: „Gesamtwert ragt … px über den Rand“.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PUBLIC = path.join(__dirname, '..', 'public');
const STILE = ['vendor/fonts/fonts.css', 'tokens.css', 'styles.css', 'mobile.css'];

function chrome() {
  const kandidaten = [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'];
  return kandidaten.find(k => k && fs.existsSync(k)) ?? null;
}

function testseite() {
  const css = STILE.map(s => `<link rel="stylesheet" href="file://${path.join(PUBLIC, s)}">`).join('\n');
  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">${css}</head><body>
<div id="telefon" style="width:412px"><div class="fgrid">
  <div class="fstat"><div class="flbl">Einstand</div><div class="fval" data-name="Einstand">EUR 12’345’678.90</div><div class="fsub">Summe der Kaufpreise</div></div>
  <div class="fstat hi"><div class="flbl">Gesamtwert (Ø Marktpreis)</div><div class="fval" data-name="Gesamtwert">EUR 13’456’789.01</div><div class="fsub">Spanne EUR 12’000’000.00 – EUR 14’000’000.00</div></div>
  <div class="fstat"><div class="flbl">Gesamt G&amp;V</div><div class="fval" data-name="G&amp;V">+8.5 %</div><div class="fsub">+EUR 1’111’110.11</div></div>
</div></div>
<pre id="ergebnis"></pre>
<script>
window.addEventListener('load', () => document.fonts.ready.then(() => {
  const breite = Math.round(document.getElementById('telefon').getBoundingClientRect().right);
  const ueber = [...document.querySelectorAll('.fstat')].map(k => ({
    name: k.querySelector('.fval').dataset.name, rechts: Math.round(k.getBoundingClientRect().right) }));
  document.getElementById('ergebnis').textContent = 'ERGEBNIS' + JSON.stringify({ breite, ueber }) + 'ENDE';
}));
</script></body></html>`;
}

test('Finanzkacheln am Telefon', (t) => {
  const bin = chrome();
  if (!bin) { t.skip('kein Chrome gefunden'); return; }
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'telefon-'));
  t.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
  const datei = path.join(ordner, 'seite.html');
  fs.writeFileSync(datei, testseite());
  const dom = execFileSync(bin, ['--headless', '--no-sandbox', '--disable-gpu', '--allow-file-access-from-files',
    '--window-size=500,800', '--virtual-time-budget=3000', '--dump-dom', `file://${datei}`],
    { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'ignore'] });
  const m = /ERGEBNIS(.*?)ENDE/s.exec(dom);
  assert.ok(m, 'Die Testseite hat kein Ergebnis geschrieben');
  const e = JSON.parse((m[1] ?? '').replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  assert.equal(e.ueber.length, 3);
  for (const k of e.ueber)
    assert.ok(k.rechts <= e.breite, `${k.name} ragt ${k.rechts - e.breite} px über den Rand`);
});
