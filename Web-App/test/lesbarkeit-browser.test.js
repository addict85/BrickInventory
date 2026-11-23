/**
 * Readable and reachable — measured in the browser with the real stylesheets.
 *
 * Counter-checks (measured on 27.10.):
 *   A  --on-primary removed in themes/werkbank.css → red: „werkbank: Primärknopf"
 *   B  .lerr again with --r500 → red: „Anmeldefehler"
 *   C  .file-hidden with display:none → red: „Datei-Feld fokussierbar"
 *   D  (28.10.) :focus-visible again 2px in var(--b600) → red: „Fokusring hell: 2px“
 *   F  (28.10.) .cond-new again with var(--g600) → red: „hell: Etikett Neu 3:1“;
 *      .owner-badge with --b600 → red: „hell: Etikett Besitzer 4.24:1“
 *   G  (28.10.) .pnl-pos again #16a34a → red: „hell: Gewinn 3.15:1“
 *   I  (29.10.) the dark blocks skipped in the generator (tokens
 *      regenerated) → red: „Die Karte der dunklen Variante ist hell“ (all five)
 *   H  (28.10.) --price removed in themes/noppe.css → red: „Preis in Rot“
 *      with „noppe: Preis“ and „hochglanz: Preis“
 *   E  (28.10.) word-spacing on the body removed, likewise word-spacing:inherit on
 *      button → red: „Wortabstand 0.17 em“
 *   J  (29.10.) .fval again var(--b700) → red: „Preis in Rot“ (noppe: Kennzahl,
 *      hochglanz: Kennzahl); noppe nav .ntab again var(--b100) → red: „noppe:
 *      Reiter 3.74:1“; .spare-tag again var(--mut) → red: „hell: Ersatzteil
 *      4.34:1“; .fstat.hi .fsub removed → red: „… hellblauen Kachel 4.37:1“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PUBLIC = path.join(__dirname, '..', 'public');
const STILE = [
  'vendor/fonts/fonts.css',
  'tokens.css',
  'styles.css',
  'mobile.css',
  'themes/werkbank.css',
  'themes/noppe.css',
  'themes/hochglanz.css',
];

const { chrome } = require('./helpers/app-browser');

function testPage() {
  const css = STILE.map(s => `<link rel="stylesheet" href="file://${path.join(PUBLIC, s)}">`).join('\n');
  return `<!doctype html><html lang="de"><head><meta charset="utf-8">${css}
<style>/* Gemessen wird der Endzustand, nicht der Übergang (.btn hat transition:all). */ *{transition:none!important}</style></head><body>
<section id="hell">
  <button class="btn bp" data-kontrast="hell: Primärknopf">Speichern</button>
  <div class="lerr" style="display:block" data-kontrast="Anmeldefehler">Falsches Passwort</div>
  <button class="btn bd" data-kontrast="Löschknopf">Löschen</button>
  <span class="pnl-neg" data-kontrast="Verlust">-4.0%</span>
  <span class="pnl-pos" data-kontrast="hell: Gewinn">+8.5%</span>
  <span class="cond-badge cond-new" data-kontrast="hell: Etikett Neu">Neu</span>
  <span class="cond-badge cond-used" data-kontrast="hell: Etikett Gebraucht">Gebraucht</span>
  <span class="cond-badge owner-badge" data-kontrast="hell: Etikett Besitzer">emily</span>
  <span class="qbadge" data-kontrast="hell: Menge">×2</span>
  <div class="hs"><span class="l" data-kontrast="hell: Kopfzahl">Anleitungen</span></div>
  <span class="admin-hint" data-kontrast="hell: Admin-Hinweis">(Admin)</span>
  <div class="collection-choice"><button type="button" data-kontrast="hell: Sammlungswahl">Teile</button></div>
  <span class="spare-tag" data-kontrast="hell: Ersatzteil">Ersatzteil</span>
  <div class="fstat hi"><div class="fsub" data-kontrast="hell: Unterzeile der hellblauen Kachel">Spanne 4'005 – 6'295</div></div>
  <label class="btn bs" id="csv">CSV<input type="file" class="file-hidden" id="datei"></label>
  <div class="sc"><div class="scb"><div class="snum" id="snum">10294-1</div><div class="smeta" id="smeta">2021</div></div></div>
  <div class="lcard" data-focused="hell"><button class="btn bp" type="button">Anmelden</button></div>
  <button class="btn bp" type="button"><span id="wort">Set hinzufügen</span></button>
