/**
 * Kontrast in allen sechs Designs, hell und dunkel: Jeder Text, der in
 * Sammlung und Finanzen vorkommt (Setnummer, Jahr, Datum, Preis, Gewinn,
 * Verlust, Kennzahl, Unterzeile, Gruppenkopf, Plaketten, Basiszeile), hat
 * auf seinem echten Grund mindestens 4,5:1. Gemessen in Chrome mit den …
 * Ausführlich: docs/begruendungen/test/kontrast-designs-browser.test.js.md#kopf
 *
 * Gegenproben (am 03.11.2026 gemessen):
 *   A  in themes/noppe.css --b600 der hellen Variante nicht überschrieben →
 *      rot: „noppe hell: Setnummer in der Tabelle 4.44:1“ (ebenso hochglanz)
 *   B  dort --gewinn nicht überschrieben → rot: „noppe hell: Gewinn in der
 *      Tabelle 4.43:1“ (ebenso hochglanz)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PUBLIC = path.join(__dirname, '..', 'public');
const STILE = ['vendor/fonts/fonts.css', 'tokens.css', 'styles.css', 'themes/brick.css', 'themes/werkbank.css',
  'themes/farbfaecher.css', 'themes/noppe.css', 'themes/hochglanz.css'];
const DESIGNS = ['classic', 'brick', 'werkbank', 'farbfaecher', 'noppe', 'hochglanz'];

const { chrome } = require('./helpers/app-browser');

/** Die Bausteine, wie sie in Sammlung und Finanzen stehen; `n` ist das Präfix des Namens. */
function abschnitt(n) {
  return `
  <div class="tw"><table class="dt dt-fin"><thead><tr><th data-k="${n}: Tabellenkopf">Einstand</th></tr></thead><tbody><tr>
    <td><span class="nummer-klein" data-k="${n}: Setnummer in der Tabelle">10294-1</span></td>
    <td class="fin-name">Titanic <span class="fin-jahr" data-k="${n}: Jahr in der Tabelle">2021</span></td>
    <td class="fin-datum" data-k="${n}: Datum in der Tabelle">01.06.2026</td>
    <td class="fin-guv"><span class="pnl-pos" data-k="${n}: Gewinn in der Tabelle">+4,8 %</span></td>
    <td class="fin-guv"><span class="pnl-neg" data-k="${n}: Verlust in der Tabelle">−6,9 %</span></td>
    <td class="fin-wert price-total" data-k="${n}: Marktwert in der Tabelle">712,40 €</td>
    <td><span class="pnl-geschenk" data-k="${n}: Geschenk">Geschenk</span></td>
  </tr></tbody></table><p class="fin-fussnote" data-k="${n}: Fussnote">Der Marktwert enthält …</p></div>
  <div class="fgrid">
    <div class="fstat"><div class="flbl" data-k="${n}: Kartenkopf">Einstand</div><div class="fval" data-k="${n}: Kennzahl">1.529,98 €</div><div class="fsub" data-k="${n}: Kartenunterzeile">Summe der Kaufpreise</div></div>
    <div class="fstat hi"><div class="flbl" data-k="${n}: Kopf der Hervorhebung">Marktwert</div><div class="fval" data-k="${n}: Kennzahl der Hervorhebung">1.863,90 €</div><div class="fsub" data-k="${n}: Unterzeile der Hervorhebung">Zum mittleren BrickLink-Preis</div></div>
  </div>
  <p class="fin-basis"><strong data-k="${n}: Basiszeile fett">Gerechnet über 4 von 9 Positionen.</strong> <span data-k="${n}: Basiszeile">5 Positionen ohne Marktpreis nicht gerechnet</span></p>
  <div id="gallery"><div class="sgrid"><div class="sc"><div class="scb">
    <div class="snum" data-k="${n}: Setnummer der Kachel">10294-1</div>
    <div class="smeta"><span class="smeta-text" data-k="${n}: Jahr und Thema">2021 · Icons</span>
      <div class="splaketten"><span class="teile-zahl" data-k="${n}: Teilezahl">9.092 Teile</span><span class="ibadge besitz-badge" data-k="${n}: In Sammlung">In Sammlung</span></div></div>
    <div class="price-badge"><span class="preis-art" data-k="${n}: Preisart">Marktpreis</span><span class="preis" data-k="${n}: Preis der Kachel">712,40 €</span><span class="preis-pnl"><span class="pnl-pos" data-k="${n}: Gewinn der Kachel">+4,8 %</span></span></div>
    <div class="kachel-datum" data-k="${n}: Kaufdatum der Kachel">Gekauft 01.06.2026</div>
  </div></div></div></div>
  <div class="parts-group"><div class="group-hd"><span class="group-title" data-k="${n}: Gruppentitel">Manuell erfasste Teile</span><span class="group-sub" data-k="${n}: Gruppenzahl">1 Sorte</span></div></div>
  <div class="brick-stats"><div class="bstat bstat-slate"><div class="bstat-l" data-k="${n}: Statistik-Etikett">Sets</div><div class="bstat-v" data-k="${n}: Statistik-Wert">4</div></div></div>
  <button class="period-btn" data-k="${n}: Zeitraum-Knopf">Woche</button>`;
}

