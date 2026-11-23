/**
 * What stands in the header is readable on it: the real header from
 * index.html (menu flap open) in every design, light and dark, measured
 * in Chrome — every text against the background it really stands on. Because
 * it is rendered, a design rule via an ID also shows up (the former
 * rule derivation from classes did not see it and needed its own ban).
 *
 * Counter-checks (measured 10.11.2026, each alone) — appended to themes/brick.css,
 * each red with the location:
 *   A  `[data-theme="brick"] header .umenu-abmelden{color:#fff}` (white on the
 *      white flap — the bug the rule once overlooked)
 *   B  `[data-theme="brick"] header .logo .marke span{color:#3d5a80}` (color
 *      of the bar)
 *   C  `[data-theme="brick"] header #btn-logout{color:#fff}` (via an ID)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chrome } = require('./helpers/app-browser');

const WEB = path.join(__dirname, '..');
const P = (...t) => path.join(WEB, ...t);
const STILE = [
  'vendor/fonts/fonts.css',
  'tokens.css',
  'styles.css',
  'themes/brick.css',
  'themes/werkbank.css',
  'themes/farbfaecher.css',
  'themes/noppe.css',
  'themes/hochglanz.css',
];
const DESIGNS = ['classic', 'brick', 'werkbank', 'farbfaecher', 'noppe', 'hochglanz'];

/** The header as in production: data-style as style (styles.js), flap open, name set. */
function kopfleiste() {
  const html = require('./helpers/sources').withoutHtmlComments(fs.readFileSync(P('public', 'index.html'), 'utf8'));
  const kopf = html
    .slice(html.indexOf('<header'), html.indexOf('</header>') + 9)
    .replace(/data-style="/g, 'style="')
    .replace('<span class="ubadge-name" id="ubadge">—</span>', '<span class="ubadge-name" id="ubadge">anna</span>');
  assert.match(kopf, /id="umenu-pop"/, 'The menu toggle is no longer in the header bar');
  return kopf;
}

function testPage() {
  const css = STILE.map(s => `<link rel="stylesheet" href="file://${P('public', s)}">`).join('\n');
  const kopf = kopfleiste();
  const parts = [];
  for (const d of DESIGNS)
    for (const dunkel of d === 'werkbank' ? [true] : [false, true])
      parts.push(
        `<div class="probe" data-theme="${d}"${dunkel ? ' data-dark' : ''} data-name="${d} ${dunkel ? 'dunkel' : 'hell'}" style="background:var(--bg);color:var(--txt);font-family:var(--font);position:relative;min-height:640px">${kopf}</div>`,
      );
  return `<!doctype html><html lang="de"><head><meta charset="utf-8">${css}
<style>*{transition:none!important;animation:none!important}#umenu-pop{display:block!important;position:static!important}</style></head><body>${parts.join('\n')}
<pre id="ergebnis"></pre>
<script>
function rgba(s){ const v=(s.match(/[\\d.]+/g)||[]).map(Number); return v.length<4?[...v,1]:v; }
function lum([r,g,b]){ const f=c=>{c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4)}; return .2126*f(r)+.7152*f(g)+.0722*f(b); }
function grund(el){ const schichten=[]; for(let e=el;e;e=e.parentElement){ const b=rgba(getComputedStyle(e).backgroundColor); if(b[3]>0){ schichten.push(b); if(b[3]>=1) break; } }
  let farbe=[255,255,255]; for(const s of schichten.reverse()) farbe=farbe.map((c,i)=>c*(1-s[3])+s[i]*s[3]); return farbe; }
window.addEventListener('load', () => document.fonts.ready.then(() => {
  const werte = [];
  for (const probe of document.querySelectorAll('.probe')) {
    for (const el of probe.querySelectorAll('header *')) {
      const text = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
      if (!text || !el.getClientRects().length || el.closest("[hidden], svg")) continue;
      const st = getComputedStyle(el);
      if (st.visibility === 'hidden' || st.display === 'none' || el.offsetWidth <= 1 || el.offsetHeight <= 1) continue;
      const f = rgba(st.color), g = grund(el);
      const vorn = f.slice(0,3).map((c,i)=>c*f[3]+g[i]*(1-f[3]));
      const a = lum(vorn), b = lum(g);
      werte.push({ name: probe.dataset.name + ': ' + text.slice(0, 30), wert: Math.round(((Math.max(a,b)+.05)/(Math.min(a,b)+.05))*100)/100 });
    }
  }
  document.getElementById('ergebnis').textContent = 'ERGEBNIS' + JSON.stringify(werte) + 'ENDE';
}));
</script></body></html>`;
}

test('every text in the header bar is readable in every theme', t => {
  const bin = chrome();
  if (!bin) {
    t.skip('no Chrome found');
    return;
  }
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'kopfleiste-'));
  t.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
  const datei = path.join(ordner, 'seite.html');
  fs.writeFileSync(datei, testPage());
  const dom = execFileSync(
    bin,
    [
      '--headless',
      '--no-sandbox',
      '--disable-gpu',
      '--allow-file-access-from-files',
      '--window-size=1200,800',
      '--virtual-time-budget=3000',
      '--dump-dom',
      `file://${datei}`,
    ],
    { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const m = /ERGEBNIS(.*?)ENDE/s.exec(dom);
  assert.ok(m, 'The test page wrote no result');
  const values = JSON.parse((m[1] ?? '').replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  // Per design: brand, name, seven views and log out — at least ten texts.
  assert.ok(values.length >= 11 * 10, `${values.length} measurements — does the selection still match?`);
  assert.ok(
    values.some(w => /brick hell: Abmelden/.test(w.name)),
    'Sign-out is not measured',
  );
  // 4.5:1 — the WCAG threshold for normal text; the header only has small text.
  assert.deepEqual(
    values.filter(w => w.wert < 4.5).map(w => `${w.name} ${w.wert}:1`),
    [],
  );
});