</section>
<section data-theme="werkbank" style="background:var(--bg)">
  <div class="lcard" data-focused="dark"><button class="btn bp" type="button">Anmelden</button></div>
</section>
<section data-theme="werkbank" style="background:var(--bg)">
  <button class="btn bp" data-kontrast="werkbank: Primärknopf">Speichern</button>
  <button class="period-btn active" data-kontrast="werkbank: Zeitraum">Woche</button>
  <span class="cond-badge cond-new" data-kontrast="werkbank: Etikett Neu">Neu</span>
  <span class="pnl-pos" data-kontrast="werkbank: Gewinn">+8.5%</span>
  <span class="cond-badge owner-badge" data-kontrast="werkbank: Etikett Besitzer">emily</span>
  <span class="admin-hint" data-kontrast="werkbank: Admin-Hinweis">(Admin)</span>
</section>
<section data-theme="noppe" style="background:var(--sur)">
  <span class="price" data-kontrast="noppe: Preis" data-farbton="noppe: Preis">411,90 €</span>
  <div class="fstat"><div class="fval" data-farbton="noppe: Kennzahl">EUR 4'894.77</div></div>
  <nav><button type="button" class="ntab" data-kontrast="noppe: Reiter">Teile</button></nav>
</section>
<section data-theme="hochglanz" style="background:var(--sur)">
  <span class="price" data-kontrast="hochglanz: Preis" data-farbton="hochglanz: Preis">411,90 €</span>
  <div class="fstat hi"><div class="fval" data-farbton="hochglanz: Kennzahl">EUR 5'002.20</div></div>
  <nav><button type="button" class="ntab" data-kontrast="hochglanz: Reiter">Teile</button></nav>
</section>
<section data-theme="classic" data-dark style="background:var(--bg)"><div style="background:var(--sur)">
  <button class="btn bp" data-kontrast="dark classic: Primärknopf">Speichern</button>
  <span style="color:var(--txt)" data-kontrast="dark classic: Text">Zeitmaschine</span>
  <span style="color:var(--mut)" data-kontrast="dark classic: Nebentext">2022 · Icons</span>
  <span class="price" data-kontrast="dark classic: Preis">411,90 €</span>
  <span class="pnl-pos" data-kontrast="dark classic: Gewinn">+8,5 %</span>
  <span class="pnl-neg" data-kontrast="dark classic: Verlust">−4,0 %</span>
  <span style="color:var(--b600)" data-marke="classic" data-kontrast="dark classic: Markenfarbe">10300-1</span>
</div></section>
<section data-theme="brick" data-dark style="background:var(--bg)"><div style="background:var(--sur)">
  <button class="btn bp" data-kontrast="dark brick: Primärknopf">Speichern</button>
  <span style="color:var(--txt)" data-kontrast="dark brick: Text">Zeitmaschine</span>
  <span style="color:var(--mut)" data-kontrast="dark brick: Nebentext">2022 · Icons</span>
  <span class="price" data-kontrast="dark brick: Preis">411,90 €</span>
  <span class="pnl-pos" data-kontrast="dark brick: Gewinn">+8,5 %</span>
  <span class="pnl-neg" data-kontrast="dark brick: Verlust">−4,0 %</span>
  <span style="color:var(--b600)" data-marke="brick" data-kontrast="dark brick: Markenfarbe">10300-1</span>