function testseite() {
  const css = STILE.map(s => `<link rel="stylesheet" href="file://${path.join(PUBLIC, s)}">`).join('\n');
  const teile = [];
  for (const d of DESIGNS) for (const dunkel of d === 'werkbank' ? [true] : [false, true])
    teile.push(`<section data-theme="${d}"${dunkel ? ' data-dunkel' : ''} style="background:var(--bg);padding:8px"><div id="app" style="display:block">${abschnitt(`${d} ${dunkel ? 'dunkel' : 'hell'}`)}</div></section>`);
  return `<!doctype html><html lang="de"><head><meta charset="utf-8">${css}
<style>*{transition:none!important;animation:none!important}</style></head><body>${teile.join('\n')}
<pre id="ergebnis"></pre>
<script>
function rgba(s){ const v=(s.match(/[\\d.]+/g)||[]).map(Number); return v.length<4?[...v,1]:v; }
function lum([r,g,b]){ const f=c=>{c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4)}; return .2126*f(r)+.7152*f(g)+.0722*f(b); }
/** Grund: deckende Flächen von innen nach aussen, halbdurchsichtige darüber gemischt. */
function grund(el){ const schichten=[]; for(let e=el;e;e=e.parentElement){ const b=rgba(getComputedStyle(e).backgroundColor); if(b[3]>0){ schichten.push(b); if(b[3]>=1) break; } }
  let farbe=[255,255,255]; for(const s of schichten.reverse()) farbe=farbe.map((c,i)=>c*(1-s[3])+s[i]*s[3]); return farbe; }
window.addEventListener('load', () => document.fonts.ready.then(() => {
  const werte = [...document.querySelectorAll('[data-k]')].map(el => {
    const f = rgba(getComputedStyle(el).color), g = grund(el);
    const vorn = f.slice(0,3).map((c,i)=>c*f[3]+g[i]*(1-f[3]));
    const a = lum(vorn), b = lum(g);
    return { name: el.dataset.k, wert: Math.round(((Math.max(a,b)+.05)/(Math.min(a,b)+.05))*100)/100 };
  });
  document.getElementById('ergebnis').textContent = 'ERGEBNIS' + JSON.stringify(werte) + 'ENDE';
}));
</script></body></html>`;
}

test('Kontrast in allen Designs, hell und dunkel', (t) => {
  const bin = chrome();
  if (!bin) { t.skip('kein Chrome gefunden'); return; }
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'kontrast-'));
  t.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
  const datei = path.join(ordner, 'seite.html');
  fs.writeFileSync(datei, testseite());
  const dom = execFileSync(bin, ['--headless', '--no-sandbox', '--disable-gpu', '--allow-file-access-from-files',
    '--window-size=1200,800', '--virtual-time-budget=3000', '--dump-dom', `file://${datei}`],
    { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'ignore'] });
  const m = /ERGEBNIS(.*?)ENDE/s.exec(dom);
  assert.ok(m, 'Die Testseite hat kein Ergebnis geschrieben');
  const werte = JSON.parse((m[1] ?? '').replace(/&quot;/g, '"'));
  assert.equal(werte.length, 11 * 30, `${werte.length} Messungen — fehlt ein Design oder ein Baustein?`);
  assert.deepEqual(werte.filter(k => k.wert < 4.5).map(k => `${k.name} ${k.wert}:1`), []);
});
