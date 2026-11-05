// Protokollfenster (01-monitor.js öffnet es per window.open). Externe Datei, weil das Fenster die CSP des
// Öffners erbt und die Inline-Skripte sperrt. Übersetzungen kommen als data-Attribute am <body>, die
// Anmeldung im Sitzungscookie. Eigene Funktion: Nichts davon soll global werden.
(function () {
  'use strict';
  const body = document.body;
  const BASE = body.dataset.base || '';
  /** @type {Record<string, string>} */
  const L = (() => { try { return JSON.parse(body.dataset.i18n || '{}'); } catch (_) { return {}; } })();

  /** @type {Array<{ level: string, message: string, logged_at: string }>} */
  let _logs = [];
  /** @type {ReturnType<typeof setInterval> | null} */
  let _autoTimer = null;
  const _levels = new Set(['warn', 'error']);

  /** @param {string} id */
  const el = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
  /** @param {string} k */
  const tx = (k) => L[k] || k;
  /** @param {string} s */
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /** @param {string} text @param {string} q */
  function highlight(text, q) {
    if (!q) return esc(text);
    const teile = esc(text).split(new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'));
    return teile.map((p, i) => (i % 2 === 1 ? '<mark>' + p + '</mark>' : p)).join('');
  }

  /** @param {string} [stufe] */
  function toggleLevel(stufe) {
    if (!stufe) return;
    const btn = el('btn-' + stufe);
    if (_levels.has(stufe)) { _levels.delete(stufe); btn.classList.remove('active'); }
    else { _levels.add(stufe); btn.classList.add('active'); }
    btn.setAttribute('aria-pressed', String(_levels.has(stufe)));
    renderLogs();
  }

  async function loadLogs() {
    const minuten = /** @type {HTMLSelectElement} */ (el('period')).value;
    el('status').textContent = tx('common.loading');
    try {
      const r = await fetch(BASE + '/api/v1/admin/logs?minutes=' + minuten, { credentials: 'same-origin' });
      const d = await r.json();
      if (d.success) { _logs = d.logs; renderLogs(); }
      else el('status').textContent = tx('toast.error') + ': ' + d.error;
    } catch (_) {
      el('status').textContent = tx('common.network_error');
    }
  }

  function renderLogs() {
    const suche = /** @type {HTMLInputElement} */ (el('search')).value.toLowerCase().trim();
    const wrap = el('log-wrap');
    const treffer = _logs.filter(l => _levels.has(l.level) && (!suche || l.message.toLowerCase().includes(suche)));
    el('status').textContent = treffer.length + ' / ' + _logs.length + ' ' + tx('log.entries');
    if (!treffer.length) { wrap.innerHTML = '<div class="leer">' + tx('log.none_found') + '</div>'; return; }
    wrap.innerHTML = treffer.map(l => {
      const zeit = new Date(l.logged_at).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const stufe = esc(l.level);
      return `<div class="ll ${stufe}"><span class="ts">${zeit}</span>` +
        `<span class="lv ${stufe}">${stufe}</span><span class="msg">${highlight(l.message, suche)}</span></div>`;
    }).join('');
    wrap.scrollTop = wrap.scrollHeight;
  }

  function toggleAuto() {
    const btn = el('btn-auto');
    if (_autoTimer) {
      clearInterval(_autoTimer); _autoTimer = null;
      btn.textContent = tx('log.auto'); btn.classList.remove('active'); btn.setAttribute('aria-pressed', 'false');
    } else {
      _autoTimer = setInterval(loadLogs, 5000);
      btn.textContent = tx('log.stop'); btn.classList.add('active'); btn.setAttribute('aria-pressed', 'true');
      loadLogs();
    }
  }

  // Wie 00-registry.js in der Anwendung: nur diese Namen sind aus dem Markup erreichbar, nicht jede Funktion
  // auf window.
  /** @type {Record<string, (arg?: string) => unknown>} */
  const HANDLER = { loadLogs, renderLogs, toggleAuto, toggleLevel };
  for (const [attr, ereignis] of [['data-click', 'click'], ['data-change', 'change'], ['data-input', 'input']]) {
    document.querySelectorAll('[' + attr + ']').forEach(knoten => {
      const fn = HANDLER[knoten.getAttribute(attr) || ''];
      if (!fn) return;
      const arg = knoten.getAttribute('data-arg');
      knoten.addEventListener(ereignis, () => { fn(arg ?? undefined); });
    });
  }

  loadLogs();
})();
