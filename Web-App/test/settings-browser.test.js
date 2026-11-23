/**
 * The port field of the SMTP settings stays in its card — measured in
 * Chrome with the real stylesheets and the real markup of the card from
 * index.html, at 1440 and 390 px width.
 *
 * Counter-check (measured on 28.10.): .host-port .fg{min-width:0} removed →
 * red: „1440: Port ragt … hinaus“.
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

const { chrome } = require('./helpers/app-browser');

/** The SMTP card as it stands in index.html. */
function smtpCard() {
  const d = new JSDOM(fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8')).window.document;
  const card = d.getElementById('smtp-port')?.closest('.ssec');
  assert.ok(card, 'The SMTP card can no longer be found');
  return card.outerHTML;
}

function testPage() {
  const css = STILE.map(s => `<link rel="stylesheet" href="file://${path.join(PUBLIC, s)}">`).join('\n');
  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">${css}</head>
<body><main><div class="sgrid2">${smtpCard()}</div></main><pre id="ergebnis"></pre>
<script>
window.addEventListener('load', () => {
  const card = document.getElementById('smtp-port').closest('.ssec');
  const k = card.getBoundingClientRect(), p = document.getElementById('smtp-port').getBoundingClientRect();
  const inner = k.right - parseFloat(getComputedStyle(card).paddingRight);
  document.getElementById('ergebnis').textContent = 'ERGEBNIS' + JSON.stringify({ port: p.right, inner, width: p.width }) + 'ENDE';
});
</script></body></html>`;
}

test('the port field stays in the card', t => {
  const bin = chrome();
  if (!bin) {
    t.skip('no Chrome found');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'einstellungen-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'seite.html');
  fs.writeFileSync(file, testPage());
  for (const width of [1440, 390]) {
    const dom = execFileSync(
      bin,
      [
        '--headless',
        '--no-sandbox',
        '--disable-gpu',
        '--allow-file-access-from-files',
        `--window-size=${width},900`,
        '--virtual-time-budget=3000',
        '--dump-dom',
        `file://${file}`,
      ],
      { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const m = /ERGEBNIS(.*?)ENDE/s.exec(dom);
    assert.ok(m, 'The test page wrote no result');
    const e = JSON.parse((m[1] ?? '').replace(/&quot;/g, '"'));
    assert.ok(e.width > 40, `${width}: Port-Feld nur ${e.width} px breit`);
    assert.ok(e.port <= e.inner + 0.5, `${width}: port sticks out ${Math.round(e.port - e.inner)} px beyond the card`);
  }
});
