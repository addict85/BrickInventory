// Log viewer window (monitor.js opens it via window.open). A separate file because the window
// inherits the opener's CSP and blocks inline scripts. Translations arrive as data attributes on
// <body>, the login via the session cookie. Its own closure: none of this should become global.
(() => {
  const body = document.body;
  const BASE = body.dataset.base || '';
  /** @type {Record<string, string>} */
  const L = (() => {
    try {
      return JSON.parse(body.dataset.i18n || '{}');
    } catch (_) {
      return {};
    }
  })();

  /** @type {Array<{ level: string, message: string, logged_at: string }>} */
  let _logs = [];
  /** @type {ReturnType<typeof setInterval> | null} */
  let _autoTimer = null;
  const _levels = new Set(['warn', 'error']);

  /** @param {string} id */
  const el = id => /** @type {HTMLElement} */ (document.getElementById(id));
  /** @param {string} k */
  const tx = k => L[k] || k;
  // The window inherits the CSP including Trusted Types: its own policy for the markup masked here. As in
  // escaping.js, it only accepts the text that asHtml() has just cleared for it.
  const tt =
    /** @type {{ trustedTypes?: { createPolicy(n: string, r: object): { createHTML(s: string): string } } }} */ (
      /** @type {unknown} */ (window)
    ).trustedTypes;
  /** @type {string | null} */
  let cleared = null;
  const policy = tt
    ? tt.createPolicy('app', {
        createHTML: (/** @type {string} */ s) => {
          if (cleared === null || s !== cleared) throw new TypeError('Trusted Types: markup only via asHtml()');
          cleared = null;
          return s;
        },
      })
    : null;
  /** @param {string} s @returns {string} */
  const asHtml = s => {
    if (!policy) return s;
    cleared = s;
    try {
      return policy.createHTML(s);
    } finally {
      cleared = null;
    }
  };
  /** @param {string} s */
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /** @param {string} text @param {string} q */
  function highlight(text, q) {
    if (!q) return esc(text);
    const parts = esc(text).split(new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'));
    return parts.map((p, i) => (i % 2 === 1 ? '<mark>' + p + '</mark>' : p)).join('');
  }

  /** @param {string} [level] */
  function toggleLevel(level) {
    if (!level) return;
    const btn = el('btn-' + level);
    if (_levels.has(level)) {
      _levels.delete(level);
      btn.classList.remove('active');
    } else {
      _levels.add(level);
      btn.classList.add('active');
    }
    btn.setAttribute('aria-pressed', String(_levels.has(level)));
    renderLogs();
  }

  async function loadLogs() {
    const minutes = /** @type {HTMLSelectElement} */ (el('period')).value;
    el('status').textContent = tx('common.loading');
    try {
      const r = await fetch(BASE + '/api/v2/admin/logs?minutes=' + minutes, { credentials: 'same-origin' });
      const d = await r.json();
      if (d.success) {
        _logs = d.logs;
        renderLogs();
      } else el('status').textContent = tx('toast.error') + ': ' + d.error;
    } catch (_) {
      el('status').textContent = tx('common.network_error');
    }
  }

  // A stack trace would otherwise fill the screen with dozens of lines: the first line stays visible, the
  // rest collapses. If the search matches inside the rest, it opens — otherwise the hit would be invisible.
  /** @param {string} text @param {string} search */
  function message(text, search) {
    const [head, ...rest] = text.split('\n');
    if (!rest.length) return `<span class="msg">${highlight(text, search)}</span>`;
    const open = !!search && rest.join('\n').toLowerCase().includes(search);
    const n = String(rest.length);
    const more = tx(rest.length === 1 ? 'log.more_rows_one' : 'log.more_rows').replace('{n}', n);
    return (
      `<details class="msg"${open ? ' open' : ''}><summary>${highlight(head, search)} ` +
      `<span class="more">(${esc(more)})</span></summary>${highlight(rest.join('\n'), search)}</details>`
    );
  }

  function renderLogs() {
    const search = /** @type {HTMLInputElement} */ (el('search')).value.toLowerCase().trim();
    const wrap = el('log-wrap');
    const hits = _logs.filter(l => _levels.has(l.level) && (!search || l.message.toLowerCase().includes(search)));
    el('status').textContent = hits.length + ' / ' + _logs.length + ' ' + tx('log.entries');
    if (!hits.length) {
      wrap.innerHTML = asHtml('<div class="empty-state">' + esc(tx('log.none_found')) + '</div>');
      return;
    }
    wrap.innerHTML = asHtml(
      hits
        .map(l => {
          const time = new Date(l.logged_at).toLocaleTimeString('de-CH', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          });
          const level = esc(l.level);
          return (
            `<div class="ll ${level}"><span class="ts">${time}</span>` +
            `<span class="lv ${level}">${esc(tx('log.level.' + l.level))}</span>${message(l.message, search)}</div>`
          );
        })
        .join(''),
    );
    wrap.scrollTop = wrap.scrollHeight;
  }

  function toggleAuto() {
    const btn = el('btn-auto');
    if (_autoTimer) {
      clearInterval(_autoTimer);
      _autoTimer = null;
      btn.textContent = tx('log.auto');
      btn.classList.remove('active');
      btn.setAttribute('aria-pressed', 'false');
    } else {
      _autoTimer = setInterval(loadLogs, 5000);
      btn.textContent = tx('log.stop');
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      loadLogs();
    }
  }

  // Like registry.js in the app: only these names are reachable from markup, not every function on window.
  /** @type {Record<string, (arg?: string) => unknown>} */
  const HANDLER = { loadLogs, renderLogs, toggleAuto, toggleLevel };
  for (const [attr, event] of [
    ['data-click', 'click'],
    ['data-change', 'change'],
    ['data-input', 'input'],
  ]) {
    document.querySelectorAll('[' + attr + ']').forEach(node => {
      const fn = HANDLER[node.getAttribute(attr) || ''];
      if (!fn) return;
      const arg = node.getAttribute('data-arg');
      node.addEventListener(event, () => {
        fn(arg ?? undefined);
      });
    });
  }

  loadLogs();
})();
