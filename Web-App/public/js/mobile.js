// What mobile.css cannot do declaratively: table cells get their column label stamped into
// data-label, instead of touching ten templates and forgetting future ones. Always runs, only
// takes effect on narrow screens.

(() => {
  // ── 1. data-label on table cells ────────────────────────────────────

  /** Take a table's labels from its <thead>. */
  /** @param {HTMLTableElement | null | undefined} table */
  function labelTable(table) {
    if (!table || table.dataset.labelled === '1') return;
    const head = table.tHead;
    if (!head?.rows.length) return;

    // Only the bottom header row counts — multi-row headers (a group heading above) occur in the
    // finance tables.
    const headRow = head.rows[head.rows.length - 1];
    // Visible text only: a header labelled only for screen readers (.vh) stays empty on the card.
    const labels = [...headRow.cells].map(th => {
      const k = th.cloneNode(true);
      /** @type {Element} */
      (k).querySelectorAll('.vh').forEach(v => {
        v.remove();
      });
      return (k.textContent || '').trim();
    });
    if (!labels.length) return;

    for (const body of table.tBodies) {
      for (const row of body.rows) {
        let col = 0;
        for (const cell of row.cells) {
          if (!cell.hasAttribute('data-label')) {
            cell.setAttribute('data-label', labels[col] || '');
          }
          // Account for colspan, otherwise every following column shifts
          col += cell.colSpan || 1;
        }
      }
    }
    table.dataset.labelled = '1';
  }

  /** Handle every still-unlabelled table below root. */
  /** @param {Element | null | undefined} root */
  function labelAll(root) {
    const scope = root ?? document;
    if (scope instanceof HTMLTableElement && scope.matches('table.dt')) labelTable(scope);
    /** @type {NodeListOf<HTMLTableElement>} */ (scope.querySelectorAll('table.dt:not([data-labelled])')).forEach(
      labelTable,
    );
  }

  // Lists are built via innerHTML, so we watch child nodes. characterData and attributes are
  // deliberately left out: we only want new tables, not every text change.
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

  // ── 2. Scroll the active tab into view ────────────────

  function scrollActiveTabIntoView() {
    const nav = document.querySelector('nav');
    const active = /** @type {HTMLElement | null} */ (document.querySelector('.ntab.active'));
    if (!nav || !active) return;
    // Only if the bar actually scrolls — nothing happens on desktop.
    if (nav.scrollWidth <= nav.clientWidth + 4) return;
    const target = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
    nav.scrollTo({
      left: Math.max(0, target),
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }

  function bindNavAutoScroll() {
    document.querySelectorAll('.ntab').forEach(tab => {
      if (tab._mobileScrollBound) return;
      tab._mobileScrollBound = true;
      // Run after the existing click handler that sets .active.
      tab.addEventListener('click', () => setTimeout(scrollActiveTabIntoView, 0));
    });
    // Catch up once when the app becomes visible (after login/reload).
    setTimeout(scrollActiveTabIntoView, 300);
  }

  // The condition is <body>, not readyState: the script sits at the end of the body, so labelling
  // takes effect before the first paint. Waiting only for DOMContentLoaded would never fire on a late load.
  start();
  if (!started) document.addEventListener('DOMContentLoaded', start);

  // ── 3. Scrolling section bar in settings ──────────────────────
  // On a phone it scrolls sideways; without an edge hint nobody saw the sections behind it. data-more
  // tells the CSS which side still has more.
  /**
   * @param {HTMLElement} nav
   */
  function edgeHint(nav) {
    const right = nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 2;
    const left = nav.scrollLeft > 2;
    const more = (left ? 'l' : '') + (right ? 'r' : '');
    if (nav.dataset.more !== more) nav.dataset.more = more;
  }
  for (const settingsNav of /** @type {NodeListOf<HTMLElement>} */ (
    document.querySelectorAll('.settings-nav, .account-nav')
  )) {
    settingsNav.addEventListener('scroll', () => edgeHint(settingsNav), { passive: true });
    // Chrome doesn't scroll a partly-clipped link into view on focus; it would sit half outside the window.
    settingsNav.addEventListener('focusin', e => {
      if (e.target instanceof HTMLElement) e.target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    if (typeof ResizeObserver === 'function')
      new ResizeObserver(() => requestAnimationFrame(() => edgeHint(settingsNav))).observe(settingsNav);
  }

  // ── 4. Hide the header when scrolling down ───────────────────────
  // Only the class; mobile.css hides it, and only at low height (200% zoom, landscape), where header,
  // banner and nav take up nearly half the screen. Scrolling up or focus in the header brings it back.
  let lastHeight = window.scrollY;
  window.addEventListener(
    'scroll',
    () => {
      const y = window.scrollY,
        root = document.documentElement;
      root.classList.toggle('text-large', parseFloat(getComputedStyle(root).fontSize) >= 24);
      if (y < 60 || y < lastHeight - 4) root.classList.remove('header-remove');
      else if (y > lastHeight + 4) root.classList.add('header-remove');
      if (Math.abs(y - lastHeight) > 4) lastHeight = y;
    },
    { passive: true },
  );
  for (const bar of document.querySelectorAll('header, nav:not(.settings-nav)'))
    bar.addEventListener('focusin', () => document.documentElement.classList.remove('header-remove'));

  // ── 5. Room for the fixed bars ─────────────────────────────────────
  // A field scrolled only just into view, with the bar sitting over it (WCAG 2.4.11). The heights
  // change with font size and width; scroll-padding in styles.css reads them. Measured before
  // scrolling (focusin).
  function measureBars() {
    const root = document.documentElement,
      header = /** @type {HTMLElement|null} */ (document.querySelector('header'));
    const nav = /** @type {HTMLElement|null} */ (document.querySelector('nav:not(.settings-nav)')),
      banner = document.getElementById('offline-band');
    const navBottom = !!nav && getComputedStyle(nav).position === 'fixed';
    const bars = (header?.offsetHeight || 0) + (nav && !navBottom ? nav.offsetHeight : 0);
    const top = bars + (banner && !banner.hidden ? banner.offsetHeight : 0);
    const bottom = navBottom ? nav.offsetHeight : 0;
    // Only write on change: every write triggers layout, and the observer below would see itself.
    for (const [name, value] of [
      ['--bar-top', `${Math.round(top)}px`],
      ['--bar-bottom', `${Math.round(bottom)}px`],
      ['--band-top', `${Math.round(bars)}px`],
    ])
      if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value);
  }
  document.addEventListener('focusin', measureBars, true);
  window.addEventListener('resize', measureBars, { passive: true });
  if (typeof ResizeObserver === 'function')
    for (const l of document.querySelectorAll('header, nav:not(.settings-nav)'))
      new ResizeObserver(() => requestAnimationFrame(measureBars)).observe(l);
  measureBars();

  // For tests and for code that creates tables outside the observer.
  window.__bimLabelTables = labelAll;
})();
