/**
 * The trash on the tile is at least 32 × 32 px large on the desktop too, measured in the browser
 * (with a mouse 32 px suffice; the 44 px for touch are checked by tip-targets-browser.test.js).
 *
 * Counter-check (measured on 07.11.): in styles.css `.delbtn` back to 26 px
 *   → red: “delete button measures 26×26”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chrome } = require('./helpers/app-browser');

const PUBLIC = path.join(__dirname, '..', 'public');

test('delete button on the tile measures at least 32 × 32 px on desktop', t => {
  const bin = chrome();
  if (!bin) {
    t.skip('no Chrome found');
    return;
  }
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'delbtn-'));
  t.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
  const css = ['tokens.css', 'styles.css']
    .map(s => `<link rel="stylesheet" href="file://${path.join(PUBLIC, s)}">`)
    .join('');
  const seite = `<!doctype html><html lang="de"><head><meta charset="utf-8">${css}</head><body>
<div class="sc" style="width:170px"><div class="ca"><span class="delbtn" data-ziel>×</span></div><div class="sb">Titanic</div></div>
<pre id="e"></pre><script>addEventListener('load',()=>{const r=document.querySelector('[data-ziel]').getBoundingClientRect();
document.getElementById('e').textContent='ERGEBNIS'+Math.round(r.width)+'x'+Math.round(r.height)+'ENDE';});</script></body></html>`;
  const datei = path.join(ordner, 'seite.html');
  fs.writeFileSync(datei, seite);
  const dom = execFileSync(
    bin,
    [
      '--headless',
      '--no-sandbox',
      '--disable-gpu',
      '--allow-file-access-from-files',
      '--window-size=1280,800',
      '--virtual-time-budget=3000',
      '--dump-dom',
      `file://${datei}`,
    ],
    { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const m = /ERGEBNIS(\d+)x(\d+)ENDE/.exec(dom);
  assert.ok(m, 'The test page wrote no result');
  const [b, h] = [Number(m[1]), Number(m[2])];
  assert.ok(b >= 32 && h >= 32, `Delete button measures ${b}×${h}`);
});