</div></section>
<section data-theme="farbfaecher" data-dark style="background:var(--bg)"><div style="background:var(--sur)">
  <button class="btn bp" data-kontrast="dark farbfaecher: Primärknopf">Speichern</button>
  <span style="color:var(--txt)" data-kontrast="dark farbfaecher: Text">Zeitmaschine</span>
  <span style="color:var(--mut)" data-kontrast="dark farbfaecher: Nebentext">2022 · Icons</span>
  <span class="price" data-kontrast="dark farbfaecher: Preis">411,90 €</span>
  <span class="pnl-pos" data-kontrast="dark farbfaecher: Gewinn">+8,5 %</span>
  <span class="pnl-neg" data-kontrast="dark farbfaecher: Verlust">−4,0 %</span>
  <span style="color:var(--b600)" data-marke="farbfaecher" data-kontrast="dark farbfaecher: Markenfarbe">10300-1</span>
</div></section>
<section data-theme="noppe" data-dark style="background:var(--bg)"><div style="background:var(--sur)">
  <button class="btn bp" data-kontrast="dark noppe: Primärknopf">Speichern</button>
  <span style="color:var(--txt)" data-kontrast="dark noppe: Text">Zeitmaschine</span>
  <span style="color:var(--mut)" data-kontrast="dark noppe: Nebentext">2022 · Icons</span>
  <span class="price" data-kontrast="dark noppe: Preis">411,90 €</span>
  <span class="pnl-pos" data-kontrast="dark noppe: Gewinn">+8,5 %</span>
  <span class="pnl-neg" data-kontrast="dark noppe: Verlust">−4,0 %</span>
  <span style="color:var(--b600)" data-marke="noppe" data-kontrast="dark noppe: Markenfarbe">10300-1</span>
</div></section>
<section data-theme="hochglanz" data-dark style="background:var(--bg)"><div style="background:var(--sur)">
  <button class="btn bp" data-kontrast="dark hochglanz: Primärknopf">Speichern</button>
  <span style="color:var(--txt)" data-kontrast="dark hochglanz: Text">Zeitmaschine</span>
  <span style="color:var(--mut)" data-kontrast="dark hochglanz: Nebentext">2022 · Icons</span>
  <span class="price" data-kontrast="dark hochglanz: Preis">411,90 €</span>
  <span class="pnl-pos" data-kontrast="dark hochglanz: Gewinn">+8,5 %</span>
  <span class="pnl-neg" data-kontrast="dark hochglanz: Verlust">−4,0 %</span>
  <span style="color:var(--b600)" data-marke="hochglanz" data-kontrast="dark hochglanz: Markenfarbe">10300-1</span>
