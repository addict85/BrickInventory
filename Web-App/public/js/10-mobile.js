// Was mobile.css nicht deklarativ kann: Tabellenzellen bekommen ihre Spaltenbeschriftung in data-label
// gestempelt, statt zehn Vorlagen anzufassen und künftige zu vergessen. Läuft immer, wirkt nur schmal.
// Ausführlich: docs/begruendungen/public/js/10-mobile.js.md#ergaenzt-mobile-css-um-die-zwei-dinge-di

(function () {
  'use strict';

  // ── 1. data-label auf Tabellenzellen ────────────────────────────────────

  /** Beschriftungen einer Tabelle aus ihrem <thead> übernehmen. */
  /** @param {HTMLTableElement | null | undefined} table */
  function labelTable(table) {
    if (!table || table.dataset.labelled === '1') return;
    const head = table.tHead;
    if (!head || !head.rows.length) return;

    // Nur die unterste Kopfzeile zählt — mehrzeilige Köpfe (Gruppenüberschrift darüber) kommen in den
    // Finanztabellen vor.
    const headRow = head.rows[head.rows.length - 1];
    // Nur sichtbarer Text: Ein Kopf, der bloss für Vorleser beschriftet ist (.vh), bleibt in der Karte leer.
    const labels = [...headRow.cells].map(th => { const k = th.cloneNode(true); /** @type {Element} */ (k).querySelectorAll('.vh').forEach(v => { v.remove(); }); return (k.textContent || '').trim(); });
    if (!labels.length) return;

    for (const body of table.tBodies) {
      for (const row of body.rows) {
        let col = 0;
        for (const cell of row.cells) {
          if (!cell.hasAttribute('data-label')) {
            cell.setAttribute('data-label', labels[col] || '');
          }
          // colspan berücksichtigen, sonst verrutschen alle folgenden Spalten
          col += cell.colSpan || 1;
        }
      }
    }
    table.dataset.labelled = '1';
  }

  /** Alle noch unbeschrifteten Tabellen unterhalb von root behandeln. */
  /** @param {Element | null | undefined} root */
  function labelAll(root) {
    const scope = root ?? document;
    if (scope instanceof HTMLTableElement && scope.matches('table.dt')) labelTable(scope);
    /** @type {NodeListOf<HTMLTableElement>} */ (scope.querySelectorAll('table.dt:not([data-labelled])')).forEach(labelTable);
  }

  // Die Listen werden per innerHTML gebaut, also beobachten wir Kindknoten. characterData und attributes
  // bewusst aus: Wir wollen nur neue Tabellen, nicht jede Textänderung.
  const observer = new MutationObserver(muts => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (node instanceof Element) labelAll(node);
      }
    }
  });

  let started = false;
  function start() {
    if (started || !document.body) return;
    started = true;
    labelAll(document.documentElement);
    observer.observe(document.body, { childList: true, subtree: true });
    bindNavAutoScroll();
  }

  // ── 2. Aktiven Reiter in den sichtbaren Bereich scrollen ────────────────

  function scrollActiveTabIntoView() {
    const nav = document.querySelector('nav');
    const active = /** @type {HTMLElement | null} */ (document.querySelector('.ntab.active'));
    if (!nav || !active) return;
    // Nur wenn die Leiste überhaupt scrollt — auf dem Desktop passiert nichts.
    if (nav.scrollWidth <= nav.clientWidth + 4) return;
    const target = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
    nav.scrollTo({ left: Math.max(0, target), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  function bindNavAutoScroll() {
    document.querySelectorAll('.ntab').forEach(tab => {
      if (tab._mobileScrollBound) return;
      tab._mobileScrollBound = true;
      // Nach dem bestehenden Klick-Handler laufen lassen, der .active setzt.
      tab.addEventListener('click', () => setTimeout(scrollActiveTabIntoView, 0));
    });
    // Beim Anzeigen der App (nach Login/Neuladen) einmal nachziehen.
    setTimeout(scrollActiveTabIntoView, 300);
  }

  // Bedingung ist <body>, nicht der readyState: Das Skript steht am Ende des Body, die Beschriftungen greifen
  // so vor dem ersten Paint. Nur auf DOMContentLoaded zu warten liefe bei spätem Laden nie an.
  // Ausführlich: docs/begruendungen/public/js/10-mobile.js.md#start
  start();
  if (!started) document.addEventListener('DOMContentLoaded', start);

  // ── 3. Rollende Abschnittsleiste der Einstellungen ──────────────────────
  // Am Telefon rollt sie seitwärts; ohne Hinweis am Rand sah niemand die Abschnitte dahinter. data-mehr sagt
  // dem CSS, auf welcher Seite noch etwas liegt.
  /**
   * @param {HTMLElement} nav
   */
  function randHinweis(nav) {
    const rechts = nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 2;
    const links = nav.scrollLeft > 2;
    nav.dataset.mehr = (links ? 'l' : '') + (rechts ? 'r' : '');
  }
  const einstNav = /** @type {HTMLElement | null} */ (document.querySelector('.einst-nav'));
  if (einstNav) {
    einstNav.addEventListener('scroll', () => randHinweis(einstNav), { passive: true });
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => randHinweis(einstNav)).observe(einstNav);
  }

  // ── 4. Kopf beim Rollen nach unten ausblenden ───────────────────────────
  // Nur die Klasse; mobile.css blendet aus, und zwar nur bei geringer Höhe (200 % Zoom, Querformat), wo Kopf,
  // Band und Leiste fast die Hälfte belegen. Rollen nach oben oder Fokus im Kopf holt ihn zurück.
  let letzteHoehe = window.scrollY;
  window.addEventListener('scroll', () => {
    const y = window.scrollY, wurzel = document.documentElement;
    wurzel.classList.toggle('schrift-gross', parseFloat(getComputedStyle(wurzel).fontSize) >= 24);
    if (y < 60 || y < letzteHoehe - 4) wurzel.classList.remove('kopf-weg');
    else if (y > letzteHoehe + 4) wurzel.classList.add('kopf-weg');
    if (Math.abs(y - letzteHoehe) > 4) letzteHoehe = y;
  }, { passive: true });
  for (const leiste of document.querySelectorAll('header, nav:not(.einst-nav)'))
    leiste.addEventListener('focusin', () => document.documentElement.classList.remove('kopf-weg'));

  // ── 5. Platz für die festen Leisten ─────────────────────────────────────
  // Tab rollte ein Feld nur knapp ins Bild, und die Leiste lag darüber (WCAG 2.4.11). Die Höhen wechseln mit
  // Schriftgrösse und Breite; das scroll-padding in styles.css liest sie. Gemessen wird vor dem Rollen
  // (focusin).
  function leistenMessen() {
    const wurzel = document.documentElement, kopf = /** @type {HTMLElement|null} */ (document.querySelector('header'));
    const nav = /** @type {HTMLElement|null} */ (document.querySelector('nav:not(.einst-nav)')), band = document.getElementById('offline-band');
    const navUnten = !!nav && getComputedStyle(nav).position === 'fixed';
    const oben = (kopf?.offsetHeight || 0) + (nav && !navUnten ? nav.offsetHeight : 0) + (band && !band.hidden ? band.offsetHeight : 0);
    const unten = navUnten ? nav.offsetHeight : 0;
    wurzel.style.setProperty('--leiste-oben', `${Math.round(oben)}px`);
    wurzel.style.setProperty('--leiste-unten', `${Math.round(unten)}px`);
  }
  document.addEventListener('focusin', leistenMessen, true);
  window.addEventListener('resize', leistenMessen, { passive: true });
  if (typeof ResizeObserver === 'function')
    for (const l of document.querySelectorAll('header, nav:not(.einst-nav)')) new ResizeObserver(leistenMessen).observe(l);
  leistenMessen();

  // Für Tests und für Code, der Tabellen ausserhalb des Observers erzeugt.
  window.__bimLabelTables = labelAll;
})();
