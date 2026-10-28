/**
 * Lesbar und erreichbar — gemessen im Browser mit den echten Stylesheets.
 *
 *   - Text auf Primär- und Fehlerflächen hat mindestens 4,5:1 (WCAG AA), auch
 *     im dunklen Design „werkbank". Ebenso die 11-px-Etiketten (Zustand,
 *     Besitzer, Menge), die Sammlungswahl und der Admin-Hinweis.
 *   - Die Datei-Felder in den Knopf-Labels (CSV, BrickLink XML) lassen sich
 *     fokussieren; mit display:none übersprang Tab sie.
 *   - Nummer und Jahr auf der Set-Kachel stehen in mindestens 12 px.
 *   - Zwischen zwei Wörtern auf einem Knopf steht mindestens 0,22 em.
 *   - Der Fokusring des Knopfs „Anmelden“ ist mindestens 3 px breit und hebt
 *     sich mit 3:1 vom Grund der Anmeldekarte ab, hell wie dunkel.
 *
 * Ohne Chrome (CHROME_BIN, google-chrome, chromium) wird übersprungen.
 *
 * Gegenproben (am 27.10. gemessen):
 *   A  --auf-primaer in themes/werkbank.css entfernt → rot: „werkbank: Primärknopf"
 *   B  .lerr wieder mit --r500 → rot: „Anmeldefehler"
 *   C  .datei-versteckt mit display:none → rot: „Datei-Feld fokussierbar"
 *   D  (28.10.) :focus-visible wieder 2px in var(--b600) → rot: „Fokusring hell: 2px“
 *   F  (28.10.) .cond-new wieder mit var(--g600) → rot: „hell: Etikett Neu 3:1“;
 *      .besitzer-badge mit --b600 → rot: „hell: Etikett Besitzer 4.24:1“
 *   G  (28.10.) .pnl-pos wieder #16a34a → rot: „hell: Gewinn 3.15:1“
 *   E  (28.10.) word-spacing am body entfernt, ebenso word-spacing:inherit an
 *      button → rot: „Wortabstand 0.17 em“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PUBLIC = path.join(__dirname, '..', 'public');
const STILE = ['vendor/fonts/fonts.css', 'tokens.css', 'styles.css', 'mobile.css', 'themes/werkbank.css'];

function chrome() {
  const kandidaten = [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'];
  return kandidaten.find(k => k && fs.existsSync(k)) ?? null;
}

function testseite() {
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
  <span class="cond-badge besitzer-badge" data-kontrast="hell: Etikett Besitzer">emily</span>
  <span class="qbadge" data-kontrast="hell: Menge">×2</span>
  <div class="hs"><span class="l" data-kontrast="hell: Kopfzahl">Anleitungen</span></div>
  <span class="admin-hinweis" data-kontrast="hell: Admin-Hinweis">(Admin)</span>
  <div class="sammlung-wahl"><button type="button" data-kontrast="hell: Sammlungswahl">Teile</button></div>
  <label class="btn bs" id="csv">CSV<input type="file" class="datei-versteckt" id="datei"></label>
  <div class="sc"><div class="scb"><div class="snum" id="snum">10294-1</div><div class="smeta" id="smeta">2021</div></div></div>
  <div class="lcard" data-fokus="hell"><button class="btn bp" type="button">Anmelden</button></div>
  <button class="btn bp" type="button"><span id="wort">Set hinzufügen</span></button>
</section>
<section data-theme="werkbank" style="background:var(--bg)">
  <div class="lcard" data-fokus="dunkel"><button class="btn bp" type="button">Anmelden</button></div>
</section>
<section data-theme="werkbank" style="background:var(--bg)">
  <button class="btn bp" data-kontrast="werkbank: Primärknopf">Speichern</button>
  <button class="period-btn active" data-kontrast="werkbank: Zeitraum">Woche</button>
  <span class="cond-badge cond-new" data-kontrast="werkbank: Etikett Neu">Neu</span>
  <span class="pnl-pos" data-kontrast="werkbank: Gewinn">+8.5%</span>
  <span class="cond-badge besitzer-badge" data-kontrast="werkbank: Etikett Besitzer">emily</span>
  <span class="admin-hinweis" data-kontrast="werkbank: Admin-Hinweis">(Admin)</span>
</section>
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
  const ring = [...document.querySelectorAll('[data-fokus]')].map(karte => {
    const k = karte.querySelector('button'); k.focus();
    const cs = getComputedStyle(k);
    const a = lum(rgb(cs.outlineColor)), b = lum(rgb(hinter(karte)));
    return { name: karte.dataset.fokus, breite: parseFloat(cs.outlineWidth), stil: cs.outlineStyle,
             wert: Math.round(((Math.max(a,b)+.05)/(Math.min(a,b)+.05))*100)/100 };
  });
  const datei = document.getElementById('datei'); datei.focus();
  const fokus = document.activeElement === datei;
  const px = id => parseFloat(getComputedStyle(document.getElementById(id)).fontSize);
  document.getElementById('ergebnis').textContent = 'ERGEBNIS' + JSON.stringify({ kontrast, fokus, ring, raum: wortabstand(), snum: px('snum'), smeta: px('smeta') }) + 'ENDE';
}));
/** Breite eines Leerzeichens in der Schrift des Knopfs, in em. */
function wortabstand() {
  const w = document.getElementById('wort'), b = t => { w.textContent = t; return w.getBoundingClientRect().width; };
  const raum = b('n n') - b('nn');
  return Math.round(raum / parseFloat(getComputedStyle(w).fontSize) * 100) / 100;
}
</script></body></html>`;
}

test('Kontrast, Datei-Felder und Kachelschrift', (t) => {
  const bin = chrome();
  if (!bin) { t.skip('kein Chrome gefunden'); return; }
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'lesbar-'));
  t.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
  const datei = path.join(ordner, 'seite.html');
  fs.writeFileSync(datei, testseite());
  const dom = execFileSync(bin, ['--headless', '--no-sandbox', '--disable-gpu', '--allow-file-access-from-files',
    '--window-size=1200,800', '--virtual-time-budget=3000', '--dump-dom', `file://${datei}`],
    { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'ignore'] });
  const m = /ERGEBNIS(.*?)ENDE/s.exec(dom);
  assert.ok(m, 'Die Testseite hat kein Ergebnis geschrieben');
  const e = JSON.parse((m[1] ?? '').replace(/&quot;/g, '"'));
  assert.ok(e.kontrast.length >= 16);
  assert.deepEqual(e.kontrast.filter(k => k.wert < 4.5).map(k => `${k.name} ${k.wert}:1`), []);
  assert.equal(e.fokus, true, 'Datei-Feld fokussierbar: Tab übersprang CSV und BrickLink XML');
  assert.ok(e.snum >= 12 && e.smeta >= 12, `Kachelschrift ${e.snum}/${e.smeta} px`);
  assert.ok(e.raum >= 0.22, `Wortabstand ${e.raum} em — „Set hinzufügen“ liest sich wie ein Wort`);
  assert.equal(e.ring.length, 2);
  for (const r of e.ring) {
    assert.ok(r.stil !== 'none' && r.breite >= 3, `Fokusring ${r.name}: ${r.breite}px ${r.stil}`);
    assert.ok(r.wert >= 3, `Fokusring ${r.name}: nur ${r.wert}:1 gegen den Grund`);
  }
});
