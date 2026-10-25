#!/usr/bin/env node
/**
 * Handy-Breite prüfen: Ragt auf 390 px irgendein Reiter über den Rand?
 *
 * Braucht einen laufenden Server und Playwright (nicht Teil der Abhängigkeiten,
 * die CI hat keinen Browser). Aufruf:
 *
 *   BASIS=http://localhost:3000 NUTZER=admin PASSWORT=… node scripts/pruefe-handy-breite.js
 *
 * Meldet je Reiter die innersten überstehenden Elemente; Exit-Code 1, wenn
 * die Seite breiter als der Bildschirm ist. Die Reiterleiste scrollt
 * absichtlich waagrecht und zählt nicht.
 */
const BASIS = process.env.BASIS || 'http://localhost:3000';
const REITER = ['gallery', 'parts', 'minifigs', 'partslist', 'finance', 'wanted', 'catalog', 'settings', 'monitor'];

(async () => {
  // Name in einer Variablen: Playwright ist keine Abhängigkeit, tsc soll es nicht suchen.
  const MODUL = 'playwright';
  /** @type {any} */
  let chromium;
  try { ({ chromium } = require(MODUL)); }
  catch { console.error('Playwright fehlt: npm i -D playwright (nur lokal nötig).'); process.exit(2); }
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const p = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await p.goto(BASIS);
  await p.fill('#lu', process.env.NUTZER || 'admin');
  await p.fill('#lp', process.env.PASSWORT || '');
  await p.click('#btn-login');
  await p.waitForSelector('#ubadge', { state: 'attached', timeout: 60000 });
  // Die App stellt nach dem Anmelden den letzten Reiter wieder her.
  await p.waitForTimeout(12000);

  let zuBreit = 0;
  for (const tab of REITER) {
    await p.evaluate(/** @param {string} t */ t =>
      /** @type {HTMLElement | null} */ (document.querySelector(`.ntab[data-tab="${t}"]`))?.click(), tab);
    await p.waitForTimeout(2500);
    const r = await p.evaluate(() => {
      const w = document.documentElement.clientWidth;
      /** @param {Element} el */
      const name = el => el.id ? `#${el.id}` : el.tagName.toLowerCase() +
        (typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/)[0]}` : '');
      /** @param {Element} el */
      const pfad = el => {
        const t = [];
        for (let e = /** @type {Element | null} */ (el); e && e !== document.body && t.length < 5; e = e.parentElement) t.unshift(name(e));
        return t.join('>');
      };
      const ueber = [...document.querySelectorAll('main *, header *')]
        .filter(el => /** @type {HTMLElement} */ (el).offsetParent !== null && !el.closest('nav') && el.getBoundingClientRect().right > w + 0.5);
      const innerste = ueber.filter(el => !ueber.some(o => o !== el && el.contains(o)));
      return { breite: document.documentElement.scrollWidth, w,
               stellen: [...new Set(innerste.map(el => `${pfad(el)} +${Math.round(el.getBoundingClientRect().right - w)}px`))] };
    });
    const ok = r.breite <= r.w;
    if (!ok) zuBreit++;
    console.log(`${ok ? 'ok  ' : 'BREIT'} ${tab.padEnd(10)} ${r.breite}/${r.w}`);
    for (const s of r.stellen.slice(0, 10)) console.log(`        ${s}`);
  }
  await browser.close();
  process.exit(zuBreit ? 1 : 0);
})().catch(e => { console.error(e.message.split('\n')[0]); process.exit(2); });