</div></section>
<pre id="ergebnis"></pre>
<script>
function rgb(s){ return (s.match(/[\\d.]+/g)||[]).slice(0,3).map(Number); }
function lum([r,g,b]){ const f=c=>{c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4)}; return .2126*f(r)+.7152*f(g)+.0722*f(b); }
function hinter(el){ for(let e=el;e;e=e.parentElement){ const b=getComputedStyle(e).backgroundColor; const v=b.match(/[\\d.]+/g)||[]; if(v.length&&(v.length<4||+v[3]>0)) return b; } return 'rgb(255,255,255)'; }
window.addEventListener('load', () => document.fonts.ready.then(() => {
  const kontrast = [...document.querySelectorAll('[data-kontrast]')].map(el => {
    const a = lum(rgb(getComputedStyle(el).color)), b = lum(rgb(hinter(el)));
    return { name: el.dataset.kontrast, wert: Math.round(((Math.max(a,b)+.05)/(Math.min(a,b)+.05))*100)/100 };
  });
  const ring = [...document.querySelectorAll('[data-focused]')].map(card => {
    const k = card.querySelector('button'); k.focus();
    const cs = getComputedStyle(k);
    const a = lum(rgb(cs.outlineColor)), b = lum(rgb(hinter(card)));
    return { name: card.dataset.focused, width: parseFloat(cs.outlineWidth), style: cs.outlineStyle,
             wert: Math.round(((Math.max(a,b)+.05)/(Math.min(a,b)+.05))*100)/100 };
  });
  const farbton = [...document.querySelectorAll('[data-farbton]')].map(el => {
    const [r, g, b] = rgb(getComputedStyle(el).color).map(c => c / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    const s = max === 0 ? 0 : d / max;
    let h = 0;
    if (d) h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
    return { name: el.dataset.farbton, rot: s > 0.35 && (h < 25 || h > 335) };
  });
  const brands = [...document.querySelectorAll('[data-marke]')].map(el => getComputedStyle(el).color);
  const darkReason = [...document.querySelectorAll('section[data-dark] > div')]
    .map(el => ({ name: el.parentElement.dataset.theme, hell: Math.round(lum(rgb(getComputedStyle(el).backgroundColor)) * 1000) / 1000 }));
  const file = document.getElementById('datei'); file.focus();
  const focused = document.activeElement === file;
  const px = id => parseFloat(getComputedStyle(document.getElementById(id)).fontSize);
  document.getElementById('ergebnis').textContent = 'ERGEBNIS' + JSON.stringify({ kontrast, farbton, brands, darkReason, focused, ring, space: wortabstand(), snum: px('snum'), smeta: px('smeta') }) + 'ENDE';
}));
/** Breite eines Leerzeichens in der Schrift des Knopfs, in em. */
function wortabstand() {
  const w = document.getElementById('wort'), b = t => { w.textContent = t; return w.getBoundingClientRect().width; };
  const space = b('n n') - b('nn');
  return Math.round(space / parseFloat(getComputedStyle(w).fontSize) * 100) / 100;
}
</script></body></html>`;
}

test('contrast, file fields and tile font', t => {
  const bin = chrome();
  if (!bin) {
    t.skip('no Chrome found');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lesbar-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'seite.html');
  fs.writeFileSync(file, testPage());
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
      `file://${file}`,
    ],
    { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const m = /ERGEBNIS(.*?)ENDE/s.exec(dom);
  assert.ok(m, 'The test page wrote no result');
  const e = JSON.parse((m[1] ?? '').replace(/&quot;/g, '"'));
  assert.ok(e.kontrast.length >= 16);
  assert.ok(e.kontrast.filter(k => k.name.startsWith('dark ')).length === 35, 'The dark variants are missing');
  assert.deepEqual(
    e.darkReason.filter(g => g.hell > 0.05).map(g => `${g.name} ${g.hell}`),
    [],
    'The card of the dark variant is light',
  );
  // hochglanz inherits the colors of noppe; the other four stay distinguishable.
  assert.equal(new Set(e.brands).size, 4, `Brand colors dark: ${e.brands}`);
  assert.equal(e.farbton.length, 4);
  assert.deepEqual(
    e.farbton.filter(f => f.rot).map(f => f.name),
    [],
    'Price in red — reads as a loss',
  );
  assert.deepEqual(
    e.kontrast.filter(k => k.wert < 4.5).map(k => `${k.name} ${k.wert}:1`),
    [],
  );
  assert.equal(e.focused, true, 'File field focusable: Tab skipped CSV and BrickLink XML');
  assert.ok(e.snum >= 12 && e.smeta >= 12, `Kachelschrift ${e.snum}/${e.smeta} px`);
  assert.ok(e.space >= 0.22, `Word spacing ${e.space} em — „Set hinzufügen“ reads like one word`);
  assert.equal(e.ring.length, 2);
  for (const r of e.ring) {
    assert.ok(r.style !== 'none' && r.width >= 3, `Fokusring ${r.name}: ${r.width}px ${r.style}`);
    assert.ok(r.wert >= 3, `Focus ring ${r.name}: only ${r.wert}:1 against the background`);
  }
});
