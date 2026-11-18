// Runs blocking in the <head>, before the first paint: the login and landing page then also carry the
// right theme right away. First the last known value, then reconciling with the server — so nothing
// flashes and nothing goes stale.

(() => {
  var KEY = 'bim_theme';
  // Must match DESIGNS in src/vertrag/globaleRegeln.ts — a test keeps both in sync (theme.test.js).
  var ALLOWED = ['classic', 'brick', 'werkbank', 'farbfaecher', 'noppe', 'hochglanz'];

  /**
   * Applies a theme. An empty value means "no information" and changes nothing: falling back to classic
   * made the page jump on login and wrote the wrong value into the cache.
   * @param {string | null | undefined} theme
   * @param {boolean} [wait] only switch once the stylesheets are loaded
   */
  function apply(theme, wait) {
    if (!theme || ALLOWED.indexOf(theme) === -1) return null;
    serverTheme = theme;
    loadStyles(
      theme,
      () => {
        if (serverTheme === theme) document.documentElement.setAttribute('data-theme', effective(theme));
      },
      wait,
    );
    return theme;
  }

  /**
   * Fetches a theme's stylesheets from <template id="design-stile">. On a switch, `next` only runs once
   * they are there — otherwise the page would sit unstyled for a moment.
   * @param {string} theme @param {() => void} next @param {boolean} [wait]
   */
  function loadStyles(theme, next, wait) {
    var el = document.getElementById('design-stile');
    var template = el instanceof HTMLTemplateElement ? el : null;
    var open = 0;
    var done = false;
    var finish = () => {
      if (--open > 0 || done) return;
      done = true;
      next();
    };
    if (template)
      template.content.querySelectorAll('link[data-design]').forEach(link => {
        if ((link.getAttribute('data-design') || '').split(' ').indexOf(theme) === -1) return;
        if (wait) {
          open++;
          link.addEventListener('load', finish, { once: true });
          link.addEventListener('error', finish, { once: true });
        }
        template?.before(document.adoptNode(link));
      });
    if (!open) next();
    // Without a load event (network stalled, jsdom) the theme still switches, just without styling.
    else
      setTimeout(() => {
        open = 0;
        finish();
      }, 1500);
  }

  // If the Rebrickable banner was showing at the last start, the boot shell keeps its space free (js/konto.js).
  try {
    if (localStorage.getItem('bim_rb_band')) document.documentElement.setAttribute('data-rb-band', '');
  } catch (_) {
    /* no storage, no placeholder */
  }

  // ── Dark mode follows the system, per device (profile settings) ────────────────────
  // Only the DEVICE knows whether it wants dark mode. The default is "system": on a dark system, the dark
  // variant of the SAME theme (data-dunkel, colors from tokens.css). Whoever picks "server" keeps the
  // theme without a variant.
  var DARK_KEY = 'bim_dunkel';
  var systemDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  /** @type {string | null} */
  var serverTheme = null;
  /** 'system', 'server' (never dark) or 'immer' (always). */
  function choice() {
    try {
      const w = localStorage.getItem(DARK_KEY);
      return w === 'server' || w === 'immer' ? w : 'system';
    } catch (_) {
      return 'system';
    }
  }
  /** @param {string} theme */
  function effective(theme) {
    var w = choice();
    // "Always dark" even on a light system: otherwise only picking Werkbank got dark mode.
    var dark = theme !== 'werkbank' && (w === 'immer' || (w === 'system' && !!systemDark && systemDark.matches));
    if (dark) document.documentElement.setAttribute('data-dunkel', '');
    else document.documentElement.removeAttribute('data-dunkel');
    // The meta tags' media attributes don't know "always" and "never dark"; Werkbank is dark with no variant.
    var bar = dark || theme === 'werkbank' ? '#14181d' : '#f8fafc';
    document.querySelectorAll('meta[name=theme-color]').forEach(m => {
      m.setAttribute('content', bar);
    });
    return theme;
  }
  function reapply() {
    if (serverTheme) document.documentElement.setAttribute('data-theme', effective(serverTheme));
  }
  if (systemDark?.addEventListener) systemDark.addEventListener('change', reapply);
  window.__bimDunkel = value => {
    try {
      localStorage.setItem(DARK_KEY, value === 'immer' || value === 'server' ? value : 'system');
    } catch (_) {}
    reapply();
  };
  window.__bimDunkelWert = choice;
  // Does a theme have no light variant? Settings then says so.
  window.__bimNurDunkel = theme => theme === 'werkbank';

  /**
   * Setter for konto.js and the admin save handler. Only valid values are applied AND cached — an empty
   * or missing value must not overwrite the cache.
   * @param {string} theme
   */
  function applier(theme) {
    var val = apply(theme, true);
    if (!val) return null;
    try {
      localStorage.setItem(KEY, val);
    } catch (_) {}
    return val;
  }

  // 0) If the server set data-theme (src/profile/indexHtml.ts), it governs: only the cache needs updating,
  //    no reconciliation — no visible jump and no extra request per page load.
  var served = document.documentElement.getAttribute('data-theme');
  if (served && ALLOWED.indexOf(served) !== -1) {
    try {
      localStorage.setItem(KEY, served);
    } catch (_) {}
    serverTheme = served;
    loadStyles(served, () => {});
    reapply();
    window.__bimApplyTheme = applier;
    return;
  }

  // 1) Fallback when the server set nothing (statically served file, an upstream cache, a render error):
  //    apply the last known theme right away, then reconcile against the server.
  /** @type {string | null} */
  var cached = null;
  try {
    cached = localStorage.getItem(KEY);
  } catch (_) {}
  apply(cached);

  // 2) Catch up with the server's value
  function sync() {
    fetch('/api/v1/settings/theme', { credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!d?.success || !d.theme) return;
        if (d.theme !== cached) {
          apply(d.theme, true);
          try {
            localStorage.setItem(KEY, d.theme);
          } catch (_) {}
        }
      })
      .catch(() => {
        /* offline, or the server is still starting — the cache stays valid */
      });
  }

  // The server only accepts requests after initSchemaOnce(); a failure here is harmless, since
  // checkAuth() waits for startup anyway and applyTheme() sets the server value again after login.
  sync();

  window.__bimApplyTheme = applier;
})();
